import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { getAllSnapshots } from './health-push.js';

let instances = []; // sorted by instanceId: [{ instanceId, internalUrl }]
let selfIndex = -1;
let timer = null;

// Jump consistent hash (Google, 2014)
// Maps a key to a bucket index in [0, numBuckets)
// Monotone: when numBuckets changes N→N+1, only ~1/(N+1) keys move
function jumpHash(key, numBuckets) {
  // Use first 8 bytes of SHA-256 as 64-bit seed
  const hash = createHash('sha256').update(key).digest();
  let h = hash.readBigUInt64BE(0);

  let b = -1n;
  let j = 0n;
  const nb = BigInt(numBuckets);

  while (j < nb) {
    b = j;
    h = (h * 2862933555777941757n + 1n) & 0xFFFFFFFFFFFFFFFFn;
    j = BigInt(Math.floor(Number(b + 1n) * (Number(1n << 31n) / Number((h >> 33n) + 1n))));
  }

  return Number(b);
}

export function refresh() {
  // Synchronous version — called after getAllSnapshots resolves
}

export async function refreshAsync() {
  if (!config.internalUrl) return; // routing disabled
  try {
    const snapshots = await getAllSnapshots();
    const list = [];

    for (const snap of Object.values(snapshots)) {
      if (!snap.internalUrl) continue;
      list.push({ instanceId: snap.instanceId, internalUrl: snap.internalUrl });
    }

    // Ensure self is always in the list
    const selfPresent = list.some(i => i.instanceId === config.instanceId);
    if (!selfPresent) {
      list.push({ instanceId: config.instanceId, internalUrl: config.internalUrl });
    }

    // Sort by instanceId for deterministic ordering
    list.sort((a, b) => a.instanceId.localeCompare(b.instanceId));

    instances = list;
    selfIndex = instances.findIndex(i => i.instanceId === config.instanceId);
  } catch { /* keep previous ring on failure */ }
}

export function getOwner(calculatorId) {
  if (instances.length === 0) return null;
  const idx = jumpHash(calculatorId, instances.length);
  return instances[idx];
}

export function isSelf(calculatorId) {
  if (instances.length === 0) return true; // no ring = handle locally
  const idx = jumpHash(calculatorId, instances.length);
  return idx === selfIndex;
}

export function getInstances() {
  return instances;
}

export function start() {
  if (!config.internalUrl) return; // routing disabled without INTERNAL_URL
  // Initial refresh, then periodic
  refreshAsync();
  timer = setInterval(refreshAsync, config.hashRingRefreshInterval);
  timer.unref();
}

export function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
