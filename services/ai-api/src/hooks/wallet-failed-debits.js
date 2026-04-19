/**
 * wallet-failed-debits.js — Task 33 failed-debit recorder + reconciler
 *
 * Called by ai-api route handlers when `debitWallet` fails (returns !ok OR
 * throws). The user already got their AI answer and Anthropic already charged
 * us; if we can't record the failure durably, the wallet charge is lost.
 *
 * Two exports:
 *   recordFailedDebit(opts) — best-effort INSERT into ai_wallet_failed_debits.
 *     Never throws. Returns { recorded: bool, id?, reason?, error? }.
 *     If INSERT fails, logs at error level ("lost forever") and returns
 *     recorded=false — callers should not re-throw.
 *
 *   reconcileFailedDebits(opts) — admin replay. Selects pending rows older
 *     than RECONCILE_MIN_AGE_MINUTES, retries debitWallet with stored context,
 *     transitions status → 'reconciled' or 'waived'.
 */

import { getPool } from '../db.js';
import { debitWallet } from './wallet-debit.js';

const USD_TO_EUR = parseFloat(process.env.AI_USD_TO_EUR_RATE || '0.92');

// Matches wallet-debit.js numeric precision (numeric(12,6)).
function usdToEur(costUsd) {
  return +(costUsd * USD_TO_EUR).toFixed(6);
}

// Keep error_detail well under text limit. 8k is generous for a stack trace
// but bounded enough to avoid DoS via pathological error payloads.
const ERROR_DETAIL_MAX = 8000;

// Only reconcile rows older than this — gives transient failures time to
// self-heal and avoids stepping on live debits for the same account.
export const RECONCILE_MIN_AGE_MINUTES = 5;

/**
 * Best-effort INSERT into public.ai_wallet_failed_debits. Never throws.
 *
 * @param {object} opts
 * @param {string} opts.accountId
 * @param {number} opts.costUsd
 * @param {number} [opts.costEur]  - if omitted, derived from costUsd @ USD_TO_EUR
 * @param {string} opts.model
 * @param {number} opts.inputTokens
 * @param {number} opts.outputTokens
 * @param {string} opts.eventKind   - 'ai.message' | 'kb.ask' | ...
 * @param {string} opts.module      - 'kb' | 'calculators' | 'flows'
 * @param {string} [opts.anthropicRequestId]
 * @param {string} [opts.apiKeyId]
 * @param {string} [opts.conversationId]
 * @param {string} opts.errorReason - short tag: 'debit_returned_not_ok' | 'debit_threw'
 * @param {string} [opts.errorDetail] - full detail / stack trace / reason string
 * @param {import('pg').Pool} [opts.pool]
 * @returns {Promise<{recorded: boolean, id?: number, reason?: string, error?: string}>}
 */
