/**
 * wallet-failed-debits.test.js
 *
 * Integration tests for the failed-debit recorder + reconciler (Task 33).
 * Requires a running Postgres on :15432.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const DB_URL = process.env.DATABASE_URL || 'postgresql://directus:directus@localhost:15432/directus';

let pool;
let recordFailedDebit;
let reconcileFailedDebits;

async function createTestAccount(client) {
  const id = randomUUID();
  await client.query(`INSERT INTO public.account (id, status) VALUES ($1, 'active')`, [id]);
  return id;
}

async function createWallet(client, accountId, balanceEur) {
  await client.query(
    `INSERT INTO public.ai_wallet (account_id, balance_eur) VALUES ($1, $2)`,
    [accountId, balanceEur],
  );
}

async function cleanup(client, accountId) {
  await client.query('DELETE FROM public.account WHERE id = $1', [accountId]);
}

async function getFailedDebits(client, accountId) {
  const r = await client.query(
    'SELECT * FROM public.ai_wallet_failed_debits WHERE account_id = $1 ORDER BY id',
    [accountId],
  );
  return r.rows;
}

async function getWallet(client, accountId) {
  const r = await client.query(
    'SELECT balance_eur FROM public.ai_wallet WHERE account_id = $1',
    [accountId],
  );
  return r.rows[0] || null;
}

describe('wallet-failed-debits', () => {
  before(async () => {
    pool = new pg.Pool({ connectionString: DB_URL, max: 10 });
    const c = await pool.connect();
    await c.query('SELECT 1');
    c.release();

    process.env.LOG_LEVEL = 'error';
    const mod = await import('../src/hooks/wallet-failed-debits.js');
    recordFailedDebit = (opts) => mod.recordFailedDebit({ ...opts, pool });
    reconcileFailedDebits = (opts) => mod.reconcileFailedDebits({ ...opts, pool });
  });

  after(async () => {
    if (pool) await pool.end();
  });

  // ─────────────────────────────────────────────────────────────
  // recordFailedDebit
  // ─────────────────────────────────────────────────────────────

  describe('recordFailedDebit', () => {
    it('happy path: inserts row with full context', async () => {
      const client = await pool.connect();
      const accountId = await createTestAccount(client);
      try {
        const r = await recordFailedDebit({
          accountId,
          costUsd: 0.1234,
          costEur: 0.1135,
          model: 'claude-sonnet-4-6',
          inputTokens: 1000,
          outputTokens: 500,
          eventKind: 'ai.message',
          module: 'ai',
          anthropicRequestId: 'req_abc123',
          apiKeyId: null,
          conversationId: null,
          errorReason: 'debit_returned_not_ok',
          errorDetail: 'Insufficient AI Wallet balance (€0.0010 available, €0.1135 required)',
        });

        assert.strictEqual(r.recorded, true);
        assert.ok(r.id, 'id should be returned');

        const rows = await getFailedDebits(client, accountId);
        assert.strictEqual(rows.length, 1);
        const row = rows[0];
        assert.strictEqual(row.status, 'pending');
        assert.strictEqual(parseFloat(row.cost_usd), 0.1234);
        assert.strictEqual(parseFloat(row.cost_eur), 0.1135);
        assert.strictEqual(row.model, 'claude-sonnet-4-6');
        assert.strictEqual(row.input_tokens, 1000);
        assert.strictEqual(row.output_tokens, 500);
        assert.strictEqual(row.event_kind, 'ai.message');
        assert.strictEqual(row.module, 'kb');
        assert.strictEqual(row.anthropic_request_id, 'req_abc123');
        assert.strictEqual(row.error_reason, 'debit_returned_not_ok');
        assert.ok(row.error_detail.includes('Insufficient'));
        assert.strictEqual(row.reconciled_at, null);
        assert.strictEqual(row.reconciliation_method, null);
      } finally {
        await cleanup(client, accountId);
        client.release();
      }
    });

    it('derives cost_eur from cost_usd when not provided', async () => {
      const client = await pool.connect();
      const accountId = await createTestAccount(client);
      try {
        await recordFailedDebit({
          accountId,
          costUsd: 1.00,
          model: 'claude-sonnet-4-6',
          inputTokens: 10, outputTokens: 5,
          eventKind: 'ai.message', module: 'ai',
          errorReason: 'debit_threw',
        });
        const rows = await getFailedDebits(client, accountId);
        assert.strictEqual(rows.length, 1);
        // At 0.92 rate, €0.92
        assert.ok(parseFloat(rows[0].cost_eur) > 0.9 && parseFloat(rows[0].cost_eur) < 1.0);
      } finally {
        await cleanup(client, accountId);
        client.release();
      }
    });

    it('truncates very long error_detail', async () => {
      const client = await pool.connect();
      const accountId = await createTestAccount(client);
      try {
        const huge = 'x'.repeat(50000);
        const r = await recordFailedDebit({
          accountId, costUsd: 0.01, model: 'claude-sonnet-4-6',
          inputTokens: 1, outputTokens: 1,
          eventKind: 'ai.message', module: 'ai',
          errorReason: 'debit_threw',
          errorDetail: huge,
        });
        assert.strictEqual(r.recorded, true);
        const rows = await getFailedDebits(client, accountId);
        assert.ok(rows[0].error_detail.length <= 8000, 'error_detail should be truncated');
      } finally {
        await cleanup(client, accountId);
        client.release();
      }
    });

    it('never throws: returns {recorded: false, reason: no_pool} when pool missing', async () => {
      // Import fresh module with NO pool and no initDb().
      const mod = await import('../src/hooks/wallet-failed-debits.js');
      const r = await mod.recordFailedDebit({
        // intentionally do not pass pool — relies on getPool() returning null
        accountId: randomUUID(),
        costUsd: 0.01, model: 'x',
        inputTokens: 1, outputTokens: 1,
        eventKind: 'ai.message', module: 'ai',
        errorReason: 'debit_threw',
      });
      assert.strictEqual(r.recorded, false);
      assert.strictEqual(r.reason, 'no_pool');
    });

    it('never throws: swallows FK violation and returns {recorded: false, reason: insert_failed}', async () => {
      // Bogus account_id → FK violation
      const r = await recordFailedDebit({
        accountId: '00000000-0000-0000-0000-000000000000',
        costUsd: 0.01,
        model: 'claude-sonnet-4-6',
        inputTokens: 1, outputTokens: 1,
        eventKind: 'ai.message', module: 'ai',
        errorReason: 'debit_threw',
      });
      assert.strictEqual(r.recorded, false);
      assert.strictEqual(r.reason, 'insert_failed');
      assert.ok(r.error, 'error message should be captured');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // reconcileFailedDebits
  // ─────────────────────────────────────────────────────────────

  describe('reconcileFailedDebits', () => {
    it('pending row with sufficient balance → status=reconciled, wallet debited', async () => {
      const client = await pool.connect();
      const accountId = await createTestAccount(client);
      await createWallet(client, accountId, 5.00);
      try {
        // Record a failed debit then back-date it > 5 minutes
        const rec = await recordFailedDebit({
          accountId,
          costUsd: 0.10,
          costEur: 0.092,
          model: 'claude-sonnet-4-6',
          inputTokens: 100, outputTokens: 50,
          eventKind: 'ai.message', module: 'ai',
          errorReason: 'debit_threw',
          errorDetail: 'timeout',
        });
        assert.strictEqual(rec.recorded, true);
        await client.query(
          `UPDATE public.ai_wallet_failed_debits SET created_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`,
          [rec.id],
        );

        const result = await reconcileFailedDebits({});
        assert.strictEqual(result.scanned, 1);
        assert.strictEqual(result.reconciled, 1);
        assert.strictEqual(result.waived, 0);
        assert.strictEqual(result.failed, 0);

        const rows = await getFailedDebits(client, accountId);
        assert.strictEqual(rows[0].status, 'reconciled');
        assert.strictEqual(rows[0].reconciliation_method, 'auto');
        assert.ok(rows[0].reconciled_at);

        // Wallet balance debited (5.00 - 0.092 = 4.908)
        const wallet = await getWallet(client, accountId);
        assert.ok(parseFloat(wallet.balance_eur) < 5.00, 'wallet should be debited');
      } finally {
        await cleanup(client, accountId);
        client.release();
      }
    });

    it('pending row with insufficient balance → status=waived', async () => {
      const client = await pool.connect();
      const accountId = await createTestAccount(client);
      await createWallet(client, accountId, 0.001); // way too little
      try {
        const rec = await recordFailedDebit({
          accountId,
          costUsd: 1.00,
          costEur: 0.92,
          model: 'claude-sonnet-4-6',
          inputTokens: 100, outputTokens: 50,
          eventKind: 'ai.message', module: 'ai',
          errorReason: 'debit_threw',
          errorDetail: 'timeout',
        });
        await client.query(
          `UPDATE public.ai_wallet_failed_debits SET created_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`,
          [rec.id],
        );

        const result = await reconcileFailedDebits({});
        assert.strictEqual(result.scanned, 1);
        assert.strictEqual(result.waived, 1);
        assert.strictEqual(result.reconciled, 0);

        const rows = await getFailedDebits(client, accountId);
        assert.strictEqual(rows[0].status, 'waived');
        assert.strictEqual(rows[0].reconciliation_method, 'waived');
        assert.ok(rows[0].reconciled_at);

        // Wallet balance unchanged (still 0.001)
        const wallet = await getWallet(client, accountId);
        assert.strictEqual(parseFloat(wallet.balance_eur), 0.001);
      } finally {
        await cleanup(client, accountId);
        client.release();
      }
    });

    it('does NOT pick up rows younger than 5 minutes (transient-heal window)', async () => {
      const client = await pool.connect();
      const accountId = await createTestAccount(client);
      await createWallet(client, accountId, 10.00);
      try {
        await recordFailedDebit({
          accountId, costUsd: 0.01, costEur: 0.0092,
          model: 'x', inputTokens: 1, outputTokens: 1,
          eventKind: 'ai.message', module: 'ai',
          errorReason: 'debit_threw',
        });
        // Don't back-date — created just now.

        const result = await reconcileFailedDebits({});
        assert.strictEqual(result.scanned, 0, 'young rows should be skipped');

        const rows = await getFailedDebits(client, accountId);
        assert.strictEqual(rows[0].status, 'pending');
      } finally {
        await cleanup(client, accountId);
        client.release();
      }
    });

    it('idempotent: re-running on already-reconciled rows is a no-op', async () => {
      const client = await pool.connect();
      const accountId = await createTestAccount(client);
      await createWallet(client, accountId, 5.00);
      try {
        const rec = await recordFailedDebit({
          accountId, costUsd: 0.10, costEur: 0.092,
          model: 'x', inputTokens: 1, outputTokens: 1,
          eventKind: 'ai.message', module: 'ai',
          errorReason: 'debit_threw',
        });
        await client.query(
          `UPDATE public.ai_wallet_failed_debits SET created_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`,
          [rec.id],
        );

        const first = await reconcileFailedDebits({});
        assert.strictEqual(first.reconciled, 1);

        // Second run — already reconciled row excluded.
        const second = await reconcileFailedDebits({});
        assert.strictEqual(second.scanned, 0);

        const rows = await getFailedDebits(client, accountId);
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].status, 'reconciled');
        // wallet: single debit only (balance ~4.908)
        const wallet = await getWallet(client, accountId);
        const bal = parseFloat(wallet.balance_eur);
        assert.ok(bal > 4.90 && bal < 4.92, `expected ~4.908, got ${bal}`);
      } finally {
        await cleanup(client, accountId);
        client.release();
      }
    });

    it('batch: reconciles multiple rows across multiple accounts in one pass', async () => {
      const client = await pool.connect();
      const accountA = await createTestAccount(client);
      const accountB = await createTestAccount(client);
      await createWallet(client, accountA, 5.00);
      await createWallet(client, accountB, 0.0001); // will be waived
      try {
        const ra = await recordFailedDebit({
          accountId: accountA, costUsd: 0.05, costEur: 0.046,
          model: 'x', inputTokens: 1, outputTokens: 1,
          eventKind: 'ai.message', module: 'ai',
          errorReason: 'debit_threw',
        });
        const rb = await recordFailedDebit({
          accountId: accountB, costUsd: 0.05, costEur: 0.046,
          model: 'x', inputTokens: 1, outputTokens: 1,
          eventKind: 'ai.message', module: 'ai',
          errorReason: 'debit_threw',
        });
        await client.query(
          `UPDATE public.ai_wallet_failed_debits SET created_at = NOW() - INTERVAL '10 minutes' WHERE id IN ($1, $2)`,
          [ra.id, rb.id],
        );

        const result = await reconcileFailedDebits({});
        assert.strictEqual(result.scanned, 2);
        assert.strictEqual(result.reconciled, 1);
        assert.strictEqual(result.waived, 1);
      } finally {
        await cleanup(client, accountA);
        await cleanup(client, accountB);
        client.release();
      }
    });
  });
});
