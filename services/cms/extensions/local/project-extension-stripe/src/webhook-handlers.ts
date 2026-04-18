import type Stripe from 'stripe';
import type { DB, Module, Tier } from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Idempotency helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when this Stripe event has already been processed.
 * Reads `public.stripe_webhook_events` (created by migration 016).
 */
async function alreadyProcessed(db: DB, eventId: string): Promise<boolean> {
	const row = await db('stripe_webhook_events')
		.where('stripe_event_id', eventId)
		.first();
	return !!row;
}

/**
 * Marks an event as processed. Race-safe via UNIQUE(stripe_event_id);
 * the second attempt will swallow the duplicate-key error silently.
 */
async function markProcessed(
	db: DB,
	eventId: string,
	eventType: string,
	payload: Record<string, any> | null = null,
): Promise<void> {
	try {
		await db('stripe_webhook_events').insert({
			stripe_event_id: eventId,
			event_type: eventType,
			payload,
		});
	} catch (err: any) {
		// Duplicate key (PG 23505) means another worker beat us — that's fine.
		if (err?.code !== '23505') throw err;
	}
}

/**
 * Wrap a handler with the dedup check. Returns 'duplicate' (already processed),
 * 'ok' (processed now), or throws.
 */
export async function withIdempotency<T = void>(
	db: DB,
	event: Pick<Stripe.Event, 'id' | 'type' | 'data'>,
	logger: any,
	work: () => Promise<T>,
): Promise<'duplicate' | 'ok'> {
	if (await alreadyProcessed(db, event.id)) {
		logger.debug?.(`Stripe webhook ${event.id} (${event.type}) already processed — skipping`);
		return 'duplicate';
	}
	await work();
	await markProcessed(db, event.id, event.type, (event.data?.object as any) ?? null);
	return 'ok';
}

// ────────────────────────────────────────────────────────────────────────────
// product.updated — sync subscription_plans from Stripe
// ────────────────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, string> = {
	active: 'active',
	trialing: 'trialing',
	past_due: 'past_due',
	canceled: 'canceled',
	unpaid: 'past_due',
	incomplete: 'past_due',
	incomplete_expired: 'expired',
	paused: 'canceled',
};

function isV2Product(product: Stripe.Product): boolean {
	return (product.metadata || {}).pricing_version === 'v2';
}

/**
 * Fetch active prices for a Stripe product and find the first matching
 * `metadata.interval` ('month' | 'year') in the requested currency.
 */
async function findStripePriceId(
	stripe: Stripe,
	productId: string,
	currency: string,
	interval: 'month' | 'year',
): Promise<string | null> {
	const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
	for (const price of prices.data) {
		if (price.currency !== currency) continue;
		// Prefer explicit metadata.interval (set by create-products-v2 script)
		const metaInterval = (price.metadata || {}).interval;
		if (metaInterval === interval) return price.id;
		// Fallback: standard recurring.interval match
		if (!metaInterval && price.recurring?.interval === interval) return price.id;
	}
	return null;
}

/**
 * Sync `subscription_plans` row for the given Stripe product.
 * Looks up the row by (stripe_product_id, module, tier) so out-of-band
 * (Stripe Dashboard) renames cannot collide across module/tier rows.
 */
export async function handleProductUpdated(
	product: Stripe.Product,
	stripe: Stripe,
	db: DB,
	logger: any,
): Promise<void> {
	if (!isV2Product(product)) {
		logger.debug?.(`Skipping non-v2 Stripe product ${product.id}`);
		return;
	}

	const meta = product.metadata || {};
	const module = meta.module as Module | undefined;
	const tier = meta.tier as Tier | undefined;

	if (!module || !tier) {
		logger.debug?.(`v2 product ${product.id} missing module/tier metadata — skipping plan sync`);
		return;
	}

	const planRow = await db('subscription_plans')
		.where('stripe_product_id', product.id)
		.where('module', module)
		.where('tier', tier)
		.first();

	if (!planRow) {
		logger.warn(`No subscription_plans row matches stripe_product=${product.id} module=${module} tier=${tier}`);
		return;
	}

	const updates: Record<string, any> = {
		date_updated: new Date().toISOString(),
	};

	const monthlyId = await findStripePriceId(stripe, product.id, 'eur', 'month');
	const annualId = await findStripePriceId(stripe, product.id, 'eur', 'year');
	if (monthlyId) updates.stripe_price_monthly_id = monthlyId;
	if (annualId) updates.stripe_price_annual_id = annualId;

	// Sync EUR price snapshots if the matching prices were found
	const allPrices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
	for (const price of allPrices.data) {
		if (price.currency !== 'eur' || !price.unit_amount) continue;
		const interval = (price.metadata || {}).interval || price.recurring?.interval;
		if (interval === 'month') updates.price_eur_monthly = (price.unit_amount / 100).toFixed(2);
		if (interval === 'year') updates.price_eur_annual = (price.unit_amount / 100).toFixed(2);
	}

	await db('subscription_plans')
		.where('id', planRow.id)
		.update(updates);

	logger.info(`Synced subscription_plans (${module}/${tier}) from Stripe product ${product.id}`);
}

