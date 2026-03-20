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

			const sub = await db('subscriptions as s')
				.join('subscription_plans as sp', 'sp.id', 's.plan')
				.where('s.account', user.active_account)
				.select('s.status', 's.trial_end')
				.first();

			if (!sub) {
				return res.status(403).json({ errors: [{ message: 'No subscription found. Please subscribe.' }] });
			}

			if (sub.status === 'canceled' || sub.status === 'expired') {
				return res.status(403).json({ errors: [{ message: `Subscription ${sub.status}. Please subscribe to continue.` }] });
			}

			if (sub.status === 'trialing' && sub.trial_end && new Date(sub.trial_end) < new Date()) {
				return res.status(403).json({ errors: [{ message: 'Trial expired. Please subscribe to continue.' }] });
			}

			next();
		} catch (err) {
			return res.status(500).json({ errors: [{ message: 'Subscription check failed' }] });
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
	queriesLimit: number | null; // null = unlimited
	periodStart: Date;
	periodEnd: Date;
	allowedModels: string[] | null; // null = all models
}

/** Middleware: check AI query quota for the user's plan */
export function requireAiQuota(db: DB) {
	return async (req: any, res: any, next: () => void) => {
		const userId = req.accountability?.user;
		if (!userId) {
			return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
		}

		// Admins bypass
		if (req.accountability.admin) {
			req.aiQuota = { queriesUsed: 0, queriesLimit: null, periodStart: new Date(), periodEnd: new Date(), allowedModels: null };
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
				req.aiQuota = { queriesUsed: 0, queriesLimit: null, periodStart: new Date(), periodEnd: new Date(), allowedModels: null };
				return next();
			}

			// Get subscription + plan
			const sub = await db('subscriptions as s')
				.join('subscription_plans as sp', 'sp.id', 's.plan')
				.where('s.account', accountId)
				.whereNotIn('s.status', ['canceled', 'expired'])
				.select(
					's.status',
					's.current_period_start',
					's.current_period_end',
					's.trial_start',
					's.trial_end',
					'sp.ai_queries_per_month',
					'sp.ai_allowed_models',
				)
				.first();

			if (!sub) {
				return res.status(403).json({ errors: [{ message: 'No active subscription' }] });
			}

			const limit: number | null = sub.ai_queries_per_month;

			// 0 = no AI access
			if (limit === 0) {
				return res.status(403).json({ errors: [{ message: "Your plan doesn't include AI Assistant. Please upgrade." }] });
			}

			// Determine billing period
			const { periodStart, periodEnd } = getBillingPeriod(sub);

			// null = unlimited
			if (limit === null || limit === undefined) {
				req.aiQuota = { queriesUsed: 0, queriesLimit: null, periodStart, periodEnd, allowedModels: sub.ai_allowed_models || null } as AiQuota;
				return next();
			}

			// Count queries in current period
			const [{ count }] = await db('ai_token_usage')
				.where('account', accountId)
				.where('date_created', '>=', periodStart.toISOString())
				.count('* as count');

			const used = parseInt(count as string, 10) || 0;

			if (used >= limit) {
				const resetDate = periodEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
				return res.status(429).json({
					errors: [{ message: `AI query limit reached (${used}/${limit} this month). Resets ${resetDate}.` }],
					usage: { queries_used: used, queries_limit: limit, period_start: periodStart.toISOString(), period_end: periodEnd.toISOString() },
				});
			}

			req.aiQuota = { queriesUsed: used, queriesLimit: limit, periodStart, periodEnd, allowedModels: sub.ai_allowed_models || null } as AiQuota;
			next();
		} catch (err) {
			return res.status(500).json({ errors: [{ message: 'AI quota check failed' }] });
		}
	};
}

function getBillingPeriod(sub: any): { periodStart: Date; periodEnd: Date } {
	if (sub.current_period_start && sub.current_period_end) {
		return { periodStart: new Date(sub.current_period_start), periodEnd: new Date(sub.current_period_end) };
	}

	// Trialing: use trial_start + 30 days
	if (sub.status === 'trialing' && sub.trial_start) {
		const start = new Date(sub.trial_start);
		const end = new Date(start);
		end.setDate(end.getDate() + 30);
		return { periodStart: start, periodEnd: end };
	}

	// Fallback: calendar month
	const now = new Date();
	const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
	const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
	return { periodStart, periodEnd };
}
