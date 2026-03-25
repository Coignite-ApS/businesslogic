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

    // Parse API key permissions (e.g. {"ai":true,"calc":true,"flow":false})
    const permHeader = req.headers['x-api-permissions'];
    if (permHeader) {
      try { req.permissions = JSON.parse(permHeader); } catch { req.permissions = {}; }
    } else {
      req.permissions = {};
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

/** Check subscription status and AI quota */
export async function checkAiQuota(accountId) {
  if (!accountId) return { allowed: false, reason: 'No account' };

  // Check exemption
  const account = await queryOne(
    'SELECT exempt_from_subscription FROM account WHERE id = $1',
    [accountId],
  );
  if (account?.exempt_from_subscription) {
    return { allowed: true, queriesLimit: null, queriesUsed: 0, periodStart: new Date(), periodEnd: new Date(), allowedModels: null };
  }

  // Get subscription + plan
  const sub = await queryOne(
    `SELECT s.status, s.current_period_start, s.current_period_end, s.trial_start, s.trial_end,
            sp.ai_queries_per_month, sp.ai_allowed_models
     FROM subscriptions s
     JOIN subscription_plans sp ON sp.id = s.plan
     WHERE s.account = $1 AND s.status NOT IN ('canceled', 'expired')
     LIMIT 1`,
    [accountId],
  );

  if (!sub) return { allowed: false, reason: 'No active subscription' };

  const limit = sub.ai_queries_per_month;

  // 0 = no AI access
  if (limit === 0) return { allowed: false, reason: "Plan doesn't include AI" };

  // Determine billing period
  const { periodStart, periodEnd } = getBillingPeriod(sub);

  // null = unlimited
  if (limit === null || limit === undefined) {
    return {
      allowed: true,
      queriesLimit: null,
      queriesUsed: 0,
      periodStart,
      periodEnd,
      allowedModels: sub.ai_allowed_models || null,
    };
  }

  // Count queries in current period
  const usage = await queryOne(
    'SELECT COUNT(*) as count FROM ai_token_usage WHERE account = $1 AND date_created >= $2',
    [accountId, periodStart.toISOString()],
  );
  const used = parseInt(usage?.count || '0', 10);

  if (used >= limit) {
    return { allowed: false, reason: `AI query limit reached (${used}/${limit})`, queriesUsed: used, queriesLimit: limit, periodStart, periodEnd };
  }

  return {
    allowed: true,
    queriesLimit: limit,
    queriesUsed: used,
    periodStart,
    periodEnd,
    allowedModels: sub.ai_allowed_models || null,
  };
}

function getBillingPeriod(sub) {
  if (sub.current_period_start && sub.current_period_end) {
    return { periodStart: new Date(sub.current_period_start), periodEnd: new Date(sub.current_period_end) };
  }
  if (sub.status === 'trialing' && sub.trial_start) {
    const start = new Date(sub.trial_start);
    const end = new Date(start);
    end.setDate(end.getDate() + 30);
    return { periodStart: start, periodEnd: end };
  }
  const now = new Date();
  return {
    periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
    periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}
