import { getWalletState, hasWalletBalance } from '../../_shared/v2-subscription.js';
import type { DB } from './types.js';

export function requireAuth(req: any, res: any, next: () => void) {
	if (!req.accountability?.user) {
		return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
	}
	next();
}

export function requireAdmin(req: any, res: any, next: () => void) {
	if (!req.accountability?.admin) {
		return res.status(403).json({ errors: [{ message: 'Admin access required' }] });
	}
	next();
}

/**
 * Middleware: require an authenticated user with a positive AI Wallet balance.
 *
 * v2 NOTE: AI module access is no longer gated by a per-tier subscription tier.
 * Every account gets a €5 wallet credit at signup; AI calls debit that wallet
 * (debit hook lives in task 18). This middleware just stops requests before
 * they incur a debit when the wallet is already empty.
 */
export function requireActiveSubscription(db: DB) {
	return async (req: any, res: any, next: () => void) => {
		const userId = req.accountability?.user;
		if (!userId) {
			return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
		}

		if (req.accountability.admin) {
			return next();
		}

		try {
			const user = await db('directus_users')
				.where('id', userId)
				.select('active_account')
				.first();

			if (!user?.active_account) {
				return res.status(403).json({ errors: [{ message: 'No active account. Please select an account.' }] });
			}

			const account = await db('account')
				.where('id', user.active_account)
				.select('exempt_from_subscription')
				.first();

			if (account?.exempt_from_subscription) {
				return next();
			}

			// v2: AI gate is wallet balance, not subscription tier. Empty wallet
			// returns 402 Payment Required so the UI can prompt a top-up.
			const ok = await hasWalletBalance(db, user.active_account);
			if (!ok) {
				return res.status(402).json({
					errors: [{ message: 'AI Wallet balance is empty. Top up to continue using the AI Assistant.' }],
				});
			}

			next();
		} catch (err) {
			return res.status(500).json({ errors: [{ message: 'AI Wallet check failed' }] });
		}
	};
}

/** Get user's active_account ID */
export async function getActiveAccount(db: DB, userId: string): Promise<string | null> {
	const user = await db('directus_users')
		.where('id', userId)
		.select('active_account')
		.first();
	return user?.active_account || null;
}

export interface AiQuota {
	queriesUsed: number;
	queriesLimit: number | null; // null = unlimited / wallet-gated
	periodStart: Date;
	periodEnd: Date;
	allowedModels: string[] | null; // null = all models
	/** v2: AI Wallet snapshot at gate time. */
	walletBalanceEur: number;
	walletMonthlyCapEur: number | null;
}

/**
 * Middleware: gate AI calls on AI Wallet balance + attach wallet state to req.
 *
 * v2 changes vs v1:
 *   - sp.ai_queries_per_month removed → wallet balance gate replaces it.
 *   - sp.ai_allowed_models removed → all models allowed; per-model cost
 *     differences are reflected in the per-call debit.
 *   - period_start/period_end no longer drive the gate (the wallet IS the
 *     budget). Period fields are kept on req.aiQuota purely so the response
 *     shape stays compatible with existing consumers.
 *
 * NOTE: the actual €-cost debit happens AFTER the call completes (task 18).
 */
export function requireAiQuota(db: DB) {
	return async (req: any, res: any, next: () => void) => {
		const userId = req.accountability?.user;
		if (!userId) {
			return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
		}

		const now = new Date();
		const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
		const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

		// Admins bypass
		if (req.accountability.admin) {
			req.aiQuota = {
				queriesUsed: 0,
				queriesLimit: null,
				periodStart,
				periodEnd,
				allowedModels: null,
				walletBalanceEur: Number.POSITIVE_INFINITY,
				walletMonthlyCapEur: null,
			} as AiQuota;
			return next();
		}

		try {
			const user = await db('directus_users').where('id', userId).select('active_account').first();
			if (!user?.active_account) {
				return res.status(403).json({ errors: [{ message: 'No active account' }] });
			}

			const accountId = user.active_account;

			// Exempt accounts bypass
			const account = await db('account').where('id', accountId).select('exempt_from_subscription').first();
			if (account?.exempt_from_subscription) {
				req.aiQuota = {
					queriesUsed: 0,
					queriesLimit: null,
					periodStart,
					periodEnd,
					allowedModels: null,
					walletBalanceEur: Number.POSITIVE_INFINITY,
					walletMonthlyCapEur: null,
				} as AiQuota;
				return next();
			}

			// v2: AI Wallet balance gate. The wallet is created on signup with
			// €5 promotional credit; if it's empty, block with 402.
			const wallet = await getWalletState(db, accountId);
			const balance = parseFloat(wallet.balance_eur) || 0;
			const cap = wallet.monthly_cap_eur != null ? parseFloat(wallet.monthly_cap_eur) : null;

			if (balance <= 0) {
				return res.status(402).json({
					errors: [{ message: 'AI Wallet balance is empty. Top up to continue using the AI Assistant.' }],
					wallet: { balance_eur: balance, monthly_cap_eur: cap },
				});
			}

			req.aiQuota = {
				queriesUsed: 0,
				queriesLimit: null,
				periodStart,
				periodEnd,
				allowedModels: null,
				walletBalanceEur: balance,
				walletMonthlyCapEur: cap,
			} as AiQuota;
			next();
		} catch (err) {
			return res.status(500).json({ errors: [{ message: 'AI Wallet check failed' }] });
		}
	};
}
