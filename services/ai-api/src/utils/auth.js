import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { queryOne } from '../db.js';

/** Timing-safe string comparison via hash */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

const GATEWAY_TIMESTAMP_MAX_AGE = 30_000; // 30 seconds

/**
 * Validate HMAC signature on gateway-forwarded requests.
 * Returns true if valid, false otherwise.
 */
export function validateGatewaySignature(req) {
  const secret = config.gatewaySharedSecret;
  if (!secret) return false;

  const signature = req.headers['x-gateway-signature'];
  const timestamp = req.headers['x-gateway-timestamp'];
  const accountId = req.headers['x-account-id'];
  const keyId = req.headers['x-api-key-id'] || '';

  if (!signature || !timestamp || !accountId) return false;

  // Replay protection
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > GATEWAY_TIMESTAMP_MAX_AGE) return false;

  // Verify HMAC
  const payload = `${accountId}|${keyId}|${timestamp}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  return safeCompare(signature, expected);
}

/**
 * Normalize gateway permissions from nested format to flat format.
 * Input:  {"services":{"ai":{"enabled":true,...},"calc":{"enabled":true,...}}}
 * Output: {"ai":true,"calc":true}
 * Also accepts flat format as-is: {"ai":true} → {"ai":true}
 */
export function normalizePermissions(raw) {
  if (!raw || typeof raw !== 'object') return {};
  // Nested gateway v2 format
  if (raw.services && typeof raw.services === 'object') {
    const flat = {};
    for (const [svc, perm] of Object.entries(raw.services)) {
      flat[svc] = perm?.enabled === true;
    }
    return flat;
  }
  // Already flat format
  return raw;
}

/**
 * Verify authentication — supports:
 * 1. X-Admin-Token (internal service-to-service)
 * 2. X-Gateway-Auth + HMAC signature (gateway-forwarded public API)
 */
export async function verifyAuth(req, reply) {
  const adminToken = req.headers['x-admin-token'];
  const gatewayAuth = req.headers['x-gateway-auth'];

  if (config.adminToken && adminToken && safeCompare(adminToken, config.adminToken)) {
    req.authType = 'admin';
    req.accountId = req.headers['x-account-id'] || null;
    req.userId = req.headers['x-user-id'] || null;
    req.isAdmin = true;
    req.isPublicRequest = false;
    return;
  }

  if (gatewayAuth) {
    // Verify HMAC signature when secret is configured
    if (config.gatewaySharedSecret) {
      if (!validateGatewaySignature(req)) {
        return reply.code(401).send({ error: 'Invalid or expired gateway signature', code: 'UNAUTHORIZED' });
      }
    }

    req.authType = 'gateway';
    req.accountId = req.headers['x-account-id'] || null;
    req.apiKeyId = req.headers['x-api-key-id'] || null;
    req.userId = req.headers['x-user-id'] || null;
    req.isAdmin = req.headers['x-is-admin'] === 'true';

    // Parse API key permissions
    // Gateway sends nested format: {"services":{"ai":{"enabled":true,...},"kb":{"enabled":true,"resources":[...]}}}
    // req.permissions = flat format for existing checks (ai:true/false)
    // req.permissionsRaw = full nested structure for resource-level scoping
    const permHeader = req.headers['x-api-permissions'];
    if (permHeader) {
      try {
        const raw = JSON.parse(permHeader);
        req.permissions = normalizePermissions(raw);
        req.permissionsRaw = raw;
      } catch { req.permissions = {}; req.permissionsRaw = null; }
    } else {
      req.permissions = {};
      req.permissionsRaw = null;
    }

    // Public request = gateway-forwarded + not admin
    req.isPublicRequest = !req.isAdmin;
    return;
  }

  reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
}

/** Get active account ID for a user */
export async function getActiveAccount(userId) {
  if (!userId) return null;
  const row = await queryOne(
    'SELECT active_account FROM directus_users WHERE id = $1',
    [userId],
  );
  return row?.active_account || null;
}

/**
 * Check whether the account is allowed to make AI calls.
 *
 * v2 NOTE: per-tier monthly query quotas (`sp.ai_queries_per_month`) and
 * per-tier model allowlists (`sp.ai_allowed_models`) were removed. AI access
 * is now metered against the per-account `ai_wallet.balance_eur`. If the
 * balance is ≤ 0, AI calls are blocked. The actual €-cost debit happens
 * after the call completes (task 18).
 *
 * Return shape preserved (`queriesLimit`, `queriesUsed`, `periodStart`,
 * `periodEnd`, `allowedModels`) so existing callers continue to work — but
 * the meaningful field is now `walletBalanceEur` / the boolean `allowed`.
 */
export async function checkAiQuota(accountId) {
  if (!accountId) return { allowed: false, reason: 'No account' };

  // Check exemption
  const account = await queryOne(
    'SELECT exempt_from_subscription FROM account WHERE id = $1',
    [accountId],
  );

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  if (account?.exempt_from_subscription) {
    return {
      allowed: true,
      queriesLimit: null,
      queriesUsed: 0,
      periodStart,
      periodEnd,
      allowedModels: null,
      walletBalanceEur: Number.POSITIVE_INFINITY,
      walletMonthlyCapEur: null,
    };
  }

  // v2: AI Wallet balance gate. Wallet row is created on signup with €5 promo
  // credit; missing rows for legacy accounts are treated as zero balance.
  const wallet = await queryOne(
    `SELECT balance_eur, monthly_cap_eur, auto_reload_enabled
     FROM ai_wallet
     WHERE account_id = $1`,
    [accountId],
  );

  const balance = wallet ? parseFloat(wallet.balance_eur) || 0 : 0;
  const cap = wallet?.monthly_cap_eur != null ? parseFloat(wallet.monthly_cap_eur) : null;

  if (balance <= 0) {
    return {
      allowed: false,
      reason: 'AI Wallet balance is empty. Top up to continue using the AI Assistant.',
      queriesLimit: null,
      queriesUsed: 0,
      periodStart,
      periodEnd,
      allowedModels: null,
      walletBalanceEur: balance,
      walletMonthlyCapEur: cap,
    };
  }

  return {
    allowed: true,
    queriesLimit: null,
    queriesUsed: 0,
    periodStart,
    periodEnd,
    allowedModels: null,
    walletBalanceEur: balance,
    walletMonthlyCapEur: cap,
  };
}
