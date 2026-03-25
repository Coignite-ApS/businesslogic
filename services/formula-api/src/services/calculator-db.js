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
 */
export async function loadAccountLimitsFromDb(accountId) {
  // Fetch subscription plan limits
  const sub = await queryOne(
    `SELECT sp.calls_per_second AS "rateLimitRps",
            sp.calls_per_month  AS "rateLimitMonthly"
     FROM subscriptions s
     JOIN subscription_plans sp ON sp.id = s.plan
     WHERE s.account = $1
       AND s.status = 'active'
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
    rateLimitRps: sub?.rateLimitRps ?? null,
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
