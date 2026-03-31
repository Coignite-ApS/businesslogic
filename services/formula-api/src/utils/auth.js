import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';

export function safeTokenCompare(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function checkAdminToken(req) {
  if (!config.adminToken) {
    return { code: 401, body: { error: 'Admin access not configured' } };
  }
  const provided = req.headers['x-admin-token'];
  if (!provided) {
    return { code: 401, body: { error: 'Missing X-Admin-Token header' } };
  }
  if (!safeTokenCompare(provided, config.adminToken)) {
    return { code: 403, body: { error: 'Invalid admin token' } };
  }
  return null;
}

// --- Formula token validation (via Directus endpoint) ---

const tokenCache = new Map();
const VALID_TTL = 600_000;    // 10min
const INVALID_TTL = 60_000;   // 1min

// Auto-seed test token from env (dev/test only)
if (process.env.FORMULA_TEST_TOKEN) {
  tokenCache.set(process.env.FORMULA_TEST_TOKEN, {
    valid: true,
    accountId: process.env.TEST_ACCOUNT_ID || 'test-account',
    label: 'test-token',
    cachedAt: Date.now(),
  });
}

export async function validateFormulaToken(token) {
  if (!token) return null;

  // Check cache
  const cached = tokenCache.get(token);
  if (cached) {
    const ttl = cached.valid ? VALID_TTL : INVALID_TTL;
    if (Date.now() - cached.cachedAt < ttl) {
      return cached.valid ? { accountId: cached.accountId, label: cached.label } : null;
    }
    tokenCache.delete(token);
  }

  // No admin API configured → deny
  if (!config.adminApiUrl || !config.adminApiKey) return null;

  try {
    const url = `${config.adminApiUrl}/management/calc/validate-token?token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.adminApiKey}` },
    });

    if (!res.ok) {
      tokenCache.set(token, { valid: false, cachedAt: Date.now() });
      return null;
    }

    const data = await res.json();
    if (!data.valid) {
      tokenCache.set(token, { valid: false, cachedAt: Date.now() });
      return null;
    }

    const entry = {
      valid: true,
      accountId: data.account_id,
      label: data.label || null,
      cachedAt: Date.now(),
    };
    tokenCache.set(token, entry);
    return { accountId: entry.accountId, label: entry.label };
  } catch (err) {
    // Network error: fail closed, don't cache (allow immediate retry)
    logger.warn({ err: err.message }, '[auth] formula token validation failed');
    return null;
  }
}

// Test helper: seed a token into cache without Directus
export function _seedTokenCache(token, accountId) {
  tokenCache.set(token, { valid: true, accountId, label: 'test', cachedAt: Date.now() });
}

// --- Gateway authentication ---

const GATEWAY_TIMESTAMP_MAX_AGE = 30_000; // 30 seconds

/**
 * Check if request came through the gateway (has valid HMAC signature).
 */
export function isGatewayRequest(req) {
  return req.headers['x-gateway-auth'] === 'true' && !!req.headers['x-gateway-signature'];
}

/**
 * Validate gateway-forwarded request using HMAC-SHA256 signature.
 * Returns { accountId, keyId, permissions } on success, null on failure.
 */
export function validateGatewayAuth(req) {
  const secret = config.gatewaySharedSecret;
  if (!secret) {
    logger.warn('[auth] GATEWAY_SHARED_SECRET not configured');
    return null;
  }

  const signature = req.headers['x-gateway-signature'];
  const timestamp = req.headers['x-gateway-timestamp'];
  const accountId = req.headers['x-account-id'];
  const keyId = req.headers['x-api-key-id'];

  if (!signature || !timestamp || !accountId) {
    return null;
  }

  // Replay protection
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > GATEWAY_TIMESTAMP_MAX_AGE) {
    logger.warn({ diff: Date.now() - ts }, '[auth] gateway timestamp too old or invalid');
    return null;
  }

  // Verify HMAC
  const payload = `${accountId}|${keyId || ''}|${timestamp}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  if (!safeTokenCompare(signature, expected)) {
    logger.warn('[auth] gateway signature mismatch');
    return null;
  }

  // Parse permissions
  let permissions = {};
  try {
    if (req.headers['x-api-permissions']) {
      permissions = JSON.parse(req.headers['x-api-permissions']);
    }
  } catch { /* ignore */ }

  return { accountId, keyId, permissions };
}