export async function recordFailedDebit(opts) {
  const pool = opts.pool || getPool();
  if (!pool) {
    // Lost-forever path. Log with structured context so ops can still
    // reconstruct from stdout aggregation if nothing else.
    // eslint-disable-next-line no-console
    console.error('[wallet-failed-debits] pool unavailable — failure not persisted', {
      accountId: opts.accountId,
      costUsd: opts.costUsd,
      model: opts.model,
      errorReason: opts.errorReason,
    });
    return { recorded: false, reason: 'no_pool' };
  }

  const costEurFinal = opts.costEur ?? usdToEur(opts.costUsd);
  const detail = opts.errorDetail != null
    ? String(opts.errorDetail).slice(0, ERROR_DETAIL_MAX)
    : null;

  try {
    const r = await pool.query(
      `INSERT INTO public.ai_wallet_failed_debits (
         account_id, cost_usd, cost_eur, model,
         input_tokens, output_tokens,
         event_kind, module,
         anthropic_request_id, api_key_id, conversation_id,
         error_reason, error_detail
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        opts.accountId,
        opts.costUsd,
        costEurFinal,
        opts.model,
        opts.inputTokens | 0,
        opts.outputTokens | 0,
        opts.eventKind,
        opts.module,
        opts.anthropicRequestId || null,
        opts.apiKeyId || null,
        opts.conversationId || null,
        opts.errorReason,
        detail,
      ],
    );
    return { recorded: true, id: r.rows[0].id };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[wallet-failed-debits] INSERT failed — lost forever', {
      accountId: opts.accountId,
      costUsd: opts.costUsd,
      model: opts.model,
      errorReason: opts.errorReason,
      insertError: err?.message || String(err),
    });
    return { recorded: false, reason: 'insert_failed', error: err?.message || String(err) };
  }
}

/**
 * Replay pending failed-debit rows. Uses a pg advisory lock per account_id
 * to avoid racing live debits on the same wallet.
 *
 * Transitions:
 *   debitWallet ok                    → status='reconciled', method='auto'
 *   debitWallet !ok (insufficient)    → status='waived',     method='waived'
 *   debitWallet throws / other !ok    → row left 'pending' for next pass
 *
 * @param {object} opts
 * @param {import('pg').Pool} [opts.pool]
 * @param {number} [opts.limit=500]            - batch ceiling
 * @param {number} [opts.minAgeMinutes]        - override RECONCILE_MIN_AGE_MINUTES
 * @returns {Promise<{scanned, reconciled, waived, failed}>}
 */
export async function reconcileFailedDebits(opts = {}) {
  const pool = opts.pool || getPool();
  const result = { scanned: 0, reconciled: 0, waived: 0, failed: 0 };
  if (!pool) return result;

  const minAge = opts.minAgeMinutes ?? RECONCILE_MIN_AGE_MINUTES;
  const limit = opts.limit ?? 500;

  const selectRes = await pool.query(
    `SELECT id, account_id, cost_usd, cost_eur, model, input_tokens, output_tokens,
            event_kind, module, anthropic_request_id, api_key_id, conversation_id
       FROM public.ai_wallet_failed_debits
      WHERE status = 'pending'
        AND created_at < NOW() - ($1 * INTERVAL '1 minute')
      ORDER BY created_at ASC
      LIMIT $2`,
    [minAge, limit],
  );

  result.scanned = selectRes.rows.length;

  for (const row of selectRes.rows) {
    // Advisory lock keyed on the account UUID (hashed to bigint) avoids racing
    // a live debitWallet on the same account.
    const lockKey = `reconcile:${row.account_id}`;
    const client = await pool.connect();
    let lockAcquired = false;
    try {
      // pg_advisory_lock takes bigint — hash the string via hashtext().
      const lockRes = await client.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [lockKey],
      );
      lockAcquired = lockRes.rows[0].acquired === true;
      if (!lockAcquired) {
        // Another reconciler is working this account — skip.
        continue;
      }

      const debit = await debitWallet({
        pool,
        accountId: row.account_id,
        costUsd: parseFloat(row.cost_usd),
        model: row.model,
        module: row.module,
        eventKind: row.event_kind,
        apiKeyId: row.api_key_id || undefined,
        metadata: {
          reconciled_failed_debit_id: Number(row.id),
          anthropic_request_id: row.anthropic_request_id || undefined,
          conversation_id: row.conversation_id || undefined,
        },
      });

      if (debit.ok) {
        await pool.query(
          `UPDATE public.ai_wallet_failed_debits
              SET status = 'reconciled',
                  reconciliation_method = 'auto',
                  reconciled_at = NOW()
            WHERE id = $1`,
          [row.id],
        );
        result.reconciled++;
      } else if (debit.statusCode === 402
        && /insufficient|not found/i.test(debit.reason || '')) {
        await pool.query(
          `UPDATE public.ai_wallet_failed_debits
              SET status = 'waived',
                  reconciliation_method = 'waived',
                  reconciled_at = NOW()
            WHERE id = $1`,
          [row.id],
        );
        result.waived++;
      } else {
        // Other !ok (e.g. monthly cap exceeded) — leave pending for next pass.
        result.failed++;
      }
    } catch (err) {
      // Reconcile attempt threw — log and leave row pending for next pass.
      // eslint-disable-next-line no-console
      console.error('[wallet-failed-debits] reconcile attempt threw', {
        rowId: Number(row.id),
        accountId: row.account_id,
        error: err?.message || String(err),
      });
      result.failed++;
    } finally {
      if (lockAcquired) {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
        } catch { /* ignore unlock failure */ }
      }
      client.release();
    }
  }

  return result;
}
