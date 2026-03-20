import type { DB } from './types.js';

export async function checkKbLimit(db: DB, accountId: string): Promise<{ allowed: boolean; current: number; limit: number | null }> {
	const account = await db('account').where('id', accountId).select('exempt_from_subscription').first();
	if (account?.exempt_from_subscription) {
		return { allowed: true, current: 0, limit: null };
	}

	const sub = await db('subscriptions as s')
		.join('subscription_plans as sp', 'sp.id', 's.plan')
		.where('s.account', accountId)
		.whereNotIn('s.status', ['canceled', 'expired'])
		.select('sp.kb_limit')
		.first();

	if (!sub || sub.kb_limit === null || sub.kb_limit === undefined) {
		return { allowed: true, current: 0, limit: null };
	}

	const [{ count }] = await db('knowledge_bases')
		.where('account', accountId)
		.count('* as count');
	const current = parseInt(count as string, 10) || 0;

	return { allowed: current < sub.kb_limit, current, limit: sub.kb_limit };
}

export async function checkKbStorage(db: DB, accountId: string, additionalBytes: number = 0): Promise<{ allowed: boolean; usedMb: number; limitMb: number | null }> {
	const account = await db('account').where('id', accountId).select('exempt_from_subscription').first();
	if (account?.exempt_from_subscription) {
		return { allowed: true, usedMb: 0, limitMb: null };
	}

	const sub = await db('subscriptions as s')
		.join('subscription_plans as sp', 'sp.id', 's.plan')
		.where('s.account', accountId)
		.whereNotIn('s.status', ['canceled', 'expired'])
		.select('sp.kb_storage_mb')
		.first();

	if (!sub || sub.kb_storage_mb === null || sub.kb_storage_mb === undefined) {
		return { allowed: true, usedMb: 0, limitMb: null };
	}

	const [{ total }] = await db('kb_documents')
		.where('account', accountId)
		.select(db.raw('COALESCE(SUM(file_size), 0) as total'));

	const usedBytes = parseInt(total as string, 10) || 0;
	const totalBytes = usedBytes + additionalBytes;
	const usedMb = Math.round(totalBytes / (1024 * 1024) * 100) / 100;

	return { allowed: totalBytes <= sub.kb_storage_mb * 1024 * 1024, usedMb, limitMb: sub.kb_storage_mb };
}

export async function checkAiQuota(db: DB, accountId: string): Promise<{ allowed: boolean; used: number; limit: number | null }> {
	const account = await db('account').where('id', accountId).select('exempt_from_subscription').first();
	if (account?.exempt_from_subscription) {
		return { allowed: true, used: 0, limit: null };
	}

	const sub = await db('subscriptions as s')
		.join('subscription_plans as sp', 'sp.id', 's.plan')
		.where('s.account', accountId)
		.whereNotIn('s.status', ['canceled', 'expired'])
		.select('sp.ai_queries_per_month', 's.current_period_start', 's.current_period_end', 's.status', 's.trial_start')
		.first();

	if (!sub) return { allowed: false, used: 0, limit: 0 };

	const limit: number | null = sub.ai_queries_per_month;
	if (limit === null || limit === undefined) return { allowed: true, used: 0, limit: null };
	if (limit === 0) return { allowed: false, used: 0, limit: 0 };

	// Determine period start
	let periodStart: string;
	if (sub.current_period_start) {
		periodStart = new Date(sub.current_period_start).toISOString();
	} else if (sub.status === 'trialing' && sub.trial_start) {
		periodStart = new Date(sub.trial_start).toISOString();
	} else {
		const now = new Date();
		periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
	}

	const [{ count }] = await db('ai_token_usage')
		.where('account', accountId)
		.where('date_created', '>=', periodStart)
		.count('* as count');

	const used = parseInt(count as string, 10) || 0;
	return { allowed: used < limit, used, limit };
}
