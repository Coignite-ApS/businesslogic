import type { DB } from './types.js';
import { getActiveSubscription } from '../../_shared/v2-subscription.js';

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

export async function getActiveAccount(db: DB, userId: string): Promise<string | null> {
	const user = await db('directus_users')
		.where('id', userId)
		.select('active_account')
		.first();
	return user?.active_account || null;
}

export function requireActiveSubscription(db: DB) {
	return async (req: any, res: any, next: () => void) => {
		const userId = req.accountability?.user;
		if (!userId) {
			return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
		}

		if (req.accountability.admin) return next();

		try {
			const user = await db('directus_users').where('id', userId).select('active_account').first();
			if (!user?.active_account) {
				return res.status(403).json({ errors: [{ message: 'No active account' }] });
			}

			const account = await db('account').where('id', user.active_account).select('exempt_from_subscription').first();
			if (account?.exempt_from_subscription) return next();

			// v2: check active subscription scoped to KB module.
			//   account → account_id; module = 'kb'.
			// The shared helper already excludes canceled/expired statuses.
			const sub = await getActiveSubscription(db, user.active_account, 'kb');

			if (!sub) {
				return res.status(403).json({ errors: [{ message: 'No active Knowledge Base subscription' }] });
			}

			if (sub.status === 'trialing' && sub.trial_end && new Date(sub.trial_end) < new Date()) {
				return res.status(403).json({ errors: [{ message: 'Knowledge Base trial expired' }] });
			}

			next();
		} catch {
			return res.status(500).json({ errors: [{ message: 'Subscription check failed' }] });
		}
	};
}
