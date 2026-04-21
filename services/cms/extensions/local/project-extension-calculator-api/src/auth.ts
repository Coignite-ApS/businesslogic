import type { DB } from './types.js';
import { getActiveSubscription } from '../../_shared/v2-subscription.js';

export interface SubscriptionInfo {
	exempt: boolean;
	/** v2: number of slots the account is allowed to consume (was v1 calculator_limit). */
	calculator_limit: number | null;
	/** Active calculators belonging to the account. Until task 19 ships size classes, 1 calc = 1 slot. */
	active_count: number;
}

/** Get subscription limit info for an account (calculators module). */
export async function getSubscriptionInfo(db: DB, accountId: string): Promise<SubscriptionInfo> {
	const account = await db('account')
		.where('id', accountId)
		.select('exempt_from_subscription')
		.first();

	if (account?.exempt_from_subscription) {
		return { exempt: true, calculator_limit: null, active_count: 0 };
	}

	const sub = await getActiveSubscription(db, accountId, 'calculators');

	const { count } = await db('calculators')
		.where('account', accountId)
		.where('activated', true)
		.count('* as count')
		.first() as any;

	return {
		exempt: false,
		// v2: slot_allowance replaces v1 calculator_limit (semantic shift — 1 calc = 1 slot
		// until task 19 ships size classification populating calculator_slots.slots_consumed).
		calculator_limit: sub?.slot_allowance ?? null,
		active_count: parseInt(count, 10) || 0,
	};
}

/** Parse a calc route ID (e.g. "my-calc-test") into calculator ID + test flag */
export function parseCalcId(calcId: string): { calculatorId: string; isTest: boolean } {
	if (calcId.endsWith('-test')) {
		return { calculatorId: calcId.slice(0, -5), isTest: true };
	}
	return { calculatorId: calcId, isTest: false };
}

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

export function requireCalculatorAccess(db: DB) {
	return async (req: any, res: any, next: () => void) => {
		const userId = req.accountability?.user;
		if (!userId) {
			return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
		}

		// Admins bypass ownership check
		if (req.accountability.admin) {
			return next();
		}

		const calcId = req.params.calcId;
		if (!calcId) {
			return res.status(400).json({ errors: [{ message: 'Missing calculator ID' }] });
		}

		const { calculatorId } = parseCalcId(calcId);

		try {
			const row = await db('calculators as c')
				.join('account_directus_users as adu', 'adu.account_id', 'c.account')
				.where('c.id', calculatorId)
				.andWhere('adu.directus_users_id', userId)
				.select(db.raw('1'))
				.first();

			if (!row) {
				return res.status(403).json({ errors: [{ message: 'Access denied' }] });
			}

			next();
		} catch (err) {
			return res.status(500).json({ errors: [{ message: 'Access check failed' }] });
		}
	};
}

export function requireActiveSubscription(db: DB) {
	return async (req: any, res: any, next: () => void) => {
		const userId = req.accountability?.user;
		if (!userId) {
			return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
		}

		// Admins bypass subscription check
		if (req.accountability.admin) {
			return next();
		}

		try {
			// Get user's active_account
			const user = await db('directus_users')
				.where('id', userId)
				.select('active_account')
				.first();

			if (!user?.active_account) {
				return res.status(403).json({ errors: [{ message: 'No active account. Please select an account.' }] });
			}

			// Check if account is exempt from subscription requirements
			const account = await db('account')
				.where('id', user.active_account)
				.select('exempt_from_subscription')
				.first();

			if (account?.exempt_from_subscription) {
				return next();
			}

			// v2: get the calculators-module subscription joined with its plan allowances.
			const sub = await getActiveSubscription(db, user.active_account, 'calculators');

			if (!sub) {
				return res.status(403).json({ errors: [{ message: 'No active Calculators subscription. Please subscribe.' }] });
			}

			// (status filter `whereNotIn('canceled','expired')` already done in
			// getActiveSubscription; only trial-expiry is left to enforce here.)
			if (sub.status === 'trialing' && sub.trial_end && new Date(sub.trial_end) < new Date()) {
				return res.status(403).json({ errors: [{ message: 'Calculators trial expired. Please subscribe to continue.' }] });
			}

			// Attach limits for downstream use.
			// Field renames vs v1:
			//   calls_per_month   → request_allowance
			//   calls_per_second  → rps_allowance (DB-backed; migration 038)
			//   calculator_limit  → slot_allowance (1 calc = 1 slot until task 19)
			req.subscriptionLimits = {
				calls_per_month: sub.request_allowance,
				calls_per_second: sub.rps_allowance,
				calculator_limit: sub.slot_allowance,
			};

			next();
		} catch (err) {
			return res.status(500).json({ errors: [{ message: 'Subscription check failed' }] });
		}
	};
}
