import type { UsageEventEnvelope } from './types.js';

export const USAGE_STREAM_KEY = 'bl:usage_events:in';

/** Approximate stream cap — fast MAXLEN trim to avoid unbounded memory. */
const STREAM_MAXLEN = 100_000;

/** In-memory count of events dropped due to Redis unavailability. */
let droppedEventCount = 0;

export function getDroppedEventCount(): number {
  return droppedEventCount;
}

/**
 * Minimal Redis interface — accepts ioredis client or any object that
 * exposes xadd(key, ...args). Kept narrow so the package doesn't need
 * ioredis as a runtime dependency.
 */
export interface RedisStreamClient {
  xadd(key: string, maxlen: string, threshold: number, id: string, ...fieldValues: string[]): Promise<unknown>;
  status?: string;
}

/**
 * Push one usage event to the Redis stream.
 *
 * Fire-and-forget semantics: catches all errors and logs WARN.
 * Never throws — hot-path callers must never fail due to telemetry.
 */
export async function emitUsageEvent(
  redis: RedisStreamClient | null | undefined,
  event: UsageEventEnvelope,
): Promise<void> {
  if (!redis) {
    droppedEventCount++;
    console.warn('[bl-events] Redis unavailable — usage event dropped', event.event_kind, 'dropped_total:', droppedEventCount);
    return;
  }

  try {
    const payload = JSON.stringify(event);
    // XADD with approximate MAXLEN for backpressure
    // ioredis XADD signature: key, MAXLEN, ~, count, id, field, value, ...
    await (redis as any).xadd(
      USAGE_STREAM_KEY,
      'MAXLEN',
      '~',
      STREAM_MAXLEN,
      '*',
      'event',
      payload,
    );
  } catch (err: unknown) {
    droppedEventCount++;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[bl-events] emit failed — event dropped', event.event_kind, msg, 'dropped_total:', droppedEventCount);
  }
}

/**
 * Build a UsageEventEnvelope with current timestamp.
 */
export function buildEvent(
  fields: Omit<UsageEventEnvelope, 'cost_eur' | 'occurred_at'>,
): UsageEventEnvelope {
  return {
    ...fields,
    cost_eur: null,
    occurred_at: new Date().toISOString(),
  };
}
