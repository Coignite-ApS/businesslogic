import type { DB } from './types.js';
import { getActiveSubscription, hasWalletBalance } from '../../_shared/v2-subscription.js';

/**
 * Check whether the account is allowed to create another Knowledge Base.
 *
 * v2 NOTE: the legacy `kb_limit` column was dropped from `subscription_plans`.
 * v2 plans do NOT cap the number of knowledge bases — only `storage_mb` and
 * `embed_tokens_m` are enforced. This function is preserved for API stability
 * (existing callers pattern-match `{ allowed, current, limit }`) but always
 * returns `allowed: true` with `limit: null`.
 *
 * Removing the count gate aligns with the modular philosophy: capacity is
 * priced by what users actually consume (bytes stored, tokens embedded),
 * not by how the user organizes their content into KBs.
 */
export async function checkKbLimit(db: DB, accountId: string): Promise<{ allowed: boolean; current: number; limit: number | null }> {
	// Still report current count so callers can render "X knowledge bases" UI.
	const [{ count }] = await db('knowledge_bases')
		.where('account', accountId)
		.count('* as count');
	return { allowed: true, current: parseInt(count as string, 10) || 0, limit: null };
}

/**
 * Check whether the account has KB storage headroom for `additionalBytes` more
 * uploaded content.
 *
 * v2 NOTE: `kb_storage_mb` → `storage_mb` (column rename in subscription_plans).
 * Filters subscriptions to `module = 'kb'`.
 */
export async function checkKbStorage(db: DB, accountId: string, additionalBytes: number = 0): Promise<{ allowed: boolean; usedMb: number; limitMb: number | null }> {
	const account = await db('account').where('id', accountId).select('exempt_from_subscription').first();
	if (account?.exempt_from_subscription) {
		return { allowed: true, usedMb: 0, limitMb: null };
	}

	const sub = await getActiveSubscription(db, accountId, 'kb');

	if (!sub || sub.storage_mb === null || sub.storage_mb === undefined) {
		// No active KB sub OR Enterprise (unbounded) — allow.
		return { allowed: true, usedMb: 0, limitMb: null };
	}

	const [{ total }] = await db('kb_documents')
		.where('account', accountId)
		.select(db.raw('COALESCE(SUM(file_size), 0) as total'));

	const usedBytes = parseInt(total as string, 10) || 0;
	const totalBytes = usedBytes + additionalBytes;
	const usedMb = Math.round(totalBytes / (1024 * 1024) * 100) / 100;

	return { allowed: totalBytes <= sub.storage_mb * 1024 * 1024, usedMb, limitMb: sub.storage_mb };
}

/**
 * Gate KB Q&A budget on AI Wallet balance (was: `ai_queries_per_month` quota).
 *
 * v2 NOTE: per-tier monthly query quotas are gone. AI consumption is metered
 * against the per-account `ai_wallet.balance_eur`. If the balance is ≤ 0,
 * KB Q&A is blocked with a 402-equivalent (UI prompts a top-up).
 *
 * The actual €-cost debit happens after the call completes (task 18).
 * This is a coarse pre-flight gate to avoid running expensive embeddings + LLM
 * calls when the wallet is already empty.
 *
 * The shape of the return object is preserved so existing callers that
 * pattern-match `{ allowed, used, limit }` keep working: `used` is now wallet
 * balance, `limit` is monthly_cap_eur (or null if uncapped).
 */
export async function checkAiQuota(db: DB, accountId: string): Promise<{ allowed: boolean; used: number; limit: number | null }> {
	const account = await db('account').where('id', accountId).select('exempt_from_subscription').first();
	if (account?.exempt_from_subscription) {
		return { allowed: true, used: 0, limit: null };
	}

	const ok = await hasWalletBalance(db, accountId);
	return { allowed: ok, used: 0, limit: null };
}
