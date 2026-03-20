/** In-memory sliding window rate limiter (per-user) */

const store = new Map();

// Cleanup stale entries every 5 minutes
let cleanupInterval = null;

export function startCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter(t => now - t < 120_000);
      if (entry.timestamps.length === 0) store.delete(key);
    }
  }, 300_000);
  cleanupInterval.unref();
}

export function stopCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export function checkRateLimit(userId, limitPerMinute) {
  const key = `ai:${userId}`;
  const now = Date.now();
  const windowMs = 60_000;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

  if (entry.timestamps.length >= limitPerMinute) {
    const oldest = entry.timestamps[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.timestamps.push(now);
  return { allowed: true };
}
