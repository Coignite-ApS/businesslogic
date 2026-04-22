/**
 * wallet-debit.test.js
 *
 * Integration tests for the ai_wallet atomic debit hook.
 * Requires a running PostgreSQL instance (businesslogic-postgres-1 on port 15432).
 *
 * All tests create and clean up their own account/wallet rows.
 * Concurrent test verifies FOR UPDATE locking prevents double-debit.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const DB_URL = process.env.DATABASE_URL || 'postgresql://directus:directus@localhost:15432/directus';

let pool;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createTestAccount(client) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.account (id, status) VALUES ($1, 'active')`,
    [id],
  );
  return id;
}

async function createWallet(client, accountId, balanceEur) {
  await client.query(
    `INSERT INTO public.ai_wallet (account_id, balance_eur) VALUES ($1, $2)`,
    [accountId, balanceEur],
  );
}

async function getWallet(client, accountId) {
  const r = await client.query(
    'SELECT balance_eur FROM public.ai_wallet WHERE account_id = $1',
    [accountId],
  );
  return r.rows[0] || null;
}

async function getLedgerRows(client, accountId) {
  const r = await client.query(
    'SELECT * FROM public.ai_wallet_ledger WHERE account_id = $1 ORDER BY id',
    [accountId],
  );
  return r.rows;
}

async function getUsageEvents(client, accountId) {
  const r = await client.query(
    'SELECT * FROM public.usage_events WHERE account_id = $1 ORDER BY id',
    [accountId],
  );
  return r.rows;
}

async function getAutoReloadPending(client, accountId) {
  const r = await client.query(
    'SELECT * FROM public.wallet_auto_reload_pending WHERE account_id = $1 ORDER BY created_at',
    [accountId],
  );
  return r.rows;
}

async function cleanup(client, accountId) {
  // CASCADE deletes wallet, ledger, usage_events
  await client.query('DELETE FROM public.account WHERE id = $1', [accountId]);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('wallet-debit hook', () => {
  let debitWallet;

  before(async () => {
    pool = new pg.Pool({ connectionString: DB_URL, max: 10 });
    // Verify connectivity
    const c = await pool.connect();
    await c.query('SELECT 1');
    c.release();

    process.env.LOG_LEVEL = 'error';
    const mod = await import('../src/hooks/wallet-debit.js');
    // Wrap debitWallet to inject the test pool so no initDb() needed
    const _debitWallet = mod.debitWallet;
    debitWallet = (opts) => _debitWallet({ ...opts, pool });
  });

  after(async () => {
    if (pool) await pool.end();
  });

  // ── Scenario 1: sufficient balance → debit succeeds ────────────────────

  it('sufficient balance: balance decremented, ledger row written, usage_event written', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createWallet(client, accountId, 1.00); // €1.00

    try {
      const result = await debitWallet({
        accountId,
        costUsd: 0.05,           // ~€0.0475 at 0.95 rate
        model: 'claude-sonnet-4-6',
        module: 'ai',
        eventKind: 'ai.message',
        metadata: { test: true },
      });

      assert.ok(result.ok, `Expected ok, got: ${JSON.stringify(result)}`);
      assert.ok(result.costEur > 0, 'costEur should be > 0');
      assert.ok(typeof result.newBalance === 'number', 'newBalance should be a number');

      const wallet = await getWallet(client, accountId);
      assert.ok(wallet, 'Wallet row should exist');
      const newBal = parseFloat(wallet.balance_eur);
      assert.ok(newBal < 1.00, `Balance should have decreased from 1.00, got ${newBal}`);

      const ledger = await getLedgerRows(client, accountId);
      assert.strictEqual(ledger.length, 1, 'Should have exactly 1 ledger row');
      assert.strictEqual(ledger[0].entry_type, 'debit');
      assert.strictEqual(ledger[0].source, 'usage');
      assert.ok(parseFloat(ledger[0].amount_eur) > 0);
      assert.ok(parseFloat(ledger[0].balance_after_eur) >= 0);

      const events = await getUsageEvents(client, accountId);
      assert.strictEqual(events.length, 1, 'Should have exactly 1 usage_event');
      assert.strictEqual(events[0].module, 'kb');
      assert.strictEqual(events[0].event_kind, 'ai.message');
      assert.ok(parseFloat(events[0].cost_eur) > 0);

      // Ledger usage_event_id should reference the usage_event
      assert.strictEqual(
        ledger[0].usage_event_id,
        events[0].id,
        'Ledger usage_event_id must reference usage_events.id',
      );
    } finally {
      await cleanup(client, accountId);
      client.release();
    }
  });

  // ── Scenario 2: insufficient balance → 402 returned, no changes ────────

  it('insufficient balance: returns 402, no balance change, no ledger row', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createWallet(client, accountId, 0.001); // €0.001 — less than any real AI cost

    try {
      const result = await debitWallet({
        accountId,
        costUsd: 0.10,           // ~€0.095 — way more than €0.001
        model: 'claude-sonnet-4-6',
        module: 'ai',
        eventKind: 'ai.message',
        metadata: {},
      });

      assert.strictEqual(result.ok, false, 'Should not succeed');
      assert.strictEqual(result.statusCode, 402, 'Should return 402');
      assert.ok(result.reason.toLowerCase().includes('insufficient'), `Expected 'insufficient' in reason, got: ${result.reason}`);

      // Balance unchanged
      const wallet = await getWallet(client, accountId);
      assert.strictEqual(parseFloat(wallet.balance_eur), 0.001);

      // No ledger rows
      const ledger = await getLedgerRows(client, accountId);
      assert.strictEqual(ledger.length, 0);

      // No usage events
      const events = await getUsageEvents(client, accountId);
      assert.strictEqual(events.length, 0);
    } finally {
      await cleanup(client, accountId);
      client.release();
    }
  });

  // ── Scenario 3: monthly cap exceeded → 402 returned ────────────────────

  it('monthly cap exceeded: returns 402, no changes', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createWallet(client, accountId, 10.00); // plenty of balance

    // Set monthly_cap_eur = €0.05 (very tight cap)
    await client.query(
      'UPDATE public.ai_wallet SET monthly_cap_eur = 0.05 WHERE account_id = $1',
      [accountId],
    );

    // Seed a debit that puts us at €0.04 already spent this month
    await client.query(
      `INSERT INTO public.ai_wallet_ledger
         (account_id, entry_type, amount_eur, balance_after_eur, source, occurred_at)
       VALUES ($1, 'debit', 0.04, 9.96, 'usage', date_trunc('month', NOW()) + INTERVAL '1 hour')`,
      [accountId],
    );

    try {
      // New cost = €0.02 → total = €0.06 > €0.05 cap → should reject
      const result = await debitWallet({
        accountId,
        costUsd: 0.021,         // ~€0.0193 at 0.92 rate
        model: 'claude-sonnet-4-6',
        module: 'ai',
        eventKind: 'ai.message',
        metadata: {},
      });

      assert.strictEqual(result.ok, false, 'Should not succeed');
      assert.strictEqual(result.statusCode, 402, 'Should return 402');
      assert.ok(
        result.reason.toLowerCase().includes('monthly') || result.reason.toLowerCase().includes('cap'),
        `Expected monthly/cap in reason, got: ${result.reason}`,
      );

      // Balance unchanged (€10.00)
      const wallet = await getWallet(client, accountId);
      assert.strictEqual(parseFloat(wallet.balance_eur), 10.00);

      // Only the seeded debit, no new one
      const ledger = await getLedgerRows(client, accountId);
      assert.strictEqual(ledger.length, 1, 'Should still have only the seeded ledger row');
    } finally {
      await cleanup(client, accountId);
      client.release();
    }
  });

  // ── Scenario 4: zero balance → 402 (edge case, not just insufficient) ──

  it('zero balance: returns 402 immediately', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createWallet(client, accountId, 0.00);

    try {
      const result = await debitWallet({
        accountId,
        costUsd: 0.001,
        model: 'claude-haiku-4-5-20251001',
        module: 'ai',
        eventKind: 'ai.message',
        metadata: {},
      });

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.statusCode, 402);
    } finally {
      await cleanup(client, accountId);
      client.release();
    }
  });

  // ── Scenario 5: missing wallet row → 402 ───────────────────────────────

  it('no wallet row: returns 402', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    // No wallet created

    try {
      const result = await debitWallet({
        accountId,
        costUsd: 0.01,
        model: 'claude-sonnet-4-6',
        module: 'ai',
        eventKind: 'ai.message',
        metadata: {},
      });

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.statusCode, 402);
    } finally {
      await cleanup(client, accountId);
      client.release();
    }
  });

  // ── Scenario 6: concurrent debits — FOR UPDATE serializes them ─────────

  it('concurrent debits: FOR UPDATE prevents double-debit when balance is tight', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    // Give exactly enough for ONE debit at ~€0.05 cost each, but not two
    await createWallet(client, accountId, 0.06); // €0.06 balance

    client.release(); // done with setup client

    // Launch two concurrent debits, each costing ~€0.05
    const costUsd = 0.053; // ~€0.04876 at 0.92 rate — just under €0.06 individually

    const [r1, r2] = await Promise.all([
      debitWallet({
        accountId,
        costUsd,
        model: 'claude-sonnet-4-6',
        module: 'ai',
        eventKind: 'ai.message',
        metadata: { concurrentTest: 1 },
      }),
      debitWallet({
        accountId,
        costUsd,
        model: 'claude-sonnet-4-6',
        module: 'ai',
        eventKind: 'ai.message',
        metadata: { concurrentTest: 2 },
      }),
    ]);

    // Exactly one should succeed, one should fail with 402
    const succeeded = [r1, r2].filter(r => r.ok);
    const failed = [r1, r2].filter(r => !r.ok);

    assert.strictEqual(succeeded.length, 1, `Exactly 1 debit should succeed, got ${succeeded.length}`);
    assert.strictEqual(failed.length, 1, `Exactly 1 debit should fail, got ${failed.length}`);
    assert.strictEqual(failed[0].statusCode, 402);

    // Verify only 1 ledger row and 1 usage event
    const verifyClient = await pool.connect();
    try {
      const ledger = await getLedgerRows(verifyClient, accountId);
      assert.strictEqual(ledger.length, 1, 'Only 1 ledger row should exist');
      const events = await getUsageEvents(verifyClient, accountId);
      assert.strictEqual(events.length, 1, 'Only 1 usage_event should exist');

      // Balance should still be >= 0
      const wallet = await getWallet(verifyClient, accountId);
      assert.ok(parseFloat(wallet.balance_eur) >= 0, 'Balance must never go negative');
    } finally {
      await cleanup(verifyClient, accountId);
      verifyClient.release();
    }
  });

  // ── Scenario 7: auto-reload trigger flag set when threshold crossed ─────

  it('auto-reload: trigger flag returned when balance dips below threshold', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createWallet(client, accountId, 2.00); // €2.00

    // Enable auto-reload with €5 threshold and €10 reload amount
    await client.query(
      `UPDATE public.ai_wallet
         SET auto_reload_enabled = true, auto_reload_threshold_eur = 5.00, auto_reload_amount_eur = 10.00
       WHERE account_id = $1`,
      [accountId],
    );

    try {
      // Debit €1.50 → balance drops to €0.50, below €5 threshold
      const result = await debitWallet({
        accountId,
        costUsd: 1.578,         // ~€1.4518 at 0.92 → balance becomes ~€0.55
        model: 'claude-sonnet-4-6',
        module: 'ai',
        eventKind: 'ai.message',
        metadata: {},
      });

      assert.ok(result.ok, `Debit should succeed, got: ${JSON.stringify(result)}`);
      assert.strictEqual(
        result.autoReloadTriggered,
        true,
        'autoReloadTriggered should be true when balance < threshold',
      );
      assert.ok(result.autoReloadAmountEur > 0, 'autoReloadAmountEur should be set');
    } finally {
      await cleanup(client, accountId);
      client.release();
    }
  });

  // ── Scenario 8: auto-reload enqueues row in wallet_auto_reload_pending ─

  it('auto-reload: INSERTs pending row with correct amount after debit COMMIT', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createWallet(client, accountId, 2.00);
    await client.query(
      `UPDATE public.ai_wallet
         SET auto_reload_enabled = true, auto_reload_threshold_eur = 5.00, auto_reload_amount_eur = 10.00
       WHERE account_id = $1`,
      [accountId],
    );

    try {
      const result = await debitWallet({
        accountId,
        costUsd: 1.578,
        model: 'claude-sonnet-4-6',
        module: 'ai',
        eventKind: 'ai.message',
        metadata: {},
      });
      assert.ok(result.ok);
      assert.strictEqual(result.autoReloadTriggered, true);

      const pending = await getAutoReloadPending(client, accountId);
      assert.strictEqual(pending.length, 1, 'Exactly 1 pending row expected');
      assert.strictEqual(pending[0].status, 'pending');
      assert.strictEqual(parseFloat(pending[0].amount_eur), 10.00);
      assert.strictEqual(pending[0].attempts, 0);
      assert.strictEqual(pending[0].stripe_payment_intent_id, null);
      assert.strictEqual(pending[0].processed_at, null);
    } finally {
      await cleanup(client, accountId);
      client.release();
    }
  });

  // ── Scenario 9: auto-reload below threshold on already-triggered account ──
  //    Second qualifying debit must NOT create a second pending row — partial
  //    UNIQUE index on (account_id) WHERE status IN ('pending','processing')
  //    guards against runaway enqueue. The second INSERT must be silently
  //    absorbed (ON CONFLICT DO NOTHING) — debit must still succeed.

  it('auto-reload: second qualifying debit does NOT create a second pending row', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createWallet(client, accountId, 4.00);
    await client.query(
      `UPDATE public.ai_wallet
         SET auto_reload_enabled = true, auto_reload_threshold_eur = 5.00, auto_reload_amount_eur = 10.00
       WHERE account_id = $1`,
      [accountId],
    );

    try {
      // 1st qualifying debit: balance 4.00 → ~2.55
      const r1 = await debitWallet({
        accountId, costUsd: 1.578, model: 'claude-sonnet-4-6',
        module: 'ai', eventKind: 'ai.message', metadata: {},
      });
      assert.ok(r1.ok);
      assert.strictEqual(r1.autoReloadTriggered, true);

      // 2nd qualifying debit: balance ~2.55 → ~1.10 — still below threshold
      const r2 = await debitWallet({
        accountId, costUsd: 1.578, model: 'claude-sonnet-4-6',
        module: 'ai', eventKind: 'ai.message', metadata: {},
      });
      assert.ok(r2.ok, 'Debit must still succeed even when enqueue is a no-op');
      assert.strictEqual(r2.autoReloadTriggered, true);

      const pending = await getAutoReloadPending(client, accountId);
      assert.strictEqual(pending.length, 1, 'Still exactly 1 pending row (partial UNIQUE holds)');
    } finally {
      await cleanup(client, accountId);
      client.release();
    }
  });

  // ── Scenario 10: auto-reload disabled → no row inserted ────────────────

  it('auto-reload: disabled account → no pending row inserted even when low', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createWallet(client, accountId, 2.00);
    // auto_reload_enabled stays false (default)

    try {
      const result = await debitWallet({
        accountId, costUsd: 1.578, model: 'claude-sonnet-4-6',
        module: 'ai', eventKind: 'ai.message', metadata: {},
      });
      assert.ok(result.ok);
      assert.strictEqual(result.autoReloadTriggered, false);

      const pending = await getAutoReloadPending(client, accountId);
      assert.strictEqual(pending.length, 0);
    } finally {
      await cleanup(client, accountId);
      client.release();
    }
  });

  // ── Scenario 11: auto-reload threshold crossed but previous row succeeded ──
  //    After a prior auto-reload completed (status='succeeded'), the partial
  //    UNIQUE scope excludes it, so a new qualifying debit MUST create a new
  //    row (business case: balance topped up, then drained again later).

  it('auto-reload: new pending row after a previous succeeded one', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createWallet(client, accountId, 2.00);
    await client.query(
      `UPDATE public.ai_wallet
         SET auto_reload_enabled = true, auto_reload_threshold_eur = 5.00, auto_reload_amount_eur = 10.00
       WHERE account_id = $1`,
      [accountId],
    );
    // Seed a prior succeeded row (as if a previous auto-reload cycle completed)
    await client.query(
      `INSERT INTO public.wallet_auto_reload_pending (account_id, amount_eur, status, processed_at)
       VALUES ($1, 10.00, 'succeeded', NOW() - INTERVAL '1 hour')`,
      [accountId],
    );

    try {
      const result = await debitWallet({
        accountId, costUsd: 1.578, model: 'claude-sonnet-4-6',
        module: 'ai', eventKind: 'ai.message', metadata: {},
      });
      assert.ok(result.ok);
      assert.strictEqual(result.autoReloadTriggered, true);

      const pending = await getAutoReloadPending(client, accountId);
      assert.strictEqual(pending.length, 2, '1 historical succeeded + 1 fresh pending');
      const active = pending.filter(r => r.status === 'pending');
      assert.strictEqual(active.length, 1);
    } finally {
      await cleanup(client, accountId);
      client.release();
    }
  });
});
