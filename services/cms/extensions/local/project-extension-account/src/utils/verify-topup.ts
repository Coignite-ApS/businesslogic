export type LedgerEntry = {
	source: string;
	occurred_at: string;
	amount_eur?: number | string;
};

export type TopupStatus = 'credited' | 'timeout';

export type VerifyTopupOptions = {
	refreshWallet: () => Promise<void>;
	getRecentLedger: () => LedgerEntry[];
	since: Date;
	/** If provided, only a ledger entry matching this amount (±1 cent) counts as credited. */
	expectedAmountEur?: number;
	maxAttempts?: number;
	intervalMs?: number;
	sleep?: (ms: number) => Promise<void>;
};

const CLOCK_SKEW_MS = 60_000;
const AMOUNT_TOLERANCE_EUR = 0.01;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function verifyTopupCredit(opts: VerifyTopupOptions): Promise<TopupStatus> {
	const maxAttempts = opts.maxAttempts ?? 8;
	const intervalMs = opts.intervalMs ?? 2000;
	const sleep = opts.sleep ?? defaultSleep;
	const sinceMs = opts.since.getTime() - CLOCK_SKEW_MS;
	const expected = opts.expectedAmountEur;
	const hasExpected = typeof expected === 'number' && Number.isFinite(expected) && expected > 0;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		await opts.refreshWallet();
		const hit = opts.getRecentLedger().some((e) => {
			if (e.source !== 'topup') return false;
			const t = Date.parse(e.occurred_at);
			if (Number.isNaN(t) || t < sinceMs) return false;
			if (hasExpected) {
				const amt = Number(e.amount_eur);
				if (!Number.isFinite(amt)) return false;
				if (Math.abs(amt - expected) > AMOUNT_TOLERANCE_EUR) return false;
			}
			return true;
		});
		if (hit) return 'credited';
		if (attempt < maxAttempts) await sleep(intervalMs);
	}
	return 'timeout';
}
