// Tests for ai-api usage event emitters.
// Imports from the inlined local module — no external package.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  emitUsageEvent,
  buildEvent,
  USAGE_STREAM_KEY,
  getDroppedEventCount,
  publishGatewayCacheInvalidation,
  GW_AI_SPEND_CHANNEL,
} from '../src/services/usage-events.js';

describe('ai-api usage events', () => {
  it('kb.search event shape is correct', async () => {
    const collected = [];
    const fakeRedis = {
      async xadd(...args) { collected.push(args); return '1-0'; },
    };

    const event = buildEvent({
      account_id: 'acc-aa',
      api_key_id: 'key-bb',
      module: 'kb',
      event_kind: 'kb.search',
      quantity: 1,
      metadata: { kb_id: 'kb-1', query: 'test query', results_count: 5 },
    });

    await emitUsageEvent(fakeRedis, event);

    assert.equal(collected.length, 1);
    assert.equal(collected[0][0], USAGE_STREAM_KEY);
    const parsed = JSON.parse(collected[0][6]);
    assert.equal(parsed.event_kind, 'kb.search');
    assert.equal(parsed.module, 'kb');
    assert.equal(parsed.cost_eur, null);
    assert.equal(parsed.metadata.results_count, 5);
  });

  it('kb.ask event includes input/output tokens', async () => {
    const collected = [];
    const fakeRedis = {
      async xadd(...args) { collected.push(args); return '1-0'; },
    };

    const event = buildEvent({
      account_id: 'acc-aa',
      api_key_id: null,
      module: 'kb',
      event_kind: 'kb.ask',
      quantity: 1,
      metadata: { kb_id: 'kb-2', query: 'what is X?', model: 'claude-3-5-haiku-20241022', input_tokens: 100, output_tokens: 50 },
    });

    await emitUsageEvent(fakeRedis, event);
    const parsed = JSON.parse(collected[0][6]);
    assert.equal(parsed.event_kind, 'kb.ask');
    assert.equal(parsed.metadata.input_tokens, 100);
    assert.equal(parsed.metadata.output_tokens, 50);
  });

  it('ai.message quantity equals total tokens', async () => {
    const collected = [];
    const fakeRedis = {
      async xadd(...args) { collected.push(args); return '1-0'; },
    };

    const event = buildEvent({
      account_id: 'acc-cc',
      api_key_id: null,
      module: 'ai',
      event_kind: 'ai.message',
      quantity: 150, // 100 input + 50 output
      metadata: { model: 'claude-opus-4-5', conversation_id: 'conv-1', input_tokens: 100, output_tokens: 50 },
    });

    await emitUsageEvent(fakeRedis, event);
    const parsed = JSON.parse(collected[0][6]);
    assert.equal(parsed.quantity, 150);
    assert.equal(parsed.event_kind, 'ai.message');
  });

  it('embed.tokens event carries token count as quantity', async () => {
    const collected = [];
    const fakeRedis = {
      async xadd(...args) { collected.push(args); return '1-0'; },
    };

    const event = buildEvent({
      account_id: 'acc-dd',
      api_key_id: null,
      module: 'kb',
      event_kind: 'embed.tokens',
      quantity: 3000,
      metadata: { model: 'text-embedding-3-small', kb_id: 'kb-3', doc_id: 'doc-99' },
    });

    await emitUsageEvent(fakeRedis, event);
    const parsed = JSON.parse(collected[0][6]);
    assert.equal(parsed.quantity, 3000);
    assert.equal(parsed.event_kind, 'embed.tokens');
  });

  it('publishGatewayCacheInvalidation publishes to ai_spend channel', async () => {
    const published = [];
    const fakeRedis = {
      async publish(channel, payload) { published.push({ channel, payload }); return 1; },
    };

    await publishGatewayCacheInvalidation(fakeRedis, 'ai_spend', 'key-uuid-123');
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, GW_AI_SPEND_CHANNEL);
    assert.equal(published[0].payload, 'key-uuid-123');
  });

  it('publishGatewayCacheInvalidation is silent when redis null', async () => {
    await assert.doesNotReject(() =>
      publishGatewayCacheInvalidation(null, 'ai_spend', 'key-x'),
    );
  });

  it('publishGatewayCacheInvalidation swallows publish errors', async () => {
    const fakeRedis = {
      async publish() { throw new Error('connection refused'); },
    };
    await assert.doesNotReject(() =>
      publishGatewayCacheInvalidation(fakeRedis, 'ai_spend', 'key-x'),
    );
  });

  it('emitUsageEvent is silent when redis unavailable', async () => {
    const before = getDroppedEventCount();
    const event = buildEvent({
      account_id: 'acc-ee',
      api_key_id: null,
      module: 'ai',
      event_kind: 'ai.message',
      quantity: 1,
      metadata: {},
    });
    await assert.doesNotReject(() => emitUsageEvent(null, event));
    assert.ok(getDroppedEventCount() > before);
  });
});
