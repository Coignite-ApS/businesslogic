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
 * v2 NOTE: pricing_v2 schema renamed columns and scopes subscriptions per
 * (account, module). For Formula API rate limiting we read the calculators-
 * module subscription only.
 *   v1 sp.calls_per_month   → v2 sp.request_allowance
 *   v1 sp.calls_per_second  → derived from sp.tier (transitional; v2 spec
 *                             hasn't decided whether RPS is per-tier or
 *                             per-API-key; defaults below match the CMS-side
 *                             rpsForTier() helper in _shared/v2-subscription.ts).
 *   v1 s.account            → v2 s.account_id
 *   v1 s.plan               → v2 s.subscription_plan_id
 */
function rpsForTier(tier) {
  // Keep in sync with services/cms/extensions/local/_shared/v2-subscription.ts.
  switch (tier) {
    case 'starter': return 10;
    case 'growth': return 50;
    case 'scale': return 200;
    case 'enterprise': return null;
    default: return null;
  }
}

export async function loadAccountLimitsFromDb(accountId) {
  // Fetch the calculators-module subscription joined with its plan allowances.
  const sub = await queryOne(
    `SELECT sp.request_allowance AS "rateLimitMonthly",
            sp.tier              AS tier
     FROM subscriptions s
     JOIN subscription_plans sp ON sp.id = s.subscription_plan_id
     WHERE s.account_id = $1
       AND s.module = 'calculators'
       AND s.status NOT IN ('canceled', 'expired')
     ORDER BY s.date_created DESC
     LIMIT 1`,
    [accountId],
  );

  // Count calls this month for monthly usage
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
    rateLimitRps: sub ? rpsForTier(sub.tier) : null,
    rateLimitMonthly: sub?.rateLimitMonthly ?? null,
    monthlyUsed: parseInt(usageRow?.count ?? '0', 10),
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
