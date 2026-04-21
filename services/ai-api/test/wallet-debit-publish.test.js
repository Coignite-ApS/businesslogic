/**
 * wallet-debit-publish.test.js
 *
 * Unit tests verifying that debitWallet publishes gateway cache invalidation
 * after a successful debit commit. Uses mock pg pool and mock redis — no DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { debitWallet } from '../src/hooks/wallet-debit.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock pg.Pool that returns a mock client.
 * The client succeeds through the full happy-path query sequence.
 */
function makeMockPool({ balanceEur = '100.00', monthlyCap = null } = {}) {
  const client = {
    _queryCount: 0,
    async query(sql) {
      this._queryCount++;
      const s = typeof sql === 'string' ? sql : (sql?.text ?? '');

      if (/BEGIN/i.test(s)) return {};
      if (/COMMIT/i.test(s)) return {};
      if (/ROLLBACK/i.test(s)) return {};

      // SELECT ai_wallet FOR UPDATE
      if (/FROM public\.ai_wallet/i.test(s)) {
        return {
          rows: [{
            balance_eur: balanceEur,
            monthly_cap_eur: monthlyCap,
            auto_reload_enabled: false,
            auto_reload_threshold_eur: null,
            auto_reload_amount_eur: null,
          }],
        };
      }

      // SUM(ai_wallet_ledger) for monthly cap check
      if (/ai_wallet_ledger/i.test(s) && /SUM/i.test(s)) {
        return { rows: [{ monthly_spent: '0' }] };
      }

      // UPDATE ai_wallet → return new balance
      if (/UPDATE public\.ai_wallet/i.test(s)) {
        return { rows: [{ balance_eur: String(parseFloat(balanceEur) - 0.01) }] };
      }

      // INSERT usage_events → return id
      if (/INSERT INTO public\.usage_events/i.test(s)) {
        return { rows: [{ id: BigInt(42) }] };
      }

      // INSERT ai_wallet_ledger
      if (/INSERT INTO public\.ai_wallet_ledger/i.test(s)) {
        return { rows: [] };
      }

      // wallet_auto_reload_pending
      if (/wallet_auto_reload_pending/i.test(s)) {
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL in mock: ${s.slice(0, 100)}`);
    },
    release() {},
  };

  return {
    connect: async () => client,
    // pool.query() used for auto-reload enqueue (outside client transaction)
    async query(sql) { return client.query(sql); },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('debitWallet gateway cache invalidation publish', () => {
  it('publishes ai_spend invalidation after successful debit when apiKeyId provided', async () => {
    const published = [];
    const fakeRedis = {
      async publish(channel, payload) { published.push({ channel, payload }); return 1; },
    };
    const pool = makeMockPool();

    const result = await debitWallet({
      accountId: 'acc-pub-1',
      costUsd: 0.01,
      model: 'claude-sonnet-4-6',
      module: 'ai',
      eventKind: 'ai.message',
      metadata: {},
      apiKeyId: 'key-uuid-abc',
      pool,
      redis: fakeRedis,
    });

    assert.equal(result.ok, true);
    // Allow async publish to settle
    await new Promise(r => setTimeout(r, 10));
    assert.equal(published.length, 1, 'expected exactly one publish call');
    assert.equal(published[0].channel, 'bl:gw_apikey_ai_spend:invalidated');
    assert.equal(published[0].payload, 'key-uuid-abc');
  });

  it('does not publish when apiKeyId is null', async () => {
    const published = [];
    const fakeRedis = {
      async publish(channel, payload) { published.push({ channel, payload }); return 1; },
    };
    const pool = makeMockPool();

    const result = await debitWallet({
      accountId: 'acc-pub-2',
      costUsd: 0.01,
      model: 'claude-sonnet-4-6',
      module: 'ai',
      eventKind: 'ai.message',
      metadata: {},
      apiKeyId: null,
      pool,
      redis: fakeRedis,
    });

    assert.equal(result.ok, true);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(published.length, 0, 'should not publish when no apiKeyId');
  });

  it('does not publish when redis is null (no-op, no error)', async () => {
    const pool = makeMockPool();

    const result = await debitWallet({
      accountId: 'acc-pub-3',
      costUsd: 0.01,
      model: 'claude-sonnet-4-6',
      module: 'ai',
      eventKind: 'ai.message',
      metadata: {},
      apiKeyId: 'key-uuid-xyz',
      pool,
      redis: null,
    });

    // Must succeed even with null redis
    assert.equal(result.ok, true);
  });

  it('does not fail debit when redis publish throws', async () => {
    const fakeRedis = {
      async publish() { throw new Error('redis gone'); },
    };
    const pool = makeMockPool();

    const result = await debitWallet({
      accountId: 'acc-pub-4',
      costUsd: 0.01,
      model: 'claude-sonnet-4-6',
      module: 'ai',
      eventKind: 'ai.message',
      metadata: {},
      apiKeyId: 'key-uuid-err',
      pool,
      redis: fakeRedis,
    });

    assert.equal(result.ok, true, 'debit must succeed even if publish fails');
  });

  it('does not publish when costUsd is zero (no debit occurs)', async () => {
    const published = [];
    const fakeRedis = {
      async publish(channel, payload) { published.push({ channel, payload }); return 1; },
    };
    const pool = makeMockPool();

    const result = await debitWallet({
      accountId: 'acc-pub-5',
      costUsd: 0, // zero-cost — skips DB entirely
      model: 'claude-sonnet-4-6',
      module: 'ai',
      eventKind: 'ai.message',
      metadata: {},
      apiKeyId: 'key-uuid-zero',
      pool,
      redis: fakeRedis,
    });

    assert.equal(result.ok, true);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(published.length, 0, 'no publish for zero-cost event');
  });
});
