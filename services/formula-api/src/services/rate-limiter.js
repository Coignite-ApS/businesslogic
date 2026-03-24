import { getRedisClient, isRedisReady } from './cache.js';
import { redisWarn } from '../utils/redis-warn.js';

const accounts = new Map();

const RECORD_SCRIPT = `
local rps = redis.call('INCR', KEYS[1])
if rps == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local mo = redis.call('INCR', KEYS[2])
if mo == 1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
return {rps, mo}
`;

const RPS_TTL = 2; // seconds
const MONTHLY_TTL = 3024000; // 35 days

function monthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function configure(accountId, { rateLimitRps, rateLimitMonthly, monthlyUsed }) {
  accounts.set(accountId, {
    rps: rateLimitRps || 0,
    monthly: rateLimitMonthly || 0,
    rpsCount: 0,
    rpsWindow: Date.now(),
    monthlyCount: monthlyUsed || 0,
    month: new Date().getMonth(),
  });

  // Seed Redis monthly counter (NX = only if key doesn't exist yet)
  if (isRedisReady() && monthlyUsed) {
    const redis = getRedisClient();
    const mk = `rl:mo:${accountId}:${monthKey()}`;
    redis.set(mk, String(monthlyUsed), 'EX', MONTHLY_TTL, 'NX').catch((e) => redisWarn('rateLimiter.configure', e));
  }
}

export async function check(accountId) {
  if (!accountId) return { allowed: true };
  const a = accounts.get(accountId);
  if (!a) return { allowed: true };

  // Try Redis for shared counters
  if (isRedisReady()) {
    try {
      const redis = getRedisClient();
      const sec = Math.floor(Date.now() / 1000);
      const rpsKey = `rl:rps:${accountId}:${sec}`;
      const moKey = `rl:mo:${accountId}:${monthKey()}`;
      const [rpsCount, moCount] = await redis.mget(rpsKey, moKey);

      if (a.rps > 0 && parseInt(rpsCount || '0', 10) >= a.rps) {
        return { allowed: false, reason: 'rps', retryAfter: 1 };
      }
      if (a.monthly > 0 && parseInt(moCount || '0', 10) >= a.monthly) {
        return { allowed: false, reason: 'monthly' };
      }
      return { allowed: true };
    } catch {
      // Fall through to in-memory
    }
  }

  // In-memory fallback
  const now = Date.now();

  if (a.rps > 0) {
    if (now - a.rpsWindow >= 1000) {
      a.rpsCount = 0;
      a.rpsWindow = now;
    }
    if (a.rpsCount >= a.rps) {
      return { allowed: false, reason: 'rps', retryAfter: 1 };
    }
  }

  if (a.monthly > 0) {
    const currentMonth = new Date().getMonth();
    if (currentMonth !== a.month) {
      a.monthlyCount = 0;
      a.month = currentMonth;
    }
    if (a.monthlyCount >= a.monthly) {
      return { allowed: false, reason: 'monthly' };
    }
  }

  return { allowed: true };
}

export function record(accountId) {
  if (!accountId) return;
  const a = accounts.get(accountId);
  if (!a) return;

  // In-memory (always maintained as fallback)
  const now = Date.now();
  if (now - a.rpsWindow >= 1000) {
    a.rpsCount = 0;
    a.rpsWindow = now;
  }
  a.rpsCount++;

  const currentMonth = new Date().getMonth();
  if (currentMonth !== a.month) {
    a.monthlyCount = 0;
    a.month = currentMonth;
  }
  a.monthlyCount++;

  // Redis (fire-and-forget)
  if (isRedisReady()) {
    try {
      const redis = getRedisClient();
      const sec = Math.floor(Date.now() / 1000);
      const rpsKey = `rl:rps:${accountId}:${sec}`;
      const moKey = `rl:mo:${accountId}:${monthKey()}`;
      redis.eval(RECORD_SCRIPT, 2, rpsKey, moKey, String(RPS_TTL), String(MONTHLY_TTL)).catch((e) => redisWarn('rateLimiter.record', e));
    } catch { /* silent */ }
  }
}

export function has(accountId) {
  return accounts.has(accountId);
}

export function remove(accountId) {
  accounts.delete(accountId);
}
