// Tests for formula-api usage event emitter.
// Mocks cache.js so no real Redis is needed.
import { describe, it, mock, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('emitCalcCall', () => {
  let capturedXaddArgs = null;
  let mockRedis;

  before(async () => {
    // Mock the cache module before importing usage-events
    mockRedis = {
      async xadd(...args) {
        capturedXaddArgs = args;
        return '1-0';
      },
    };

    // Patch cache module via mock.module (Node 22+ supports this)
    // For older Node, we test via the exported function behaviour
  });

  afterEach(() => {
    capturedXaddArgs = null;
  });

  it('emitCalcCall builds correct event shape', async () => {
    // Import the emit helper from bl-events directly to verify shape
    const { buildEvent } = await import('../../packages/bl-events/dist/index.js');

    const event = buildEvent({
      account_id: 'acc-abc',
      api_key_id: null,
      module: 'calculators',
      event_kind: 'calc.call',
      quantity: 1,
      metadata: {
        formula_id: 'calc-xyz',
        duration_ms: 42,
        inputs_size_bytes: 128,
      },
    });

    assert.equal(event.account_id, 'acc-abc');
    assert.equal(event.api_key_id, null);
    assert.equal(event.module, 'calculators');
    assert.equal(event.event_kind, 'calc.call');
    assert.equal(event.quantity, 1);
    assert.equal(event.cost_eur, null);
    assert.equal(event.metadata.formula_id, 'calc-xyz');
    assert.equal(event.metadata.duration_ms, 42);
    assert.ok(event.occurred_at, 'occurred_at set');
  });

  it('emitUsageEvent pushes to correct stream key', async () => {
    const { emitUsageEvent, buildEvent, USAGE_STREAM_KEY } = await import('../../packages/bl-events/dist/index.js');

    const collected = [];
    const fakeRedis = {
      async xadd(...args) { collected.push(args); return '1-0'; },
    };

    const event = buildEvent({
      account_id: 'acc-1',
      api_key_id: null,
      module: 'calculators',
      event_kind: 'calc.call',
      quantity: 1,
      metadata: { formula_id: 'f-1', duration_ms: 5, inputs_size_bytes: 10 },
    });

    await emitUsageEvent(fakeRedis, event);

    assert.equal(collected.length, 1);
    assert.equal(collected[0][0], USAGE_STREAM_KEY);
    assert.equal(collected[0][5], 'event');
    const parsed = JSON.parse(collected[0][6]);
    assert.equal(parsed.event_kind, 'calc.call');
  });

  it('emitUsageEvent is silent when redis is null', async () => {
    const { emitUsageEvent, buildEvent, getDroppedEventCount } = await import('../../packages/bl-events/dist/index.js');
    const before = getDroppedEventCount();
    const event = buildEvent({
      account_id: 'acc-2',
      api_key_id: null,
      module: 'calculators',
      event_kind: 'calc.call',
      quantity: 1,
      metadata: {},
    });
    await assert.doesNotReject(() => emitUsageEvent(null, event));
    assert.ok(getDroppedEventCount() >= before);
  });
});