/**
 * Iterate all v2 plans and re-sync each from Stripe. Called on extension boot.
 */
export async function syncAllProducts(
	stripe: Stripe,
	db: DB,
	logger: any,
): Promise<void> {
	const plans = await db('subscription_plans').whereNotNull('stripe_product_id');
	for (const plan of plans) {
		try {
			const product = await stripe.products.retrieve(plan.stripe_product_id);
			await handleProductUpdated(product as Stripe.Product, stripe, db, logger);
		} catch (err: any) {
			logger.warn(`Failed to sync product ${plan.stripe_product_id}: ${err.message}`);
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// checkout.session.completed — provision subscription per (account, module)
// ────────────────────────────────────────────────────────────────────────────

export async function handleCheckoutCompleted(
	session: Stripe.Checkout.Session,
	db: DB,
	logger: any,
): Promise<void> {
	const subscriptionId = session.subscription as string | null;
	const customerId = session.customer as string | null;
	const accountId = session.metadata?.account_id;
	const module = session.metadata?.module as Module | undefined;
	const tier = session.metadata?.tier as Tier | undefined;
	const billingCycle = (session.metadata?.billing_cycle as 'monthly' | 'annual' | undefined) || null;

	if (!accountId || !module || !tier) {
		logger.warn(`checkout.session.completed missing required metadata (account_id/module/tier) on session ${session.id}`);
		return;
	}
	if (!subscriptionId) {
		logger.debug?.(`checkout.session.completed without subscription on ${session.id} — likely one-time purchase, skipping`);
		return;
	}

	// Lookup target plan by (module, tier, status='published')
	const plan = await db('subscription_plans')
		.where('module', module)
		.where('tier', tier)
		.where('status', 'published')
		.first();

	if (!plan) {
		logger.error(`No published subscription_plans row for module=${module} tier=${tier} — cannot provision sub for account=${accountId}`);
		return;
	}

	// Single transaction: cancel any other non-terminal subs for this (account,module)
	// then upsert the active one. The partial unique index
	// `subscriptions_unique_active_per_module` enforces invariant.
	await db.transaction(async (trx: DB) => {
		const existing = await trx('subscriptions')
			.where('account_id', accountId)
			.where('module', module)
			.whereNotIn('status', ['canceled', 'expired'])
			.first();

		const nowIso = new Date().toISOString();
		const baseUpdate: Record<string, any> = {
			subscription_plan_id: plan.id,
			tier,
			status: 'active',
			billing_cycle: billingCycle,
			stripe_customer_id: customerId,
			stripe_subscription_id: subscriptionId,
			date_updated: nowIso,
		};

		if (existing) {
			await trx('subscriptions')
				.where('id', existing.id)
				.update(baseUpdate);
		} else {
			// gen_random_uuid via DB default isn't on this table (PK has no default in 005).
			// Use the database to generate the id.
			const [row] = await trx.raw(
				`INSERT INTO public.subscriptions (
					id, account_id, subscription_plan_id, module, tier, status, billing_cycle,
					stripe_customer_id, stripe_subscription_id, date_created, date_updated
				) VALUES (
					gen_random_uuid(), ?, ?, ?, ?, 'active', ?, ?, ?, now(), ?
				) RETURNING id`,
				[accountId, plan.id, module, tier, billingCycle, customerId, subscriptionId, nowIso],
			).then((r: any) => r.rows ?? r[0]?.rows ?? r);
			logger.info(`Created subscription row ${row?.id ?? '<id>'} for account=${accountId} module=${module} tier=${tier}`);
		}
	});

	logger.info(`Subscription activated for account=${accountId} module=${module} tier=${tier} stripe_sub=${subscriptionId}`);
}

// ────────────────────────────────────────────────────────────────────────────
// customer.subscription.updated
// ────────────────────────────────────────────────────────────────────────────

export async function handleSubscriptionUpdated(
	subscription: Stripe.Subscription,
	db: DB,
	logger: any,
): Promise<void> {
	const stripeSubId = subscription.id;

	const row = await db('subscriptions')
		.where('stripe_subscription_id', stripeSubId)
		.first();

	if (!row) {
		logger.warn(`No local subscription for stripe_subscription_id=${stripeSubId}`);
		return;
	}

	const status = STATUS_MAP[subscription.status] || subscription.status;
	const nowIso = new Date().toISOString();

	await db.transaction(async (trx: DB) => {
		await trx('subscriptions')
			.where('stripe_subscription_id', stripeSubId)
			.update({
				status,
				current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
				current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
				cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
				date_updated: nowIso,
			});

		// Upsert recurring add-ons attached to this subscription
		const items = subscription.items?.data || [];
		for (const item of items) {
			const product: any = item.price?.product;
			const productMeta = (typeof product === 'object' && product?.metadata) || {};
			if (productMeta.product_kind !== 'recurring_addon') continue;

			const addonKind = productMeta.addon_kind || 'unknown';
			const slotDelta = parseIntOrNull(productMeta.slot_allowance_delta);
			const aoDelta = parseIntOrNull(productMeta.ao_allowance_delta);
			const storageDelta = parseIntOrNull(productMeta.storage_mb_delta);
			const requestDelta = parseIntOrNull(productMeta.request_allowance_delta);

			const priceMonthly = item.price?.unit_amount != null
				? (item.price.unit_amount / 100).toFixed(2)
				: null;

			// Upsert by stripe_subscription_item_id (UNIQUE)
			const existingAddon = await trx('subscription_addons')
				.where('stripe_subscription_item_id', item.id)
				.first();

			const addonRow: Record<string, any> = {
				account_id: row.account_id,
				subscription_id: row.id,
				addon_kind: addonKind,
				quantity: item.quantity ?? 1,
				slot_allowance_delta: slotDelta,
				ao_allowance_delta: aoDelta,
				storage_mb_delta: storageDelta,
				request_allowance_delta: requestDelta,
				stripe_subscription_item_id: item.id,
				stripe_price_id: item.price?.id ?? null,
				price_eur_monthly: priceMonthly,
				currency: (item.price?.currency || 'eur').toUpperCase(),
				status: 'active',
				current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
				current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
				date_updated: nowIso,
			};

			if (existingAddon) {
				await trx('subscription_addons').where('id', existingAddon.id).update(addonRow);
			} else {
				await trx('subscription_addons').insert(addonRow);
			}
		}
	});

	logger.info(`Subscription ${stripeSubId} updated → status=${status}`);
}

function parseIntOrNull(v: unknown): number | null {
	if (v == null || v === '') return null;
	const n = parseInt(String(v), 10);
	return Number.isFinite(n) ? n : null;
}

// ────────────────────────────────────────────────────────────────────────────
// customer.subscription.deleted
// ────────────────────────────────────────────────────────────────────────────

export async function handleSubscriptionDeleted(
	subscription: Stripe.Subscription,
	db: DB,
	logger: any,
): Promise<void> {
	const nowIso = new Date().toISOString();

	await db.transaction(async (trx: DB) => {
		const row = await trx('subscriptions')
			.where('stripe_subscription_id', subscription.id)
			.first();

		if (!row) {
			logger.warn(`subscription.deleted: no local row for stripe_subscription_id=${subscription.id}`);
			return;
		}

		await trx('subscriptions')
			.where('id', row.id)
			.update({
				status: 'canceled',
				cancel_at: nowIso,
				date_updated: nowIso,
			});

		// Cascade-cancel all active add-ons on this subscription
		await trx('subscription_addons')
			.where('subscription_id', row.id)
			.where('status', 'active')
			.update({
				status: 'canceled',
				cancel_at: nowIso,
				date_updated: nowIso,
			});
	});

	logger.info(`Subscription ${subscription.id} canceled (cascade-canceled add-ons)`);
}

// ────────────────────────────────────────────────────────────────────────────
// invoice.payment_failed
// ────────────────────────────────────────────────────────────────────────────

export async function handleInvoicePaymentFailed(
	invoice: Stripe.Invoice,
	db: DB,
	logger: any,
): Promise<void> {
	const stripeSubId = invoice.subscription as string | null;
	if (!stripeSubId) {
		logger.debug?.('invoice.payment_failed without subscription — likely a one-time invoice, skipping');
		return;
	}

	await db('subscriptions')
		.where('stripe_subscription_id', stripeSubId)
		.update({
			status: 'past_due',
			date_updated: new Date().toISOString(),
		});

	logger.info(`Subscription ${stripeSubId} marked past_due (payment failed)`);
}

// ────────────────────────────────────────────────────────────────────────────
// payment_intent.succeeded — wallet top-ups (Phase 3) + addon top-ups (later).
// ────────────────────────────────────────────────────────────────────────────

export async function handlePaymentIntentSucceeded(
	intent: Stripe.PaymentIntent,
	db: DB,
	logger: any,
): Promise<void> {
	const meta = intent.metadata || {};
	if (meta.pricing_version !== 'v2') {
		logger.debug?.(`payment_intent.succeeded ${intent.id}: not a v2 payment, ignoring`);
		return;
	}

	const kind = meta.product_kind;
	if (kind === 'wallet_topup') {
		await processWalletTopupSucceeded(intent, db, logger);
		return;
	}
	if (kind === 'addon_topup') {
		// Addon top-ups are out of Phase 3 scope; emitted-credit logic ships later.
		logger.info(`payment_intent.succeeded ${intent.id}: addon_topup not yet implemented`);
		return;
	}

	logger.debug?.(`payment_intent.succeeded ${intent.id}: unknown product_kind=${kind || '<missing>'}, skipping`);
}

/**
 * Credit a successful wallet top-up to ai_wallet (atomically: topup row + balance + ledger).
 *
 * Idempotency: the `stripe_payment_intent_id` UNIQUE constraint on ai_wallet_topup
 * gates the entire credit. If the row already exists, we no-op — even if the
 * outer stripe_webhook_events ledger missed the dedup (belt + suspenders).
 */
async function processWalletTopupSucceeded(
	intent: Stripe.PaymentIntent,
	db: DB,
	logger: any,
): Promise<void> {
	const meta = intent.metadata || {};
	const accountId = meta.account_id;
	const amountStr = meta.wallet_topup_amount_eur;
	const amountEur = amountStr ? Number(amountStr) : NaN;

	if (!accountId) {
		logger.warn(`wallet_topup payment_intent ${intent.id} missing metadata.account_id — skipping`);
		return;
	}
	if (!Number.isFinite(amountEur) || amountEur <= 0) {
		logger.warn(`wallet_topup payment_intent ${intent.id} invalid metadata.wallet_topup_amount_eur=${amountStr}`);
		return;
	}

	const chargeId = (intent.latest_charge && typeof intent.latest_charge === 'string')
		? intent.latest_charge
		: (intent.latest_charge as any)?.id ?? null;

	await db.transaction(async (trx: DB) => {
		// 1. Insert ai_wallet_topup; ON CONFLICT DO NOTHING for idempotency.
		const insertedTopupRows = await trx.raw(
			`INSERT INTO public.ai_wallet_topup (
				id, account_id, amount_eur, stripe_payment_intent_id, stripe_charge_id,
				expires_at, is_auto_reload, status, date_created
			) VALUES (
				gen_random_uuid(), ?, ?, ?, ?, NOW() + INTERVAL '12 months', false, 'completed', NOW()
			)
			ON CONFLICT (stripe_payment_intent_id) DO NOTHING
			RETURNING id`,
			[accountId, amountEur, intent.id, chargeId],
		);

		// Knex .raw returns either { rows } (pg) or [rows, fields].
		const rows = (insertedTopupRows as any).rows
			?? (Array.isArray(insertedTopupRows) ? insertedTopupRows[0] : null)
			?? [];

		if (!rows || rows.length === 0) {
			// Already inserted — duplicate webhook delivery. Ledger and balance
			// already updated in the original transaction. No-op.
			logger.info(`wallet_topup payment_intent ${intent.id} already credited — skipping (dup webhook)`);
			return;
		}
		const topupId = rows[0].id;

		// 2. Ensure ai_wallet row exists, then increment balance atomically.
		// Single UPSERT keyed on UNIQUE(account_id).
		const updatedWallets = await trx.raw(
			`INSERT INTO public.ai_wallet (id, account_id, balance_eur, last_topup_at, last_topup_eur, date_created)
			VALUES (gen_random_uuid(), ?, ?, NOW(), ?, NOW())
			ON CONFLICT (account_id) DO UPDATE SET
				balance_eur = ai_wallet.balance_eur + EXCLUDED.balance_eur,
				last_topup_at = NOW(),
				last_topup_eur = EXCLUDED.last_topup_eur,
				date_updated = NOW()
			RETURNING balance_eur`,
			[accountId, amountEur, amountEur],
		);
		const walletRows = (updatedWallets as any).rows
			?? (Array.isArray(updatedWallets) ? updatedWallets[0] : null)
			?? [];
		const newBalance = walletRows[0]?.balance_eur;
		if (newBalance == null) {
			throw new Error(`Failed to upsert ai_wallet for account ${accountId}`);
		}

		// 3. Insert ledger entry recording the credit.
		await trx('ai_wallet_ledger').insert({
			account_id: accountId,
			entry_type: 'credit',
			amount_eur: amountEur,
			balance_after_eur: newBalance,
			source: 'topup',
			topup_id: topupId,
			metadata: JSON.stringify({
				stripe_payment_intent_id: intent.id,
				stripe_charge_id: chargeId,
			}),
		});
	});

	logger.info(`Wallet credited: account=${accountId} amount=€${amountEur.toFixed(2)} pi=${intent.id}`);
}
