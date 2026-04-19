// Tests for @coignite/bl-events emit helper.
// Uses a mock Redis client — no real Redis required.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// Import from dist (built)
import {
  emitUsageEvent,
  buildEvent,
  USAGE_STREAM_KEY,
  getDroppedEventCount,
} from '../dist/index.js';

describe('emitUsageEvent', () => {
  let capturedArgs;

  const mockRedis = {
    async xadd(...args) {
      capturedArgs = args;
      return '1-0';
    },
  };

  before(() => {
    capturedArgs = null;
  });

  it('pushes event JSON to bl:usage_events:in stream', async () => {
    const event = buildEvent({
      account_id: 'acc-123',
      api_key_id: null,
      module: 'calculators',
      event_kind: 'calc.call',
      quantity: 1,
      metadata: { formula_id: 'f-abc', duration_ms: 12 },
    });

    await emitUsageEvent(mockRedis, event);

    assert.ok(capturedArgs, 'xadd should have been called');
    assert.equal(capturedArgs[0], USAGE_STREAM_KEY);
    assert.equal(capturedArgs[1], 'MAXLEN');
    assert.equal(capturedArgs[2], '~');
    assert.equal(capturedArgs[3], 100_000);
    assert.equal(capturedArgs[4], '*');
    assert.equal(capturedArgs[5], 'event');

    const parsed = JSON.parse(capturedArgs[6]);
    assert.equal(parsed.account_id, 'acc-123');
    assert.equal(parsed.event_kind, 'calc.call');
    assert.equal(parsed.cost_eur, null);
    assert.ok(parsed.occurred_at, 'occurred_at must be set');
  });

  it('does not throw when redis is null', async () => {
    const before = getDroppedEventCount();
    const event = buildEvent({
      account_id: 'acc-999',
      api_key_id: null,
      module: 'kb',
      event_kind: 'kb.search',
      quantity: 1,
      metadata: { kb_id: 'kb-1', query: 'test' },
    });
    await emitUsageEvent(null, event);
    assert.ok(getDroppedEventCount() > before, 'dropped count should increment');
  });

  it('does not throw when redis xadd throws', async () => {
    const failRedis = {
      async xadd() { throw new Error('connection refused'); },
    };
    const before = getDroppedEventCount();
    const event = buildEvent({
      account_id: 'acc-777',
      api_key_id: 'key-1',
      module: 'ai',
      event_kind: 'ai.message',
      quantity: 100,
      metadata: { model: 'claude-3', input_tokens: 50, output_tokens: 50 },
    });
    await emitUsageEvent(failRedis, event);
    assert.ok(getDroppedEventCount() > before, 'dropped count should increment on error');
  });

  it('buildEvent sets cost_eur=null and occurred_at', () => {
    const event = buildEvent({
      account_id: 'acc-1',
      api_key_id: 'key-2',
      module: 'flows',
      event_kind: 'flow.execution',
      quantity: 1,
      metadata: { flow_id: 'fl-x', duration_ms: 500, status: 'completed' },
    });
    assert.equal(event.cost_eur, null);
    assert.ok(event.occurred_at.endsWith('Z'), 'occurred_at should be UTC ISO 8601');
  });
});
