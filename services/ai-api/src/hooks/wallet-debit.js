/**
 * wallet-debit.js — atomic AI Wallet debit hook
 *
 * Called after every billable AI request. Debits ai_wallet.balance_eur and
 * appends rows to ai_wallet_ledger and usage_events in a single transaction
 * with FOR UPDATE locking to prevent concurrent double-debits.
 *
 * Returns:
 *   { ok: true, costEur, newBalance, autoReloadTriggered, autoReloadAmountEur }
 *   { ok: false, statusCode: 402, reason }
 */

import { getPool } from '../db.js';
import { publishGatewayCacheInvalidation, getRedis } from '../services/usage-events.js';

// EUR per USD exchange rate. Override via env var for production.
// Locked decision #6/#7: AI Wallet in EUR; 1.5× wholesale markup baked into
// token rates already (RATES in cost.js) — this rate only converts the USD
// cost figure to EUR for wallet accounting.
const USD_TO_EUR = parseFloat(process.env.AI_USD_TO_EUR_RATE || '0.92');

/**
 * Convert a USD cost to EUR using the configured exchange rate.
 * Returns a value rounded to 6 decimal places (matching numeric(12,6) column).
 */
function usdToEur(costUsd) {
  return +(costUsd * USD_TO_EUR).toFixed(6);
}

/**
 * Atomic debit: one transaction covers
 *   1. SELECT balance FOR UPDATE (serialize concurrent debits)
 *   2. Check balance >= cost AND monthly total + cost <= monthly_cap
 *   3. UPDATE ai_wallet.balance_eur -= cost
 *   4. INSERT usage_events (return id)
 *   5. INSERT ai_wallet_ledger (usage_event_id = step 4 id)
 *   COMMIT (or ROLLBACK on any failure / 402 condition)
 *
 * After commit, checks auto-reload condition (best-effort; non-blocking).
 *
 * @param {object} opts
 * @param {string} opts.accountId
 * @param {number} opts.costUsd       - cost in USD (from calculateCost())
 * @param {string} opts.model         - model name (e.g. 'claude-sonnet-4-6')
 * @param {string} opts.module        - module_kind enum: 'ai' | 'kb' | 'calculators' | 'flows'
 *                                       ('ai' for chat, 'kb' for KB ask/search/embed)
 * @param {string} opts.eventKind     - e.g. 'ai.message', 'kb.ask', 'embed.tokens'
 * @param {object} [opts.metadata]    - free-form jsonb (stored on both rows)
 * @param {string} [opts.apiKeyId]    - optional, stored on usage_events
 * @param {import('pg').Pool} [opts.pool] - optional pg.Pool override (for testing)
 * @param {object} [opts.redis]           - optional ioredis client override (for testing)
 *
 * @returns {Promise<DebitResult>}
 */
