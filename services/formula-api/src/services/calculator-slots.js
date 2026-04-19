/**
 * calculator-slots.js
 *
 * Compute size_class + slots_consumed for a calculator and UPSERT the result
 * into public.calculator_slots.
 *
 * Callers pass { sheets, formulas, expressions } already extracted from the
 * request body — this service only computes the slot row; it does not parse
 * the workbook itself.
 */

// ─── Size-class thresholds (auditable in one place) ───────────────────────────

const SIZE_CLASS = {
  SMALL: 'small',
  MEDIUM: 'medium',
  LARGE: 'large',
};

const THRESHOLDS = {
  small: { maxSheets: 10, maxExpressions: 500 },
  large: { minSheets: 50, minExpressions: 5000 },
};

const SLOTS_FOR_CLASS = {
  small: 1,
  medium: 3,
  large: 8,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Count sheets from the sheets object (keys are sheet names).
 * expressions = combined formulas + expressions array count as total expression count.
 */
export function computeSizeClass(sheetCount, expressionCount) {
  if (sheetCount >= THRESHOLDS.large.minSheets || expressionCount >= THRESHOLDS.large.minExpressions) {
    return SIZE_CLASS.LARGE;
  }
  if (sheetCount <= THRESHOLDS.small.maxSheets && expressionCount <= THRESHOLDS.small.maxExpressions) {
    return SIZE_CLASS.SMALL;
  }
  return SIZE_CLASS.MEDIUM;
}

export function slotsForClass(sizeClass) {
  return SLOTS_FOR_CLASS[sizeClass] ?? 1;
}

/**
 * Derive sheet + expression counts from a calculator's payload.
 * sheets: object with sheet-name keys
 * formulas: array of formula descriptors
 * expressions: optional array (compiled expression set, counts separately)
 */
export function extractCounts(sheets, formulas, expressions) {
  const sheetCount = sheets && typeof sheets === 'object' ? Object.keys(sheets).length : 0;
  const formulaCount = Array.isArray(formulas) ? formulas.length : 0;
  const expressionCount = formulaCount + (Array.isArray(expressions) ? expressions.length : 0);
  return { sheetCount, expressionCount };
}

// ─── DB operations ────────────────────────────────────────────────────────────

/**
 * UPSERT a calculator_slots row.
 * Conflict target: calculator_config_id (unique per config).
 *
 * @param {object} pool   - pg.Pool instance
 * @param {object} opts
 * @param {string} opts.calculatorConfigId
 * @param {string} opts.accountId
 * @param {number} opts.slotsConsumed
 * @param {string} opts.sizeClass
 * @param {number|null} opts.fileVersion
 * @param {number|null} opts.configVersion
 * @returns {Promise<object>} inserted/updated row
 */
export async function upsertCalculatorSlot(pool, {
  calculatorConfigId,
  accountId,
  slotsConsumed,
  sizeClass,
  fileVersion = null,
  configVersion = null,
}) {
  const result = await pool.query(
    `INSERT INTO public.calculator_slots
       (calculator_config_id, account_id, slots_consumed, size_class, file_version, config_version, computed_at, date_updated)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (calculator_config_id) DO UPDATE SET
       account_id     = EXCLUDED.account_id,
       slots_consumed = EXCLUDED.slots_consumed,
       size_class     = EXCLUDED.size_class,
       file_version   = EXCLUDED.file_version,
       config_version = EXCLUDED.config_version,
       computed_at    = NOW(),
       date_updated   = NOW()
     RETURNING *`,
    [calculatorConfigId, accountId, slotsConsumed, sizeClass, fileVersion, configVersion],
  );
  return result.rows[0];
}

/**
 * Full compute + UPSERT flow.
 * Derives size_class from sheets/formulas/expressions, then writes the slot row.
 *
 * @param {object} pool
 * @param {object} opts
 * @param {string} opts.calculatorConfigId
 * @param {string} opts.accountId
 * @param {object} opts.sheets
 * @param {Array}  opts.formulas
 * @param {Array|null} opts.expressions
 * @param {number|null} opts.fileVersion
 * @param {number|null} opts.configVersion
 * @returns {Promise<{sizeClass, slotsConsumed, row}>}
 */
export async function computeAndUpsertSlot(pool, {
  calculatorConfigId,
  accountId,
  sheets,
  formulas,
  expressions,
  fileVersion = null,
  configVersion = null,
}) {
  const { sheetCount, expressionCount } = extractCounts(sheets, formulas, expressions);
  const sizeClass = computeSizeClass(sheetCount, expressionCount);
  const slotsConsumed = slotsForClass(sizeClass);

  const row = await upsertCalculatorSlot(pool, {
    calculatorConfigId,
    accountId,
    slotsConsumed,
    sizeClass,
    fileVersion,
    configVersion,
  });

  return { sizeClass, slotsConsumed, row };
}

// ─── Quota queries ────────────────────────────────────────────────────────────

/**
 * Reconcile orphaned calculator_configs: configs that were written to DB but
 * whose formula-api slot UPSERT never completed (crash between build success
 * and slot write). Re-materialises the slot row from stored config data so
 * the quota count stays accurate.
 *
 * Runs as a best-effort side-effect inside checkUploadQuota — errors are
 * logged but do NOT block the quota decision.
 *
 * @param {object} client - pg.PoolClient (must be within a transaction)
 * @param {string} accountId
 */
async function reconcileOrphanedSlots(client, accountId) {
  // Find calculator_configs rows for this account that have no slot row.
  // account is stored on calculators.account (not on calculator_configs directly).
  // Grace window: only reconcile configs older than 30 seconds to avoid treating
  // an in-flight concurrent upload as an orphan. A genuine crash leaves the config
  // unresolved indefinitely; an in-flight upload completes within seconds.
  const orphans = await client.query(
    `SELECT cc.id           AS config_id,
            c.account       AS account_id,
            cc.file_version,
            cc.config_version,
            cc.sheets,
            cc.formulas,
            cc.expressions
     FROM public.calculator_configs cc
     JOIN public.calculators c ON c.id = cc.calculator
     WHERE c.account = $1
       AND cc.test_environment = false
       AND cc.date_created < NOW() - INTERVAL '30 seconds'
       AND NOT EXISTS (
         SELECT 1 FROM public.calculator_slots s
         WHERE s.calculator_config_id = cc.id
       )`,
    [accountId],
  );

  for (const row of orphans.rows) {
    try {
      const sheets = row.sheets ?? {};
      const formulas = row.formulas ?? [];
      const expressions = row.expressions ?? null;
      const { sheetCount, expressionCount } = extractCounts(sheets, formulas, expressions);
      const sizeClass = computeSizeClass(sheetCount, expressionCount);
      const slotsConsumed = slotsForClass(sizeClass);

      await client.query(
        `INSERT INTO public.calculator_slots
           (calculator_config_id, account_id, slots_consumed, size_class, file_version, config_version, computed_at, date_updated)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (calculator_config_id) DO NOTHING`,
        [row.config_id, row.account_id, slotsConsumed, sizeClass, row.file_version ?? null, row.config_version ?? null],
      );
    } catch (reconcileErr) {
      // Non-fatal: log and continue. A missed orphan reconcile does not
      // warrant blocking the upload.
      console.warn('[calculator-slots] orphan reconcile failed for config', row.config_id, reconcileErr.message);
    }
  }
}

/**
 * Check whether an account has enough slot capacity to upload a new calculator
 * with the given slotsConsumed.
 *
 * Runs inside a transaction with a pg_advisory_xact_lock so that concurrent
 * uploads from the same account cannot both pass the quota check and then both
 * UPSERT slots (I-3 race fix). The caller must pass a pg.PoolClient that is
 * already in a transaction, OR pass a pg.Pool and let this function manage the
 * transaction itself.
 *
 * Also performs lazy reconciliation of orphaned calculator_configs rows (I-2).
 *
 * Returns { ok: true } or { ok: false, statusCode: 402, reason: string }.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} poolOrClient
 * @param {string} accountId
 * @param {number} slotsConsumed
 * @param {{ client?: import('pg').PoolClient }} [opts]
 *   Pass opts.client to run inside an existing transaction (advisory lock
 *   must already be held by the caller). Omit to open a new transaction.
 */
export async function checkUploadQuota(poolOrClient, accountId, slotsConsumed, opts = {}) {
  // If the caller supplies a pre-locked client, use it directly (no nested txn).
  if (opts.client) {
    return _quotaQuery(opts.client, accountId, slotsConsumed);
  }

  // Stand-alone path: acquire pool client, open txn, advisory lock, query, commit.
  const client = await poolOrClient.connect();
  try {
    await client.query('BEGIN');
    // Advisory lock scoped to this transaction (auto-released on COMMIT/ROLLBACK).
    // Key: hashtext of a string that uniquely identifies the account's slot budget.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('calc-slot-' || $1))", [accountId]);

    // Reconcile any orphaned configs before reading the quota totals.
    await reconcileOrphanedSlots(client, accountId);

    const result = await _quotaQuery(client, accountId, slotsConsumed);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Internal: run the quota SELECT inside an already-open client.
 * Does NOT manage transactions or locks.
 */
async function _quotaQuery(client, accountId, slotsConsumed) {
  const result = await client.query(
    `WITH consumed AS (
       SELECT account_id,
              SUM(slots_consumed)                                AS slots_used,
              SUM(slots_consumed) FILTER (WHERE is_always_on)   AS ao_used
       FROM public.calculator_slots
       WHERE account_id = $1
       GROUP BY account_id
     )
     SELECT
       q.slot_allowance  - COALESCE(c.slots_used, 0) AS slots_remaining,
       q.ao_allowance    - COALESCE(c.ao_used, 0)    AS ao_remaining
     FROM public.feature_quotas q
     LEFT JOIN consumed c ON c.account_id = q.account_id
     WHERE q.account_id = $1 AND q.module = 'calculators'`,
    [accountId],
  );

  if (!result.rows.length) {
    // No feature_quotas row — subscription required
    return { ok: false, statusCode: 402, reason: 'Subscription required for calculators' };
  }

  const { slots_remaining } = result.rows[0];
  const remaining = parseInt(slots_remaining, 10);

  if (remaining < slotsConsumed) {
    return {
      ok: false,
      statusCode: 402,
      reason: `Slot quota exceeded: ${remaining} slots remaining, need ${slotsConsumed}`,
    };
  }

  return { ok: true };
}

/**
 * Atomic check + UPSERT for a new calculator upload.
 *
 * Wraps checkUploadQuota and upsertCalculatorSlot in a single advisory-locked
 * transaction so concurrent uploads from the same account cannot both pass the
 * quota check (I-3). The advisory lock is keyed on accountId.
 *
 * Option A architecture: the preHandler (checkSlotQuota) still fires as a
 * cheap fast-fail for obvious violators (no DB round-trip wasted on clearly
 * over-quota accounts). This function is the authoritative gate — the
 * preHandler check is best-effort only.
 *
 * @param {import('pg').Pool} pool
 * @param {object} opts  – same shape as computeAndUpsertSlot
 * @returns {Promise<{sizeClass, slotsConsumed, row} | {ok: false, statusCode, reason}>}
 */
export async function atomicCheckAndUpsertSlot(pool, {
  calculatorConfigId,
  accountId,
  sheets,
  formulas,
  expressions,
  fileVersion = null,
  configVersion = null,
}) {
  const { sheetCount, expressionCount } = extractCounts(sheets, formulas, expressions);
  const sizeClass = computeSizeClass(sheetCount, expressionCount);
  const slotsConsumed = slotsForClass(sizeClass);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('calc-slot-' || $1))", [accountId]);

    // Reconcile orphans before the authoritative quota check.
    await reconcileOrphanedSlots(client, accountId);

    // Authoritative quota check (inside the same lock).
    const quota = await _quotaQuery(client, accountId, slotsConsumed);
    if (!quota.ok) {
      await client.query('COMMIT'); // release lock
      return quota; // { ok: false, statusCode, reason }
    }

    // UPSERT the slot row.
    const upsertResult = await client.query(
      `INSERT INTO public.calculator_slots
         (calculator_config_id, account_id, slots_consumed, size_class, file_version, config_version, computed_at, date_updated)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (calculator_config_id) DO UPDATE SET
         account_id     = EXCLUDED.account_id,
         slots_consumed = EXCLUDED.slots_consumed,
         size_class     = EXCLUDED.size_class,
         file_version   = EXCLUDED.file_version,
         config_version = EXCLUDED.config_version,
         computed_at    = NOW(),
         date_updated   = NOW()
       RETURNING *`,
      [calculatorConfigId, accountId, slotsConsumed, sizeClass, fileVersion, configVersion],
    );

    await client.query('COMMIT');
    return { ok: true, sizeClass, slotsConsumed, row: upsertResult.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check whether an account can toggle is_always_on = true for a specific calculator.
 * Validates that the calculator's slots_consumed fits within remaining ao_allowance.
 * No-op when toggling to false.
 *
 * @param {object} pool
 * @param {string} accountId
 * @param {number} slotsConsumed - slots_consumed for the specific calc being toggled
 * @returns {Promise<{ok: true} | {ok: false, statusCode: 402, reason: string}>}
 */
export async function checkAlwaysOnQuota(pool, accountId, slotsConsumed) {
  const result = await pool.query(
    `WITH consumed AS (
       SELECT account_id,
              SUM(slots_consumed) FILTER (WHERE is_always_on) AS ao_used
       FROM public.calculator_slots
       WHERE account_id = $1
       GROUP BY account_id
     )
     SELECT
       q.ao_allowance - COALESCE(c.ao_used, 0) AS ao_remaining
     FROM public.feature_quotas q
     LEFT JOIN consumed c ON c.account_id = q.account_id
     WHERE q.account_id = $1 AND q.module = 'calculators'`,
    [accountId],
  );

  if (!result.rows.length) {
    return { ok: false, statusCode: 402, reason: 'Subscription required for calculators' };
  }

  const remaining = parseInt(result.rows[0].ao_remaining, 10);
  if (remaining < slotsConsumed) {
    return {
      ok: false,
      statusCode: 402,
      reason: `Always-on quota exceeded: ${remaining} always-on slots remaining, need ${slotsConsumed}`,
    };
  }

  return { ok: true };
}

/**
 * Update is_always_on for a calculator_slots row.
 * Returns the updated row, or null if not found.
 */
export async function setAlwaysOn(pool, calculatorConfigId, isAlwaysOn) {
  const result = await pool.query(
    `UPDATE public.calculator_slots
     SET is_always_on = $2, date_updated = NOW()
     WHERE calculator_config_id = $1
     RETURNING *`,
    [calculatorConfigId, isAlwaysOn],
  );
  return result.rows[0] ?? null;
}

export { SIZE_CLASS, THRESHOLDS, SLOTS_FOR_CLASS };
