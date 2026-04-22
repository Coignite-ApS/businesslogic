import { describe, it, expect, vi } from 'vitest';
import { verifyTopupCredit, type LedgerEntry } from '../utils/verify-topup';

type Harness = {
	refreshes: number;
	ledger: LedgerEntry[];
	refreshWallet: () => Promise<void>;
	getRecentLedger: () => LedgerEntry[];
	appendTopupOn: (attempt: number, entry: LedgerEntry) => void;
};

function makeHarness(): Harness {
	const state = {
		refreshes: 0,
		ledger: [] as LedgerEntry[],
		pending: new Map<number, LedgerEntry>(),
	};
	const h: Harness = {
		get refreshes() { return state.refreshes; },
		get ledger() { return state.ledger; },
		refreshWallet: async () => {
			state.refreshes += 1;
			const inject = state.pending.get(state.refreshes);
			if (inject) state.ledger = [inject, ...state.ledger];
		},
		getRecentLedger: () => state.ledger,
		appendTopupOn: (attempt, entry) => {
			state.pending.set(attempt, entry);
		},
	};
	return h;
}

describe('verifyTopupCredit', () => {
	it('returns credited when a topup entry newer than `since` is already present on first refresh', async () => {
		const since = new Date('2026-04-22T15:34:00Z');
		const h = makeHarness();
		h.appendTopupOn(1, { source: 'topup', occurred_at: '2026-04-22T15:34:05Z' });

		const status = await verifyTopupCredit({
			refreshWallet: h.refreshWallet,
			getRecentLedger: h.getRecentLedger,
			since,
			maxAttempts: 3,
			intervalMs: 0,
		});

		expect(status).toBe('credited');
		expect(h.refreshes).toBe(1);
	});

	it('returns credited after N attempts once the ledger entry arrives', async () => {
		const since = new Date('2026-04-22T15:34:00Z');
		const h = makeHarness();
		h.appendTopupOn(3, { source: 'topup', occurred_at: '2026-04-22T15:34:06Z' });

		const status = await verifyTopupCredit({
			refreshWallet: h.refreshWallet,
			getRecentLedger: h.getRecentLedger,
			since,
			maxAttempts: 5,
			intervalMs: 0,
		});

		expect(status).toBe('credited');
		expect(h.refreshes).toBe(3);
	});

	it('returns timeout after maxAttempts with no matching entry', async () => {
		const since = new Date('2026-04-22T15:34:00Z');
		const h = makeHarness();

		const status = await verifyTopupCredit({
			refreshWallet: h.refreshWallet,
			getRecentLedger: h.getRecentLedger,
			since,
			maxAttempts: 4,
			intervalMs: 0,
		});

		expect(status).toBe('timeout');
		expect(h.refreshes).toBe(4);
	});

	it('ignores ledger entries older than `since` (minus 60s clock-skew tolerance)', async () => {
		const since = new Date('2026-04-22T15:34:00Z');
		const h = makeHarness();
		// Old topup from before the checkout started — must NOT count.
		h.appendTopupOn(1, { source: 'topup', occurred_at: '2026-04-22T15:32:00Z' });

		const status = await verifyTopupCredit({
			refreshWallet: h.refreshWallet,
			getRecentLedger: h.getRecentLedger,
			since,
			maxAttempts: 2,
			intervalMs: 0,
		});

		expect(status).toBe('timeout');
	});

	it('accepts entries within the 60s clock-skew tolerance window', async () => {
		const since = new Date('2026-04-22T15:34:00Z');
		const h = makeHarness();
		// Entry 30s before `since` — tolerated as clock skew.
		h.appendTopupOn(1, { source: 'topup', occurred_at: '2026-04-22T15:33:30Z' });

		const status = await verifyTopupCredit({
			refreshWallet: h.refreshWallet,
			getRecentLedger: h.getRecentLedger,
			since,
			maxAttempts: 2,
			intervalMs: 0,
		});

		expect(status).toBe('credited');
	});

	it('ignores non-topup sources even when timed after `since`', async () => {
		const since = new Date('2026-04-22T15:34:00Z');
		const h = makeHarness();
		h.appendTopupOn(1, { source: 'usage', occurred_at: '2026-04-22T15:34:10Z' });
		h.appendTopupOn(2, { source: 'adjustment', occurred_at: '2026-04-22T15:34:20Z' });

		const status = await verifyTopupCredit({
			refreshWallet: h.refreshWallet,
			getRecentLedger: h.getRecentLedger,
			since,
			maxAttempts: 3,
			intervalMs: 0,
		});

		expect(status).toBe('timeout');
	});

	it('matches amount when expectedAmountEur is set — ignores non-matching recent topups', async () => {
		const since = new Date('2026-04-22T15:34:00Z');
		const h = makeHarness();
		// A €20 topup from 10s ago — does NOT match the €50 we expect.
		h.appendTopupOn(1, { source: 'topup', occurred_at: '2026-04-22T15:34:10Z', amount_eur: 20 });

		const status = await verifyTopupCredit({
			refreshWallet: h.refreshWallet,
			getRecentLedger: h.getRecentLedger,
			since,
			expectedAmountEur: 50,
			maxAttempts: 2,
			intervalMs: 0,
		});

		expect(status).toBe('timeout');
	});

	it('matches amount when expectedAmountEur is set — credits on exact match', async () => {
		const since = new Date('2026-04-22T15:34:00Z');
		const h = makeHarness();
		h.appendTopupOn(1, { source: 'topup', occurred_at: '2026-04-22T15:34:10Z', amount_eur: 20 });
		h.appendTopupOn(2, { source: 'topup', occurred_at: '2026-04-22T15:34:20Z', amount_eur: 50 });

		const status = await verifyTopupCredit({
			refreshWallet: h.refreshWallet,
			getRecentLedger: h.getRecentLedger,
			since,
			expectedAmountEur: 50,
			maxAttempts: 3,
			intervalMs: 0,
		});

		expect(status).toBe('credited');
		expect(h.refreshes).toBe(2);
	});

	it('tolerates tiny float differences in amount match (DB returns strings)', async () => {
		const since = new Date('2026-04-22T15:34:00Z');
		const h = makeHarness();
		// DB returns amount_eur as string '50.00' — Number() gives 50.
		h.appendTopupOn(1, { source: 'topup', occurred_at: '2026-04-22T15:34:10Z', amount_eur: '50.00' });

		const status = await verifyTopupCredit({
			refreshWallet: h.refreshWallet,
			getRecentLedger: h.getRecentLedger,
			since,
			expectedAmountEur: 50,
			maxAttempts: 2,
			intervalMs: 0,
		});

		expect(status).toBe('credited');
	});

	it('does not sleep after the last attempt', async () => {
		const since = new Date('2026-04-22T15:34:00Z');
		const h = makeHarness();
		const sleep = vi.fn(async () => {});

		await verifyTopupCredit({
			refreshWallet: h.refreshWallet,
			getRecentLedger: h.getRecentLedger,
			since,
			maxAttempts: 3,
			intervalMs: 1000,
			sleep,
		});

		// 3 attempts → 2 sleeps between them, none after the last.
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(1000);
	});
});