export async function debitWallet({ accountId, costUsd, model, module, eventKind, metadata, apiKeyId, pool: poolOverride, redis: redisOverride }) {
  const pool = poolOverride || getPool();
  if (!pool) {
    // DB not initialised (unit test environment without DB)
    return { ok: false, statusCode: 402, reason: 'Database not available' };
  }

  const costEur = usdToEur(costUsd);
  if (costEur <= 0) {
    // Zero-cost event (e.g. cached response) — nothing to debit
    return { ok: true, costEur: 0, newBalance: null, autoReloadTriggered: false, autoReloadAmountEur: null };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock the wallet row for this account to serialize concurrent debits.
    //    If no wallet row exists we treat that as zero balance → 402.
    const walletRes = await client.query(
      `SELECT balance_eur, monthly_cap_eur, auto_reload_enabled,
              auto_reload_threshold_eur, auto_reload_amount_eur
       FROM public.ai_wallet
       WHERE account_id = $1
       FOR UPDATE`,
      [accountId],
    );

    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        statusCode: 402,
        reason: 'AI Wallet not found. Add funds to continue.',
      };
    }

    const wallet = walletRes.rows[0];
    const balance = parseFloat(wallet.balance_eur);

    // 2a. Balance gate
    if (balance <= 0 || balance < costEur) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        statusCode: 402,
        reason: `Insufficient AI Wallet balance (€${balance.toFixed(4)} available, €${costEur.toFixed(4)} required). Top up to continue.`,
      };
    }

    // 2b. Monthly cap gate (optional — only when monthly_cap_eur is set)
    const cap = wallet.monthly_cap_eur != null ? parseFloat(wallet.monthly_cap_eur) : null;
    if (cap !== null) {
      const monthlyRes = await client.query(
        `SELECT COALESCE(SUM(amount_eur), 0) AS monthly_spent
         FROM public.ai_wallet_ledger
         WHERE account_id = $1
           AND entry_type = 'debit'
           AND occurred_at >= date_trunc('month', NOW())`,
        [accountId],
      );
      const monthlySpent = parseFloat(monthlyRes.rows[0].monthly_spent);
      if (monthlySpent + costEur > cap) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          statusCode: 402,
          reason: `Monthly spending cap of €${cap.toFixed(2)} would be exceeded (€${monthlySpent.toFixed(4)} spent this month, €${costEur.toFixed(4)} requested).`,
        };
      }
    }

    // 3. Debit the wallet
    const updateRes = await client.query(
      `UPDATE public.ai_wallet
         SET balance_eur = balance_eur - $1, date_updated = NOW()
       WHERE account_id = $2
       RETURNING balance_eur`,
      [costEur, accountId],
    );
    const newBalance = parseFloat(updateRes.rows[0].balance_eur);

    // 4. Insert usage_event (BIGSERIAL id returned for ledger FK)
    const eventRes = await client.query(
      `INSERT INTO public.usage_events
         (account_id, api_key_id, module, event_kind, quantity, cost_eur, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6, NOW())
       RETURNING id`,
      [
        accountId,
        apiKeyId || null,
        module,
        eventKind,
        costEur,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
    const usageEventId = eventRes.rows[0].id;

    // 5. Insert ledger entry (references usage_event just created)
    await client.query(
      `INSERT INTO public.ai_wallet_ledger
         (account_id, entry_type, amount_eur, balance_after_eur, source, usage_event_id, metadata, occurred_at)
       VALUES ($1, 'debit', $2, $3, 'usage', $4, $5, NOW())`,
      [
        accountId,
        costEur,
        newBalance,
        usageEventId,
        metadata ? JSON.stringify({ model, ...metadata }) : JSON.stringify({ model }),
      ],
    );

    await client.query('COMMIT');

    // ── Gateway cache invalidation (task 42) ─────────────────────────────────
    // Publish after commit so gateway drops the 60s-stale AI spend cache entry.
    // Fire-and-forget: failure here must never affect the debit result.
    if (apiKeyId) {
      publishGatewayCacheInvalidation(redisOverride !== undefined ? redisOverride : getRedis(), 'ai_spend', apiKeyId)
        .catch(() => {}); // belt+suspenders; publishGatewayCacheInvalidation already swallows
    }

    // ── Auto-reload check (best-effort, separate from committed transaction) ──
    let autoReloadTriggered = false;
    let autoReloadAmountEur = null;

    if (wallet.auto_reload_enabled && wallet.auto_reload_threshold_eur != null) {
      const threshold = parseFloat(wallet.auto_reload_threshold_eur);
      if (newBalance < threshold) {
        autoReloadTriggered = true;
        autoReloadAmountEur = wallet.auto_reload_amount_eur != null
          ? parseFloat(wallet.auto_reload_amount_eur)
          : null;

        // Enqueue durable auto-reload row for the CMS Stripe consumer to process.
        // Must run in a NEW transaction AFTER the debit COMMIT — a failure here
        // must never roll back the debit. Idempotency is enforced by the partial
        // UNIQUE index idx_auto_reload_pending_active_per_account (scope:
        // status IN ('pending','processing')), so concurrent debits on the same
        // account collapse to a single enqueued row.
        //
        // If amount is missing (misconfigured wallet), skip enqueue but still
        // return the flag so callers can surface the misconfiguration.
        if (autoReloadAmountEur != null && autoReloadAmountEur > 0) {
          try {
            await pool.query(
              `INSERT INTO public.wallet_auto_reload_pending (account_id, amount_eur)
               VALUES ($1, $2)
               ON CONFLICT (account_id) WHERE status IN ('pending','processing')
               DO NOTHING`,
              [accountId, autoReloadAmountEur],
            );
          } catch (enqueueErr) {
            // Log at error level with context but never re-throw — the debit
            // has already committed and must return success. A reconciliation
            // job is expected to catch missed enqueues (see task 31 §Risks).
            // eslint-disable-next-line no-console
            console.error('[wallet-debit] auto-reload enqueue failed', {
              accountId,
              amountEur: autoReloadAmountEur,
              error: enqueueErr?.message || String(enqueueErr),
            });
          }
        }
      }
    }

    return {
      ok: true,
      costEur,
      newBalance,
      autoReloadTriggered,
      autoReloadAmountEur,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore rollback error */ }
    throw err;
  } finally {
    client.release();
  }
}
