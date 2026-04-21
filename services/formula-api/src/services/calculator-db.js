/**
 * Direct PostgreSQL reads replacing the CMS Admin API calls.
 * Tables are in the public schema (Directus default).
 * The cms.* prefix is the logical ownership boundary per architecture docs,
 * but the actual tables live in public.* until schema separation is complete.
 */
import { queryOne, queryAll } from '../db.js';

/**
 * Load a calculator recipe by ID (strips -test suffix, handles test flag).
 * Returns the same shape as the Admin API GET /management/calc/recipes/:id
 * (i.e. buildRecipe output), or null if not found / not activated.
 */
export async function loadRecipeFromDb(id) {
  // Determine if this is a test calculator
  const isTest = id.endsWith('-test');
  const calcId = isTest ? id.slice(0, -5) : id;

  const row = await queryOne(
    `SELECT
       c.id,
       c.name,
       c.account AS account_id,
       c.activated,
       c.test_expires_at,
       c.activation_expires_at,
       cc.sheets,
       cc.formulas,
       cc.input,
       cc.output,
       cc.mcp,
       cc.api_key,
       cc.config_version,
       cc.expressions
     FROM calculators c
     JOIN calculator_configs cc
       ON cc.calculator = c.id
      AND cc.test_environment = $2
     WHERE c.id = $1
       AND c.activated = true`,
    [calcId, isTest],
  );

  if (!row) return null;

  // Check expiry (simplified — exempt accounts are handled by CMS; here we
  // skip expiry for service-to-service reads to preserve current behaviour
  // where formula-api trusts the recipe if it's activated)
  if (isTest) {
    if (row.test_expires_at && new Date(row.test_expires_at) < new Date()) return null;
  } else {
    if (row.activation_expires_at && new Date(row.activation_expires_at) < new Date()) return null;
  }

  return {
    sheets: row.sheets,
    formulas: row.formulas,
    inputSchema: row.input,
    outputSchema: row.output,
    dataMappings: [],
    locale: null,
    generation: 0,
    name: isTest ? `${calcId}-test` : calcId,
    version: String(row.config_version ?? 1),
    description: row.description ?? null,
    test: isTest || null,
    token: row.api_key || null,
    accountId: row.account_id || null,
    mcp: row.mcp || null,
    expressions: row.expressions?.length ? row.expressions : undefined,
  };
}

/**
 * Load MCP config for a calculator.
 * Returns the mcp JSON object from calculator_configs, or null.
 */
export async function loadMcpConfigFromDb(id) {
  const isTest = id.endsWith('-test');
  const calcId = isTest ? id.slice(0, -5) : id;

  const row = await queryOne(
    `SELECT cc.mcp, cc.input
     FROM calculator_configs cc
     JOIN calculators c ON c.id = cc.calculator
     WHERE c.id = $1
       AND cc.test_environment = $2
       AND c.activated = true`,
    [calcId, isTest],
  );

  if (!row) return null;
  return row.mcp ?? null;
}

/**
 * Load account rate limits from direct DB.
 * Returns same shape as Admin API GET /accounts/:accountId:
 *   { rateLimitRps, rateLimitMonthly, monthlyUsed }
 *
 * Reads the calculators-module subscription joined with its plan. RPS comes
 * from sp.rps_allowance (single source of truth; migration 038).
 *   v1 s.account → v2 s.account_id
 *   v1 s.plan    → v2 s.subscription_plan_id
 */
export async function loadAccountLimitsFromDb(accountId) {
  const sub = await queryOne(
    `SELECT sp.request_allowance AS "rateLimitMonthly",
            sp.rps_allowance     AS "rateLimitRps"
     FROM subscriptions s
     JOIN subscription_plans sp ON sp.id = s.subscription_plan_id
     WHERE s.account_id = $1
       AND s.module = 'calculators'
       AND s.status NOT IN ('canceled', 'expired')
     ORDER BY s.date_created DESC
     LIMIT 1`,
    [accountId],
  );

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const usageRow = await queryOne(
    `SELECT COUNT(*) AS count
     FROM calculator_calls
     WHERE account = $1
       AND timestamp >= $2`,
    [accountId, firstOfMonth],
  );

  return {
    rateLimitRps: sub?.rateLimitRps ?? null,
    rateLimitMonthly: sub?.rateLimitMonthly ?? null,
    monthlyUsed: parseInt(usageRow?.count ?? '0', 10),
  };
}

/**
 * Fetch calculator_configs row metadata needed to write to calculator_slots.
 * Returns { configId, accountId, fileVersion, configVersion } or null.
 *
 * calculatorStringId is the VARCHAR PK of public.calculators (not the UUID).
 *
 * Uniqueness invariant: there must be at most one non-test calculator_configs
 * row per calculator. If multiple rows exist we throw loudly — this is a data
 * integrity violation that should surface immediately rather than being masked
 * by silent LIMIT 1 picking.
 */
export async function loadCalculatorConfigMeta(calculatorStringId) {
  const rows = await queryAll(
    `SELECT cc.id           AS config_id,
            c.account       AS account_id,
            cc.file_version,
            cc.config_version
     FROM calculator_configs cc
     JOIN calculators c ON c.id = cc.calculator
     WHERE c.id = $1
       AND cc.test_environment = false
     ORDER BY cc.date_created DESC`,
    [calculatorStringId],
  );
  if (!rows || rows.length === 0) return null;
  if (rows.length > 1) {
    throw new Error(
      `loadCalculatorConfigMeta: multiple non-test configs for calculator '${calculatorStringId}' (found ${rows.length}). Data integrity violation.`,
    );
  }
  const row = rows[0];
  return {
    configId: row.config_id,
    accountId: row.account_id,
    fileVersion: row.file_version ?? null,
    configVersion: row.config_version ?? null,
  };
}

/**
 * List all published calculators with MCP config for a given account.
 * Used for Account MCP tool listing.
 */
export async function listAccountMcpCalculators(accountId) {
  return queryAll(
    `SELECT c.id, c.name, cc.mcp, cc.input
     FROM calculators c
     JOIN calculator_configs cc ON cc.calculator = c.id
     WHERE c.account = $1
       AND c.activated = true
       AND cc.test_environment = false
       AND cc.mcp IS NOT NULL
       AND cc.mcp::text != 'null'`,
    [accountId],
  );
}
