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
 * Check whether an account has enough slot capacity to upload a new calculator
 * with the given slotsConsumed.
 *
 * Returns { ok: true } or { ok: false, statusCode: 402, reason: string }.
 */
export async function checkUploadQuota(pool, accountId, slotsConsumed) {
  const result = await pool.query(
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
 * Check whether an account can toggle is_always_on = true for a calculator.
 * Validates against ao_allowance. No-op when toggling to false.
 *
 * Returns { ok: true } or { ok: false, statusCode: 402, reason: string }.
 */
export async function checkAlwaysOnQuota(pool, accountId) {
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

  const { ao_remaining } = result.rows[0];
  if (parseInt(ao_remaining, 10) <= 0) {
    return {
      ok: false,
      statusCode: 402,
      reason: `Always-on quota exceeded: ${ao_remaining} always-on slots remaining`,
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
