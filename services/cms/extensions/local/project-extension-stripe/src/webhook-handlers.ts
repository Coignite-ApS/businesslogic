import type Stripe from 'stripe';
import type { DB, Module, Tier } from './types.js';
import { STATUS_MAP as _STATUS_MAP, provisionSubscriptionRow, provisionWalletTopup, computeSubscriptionDates } from './provisioning.js';

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

// Re-export so callers can still reference STATUS_MAP from this module
const STATUS_MAP = _STATUS_MAP;

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
	stripe: Stripe,
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

	// Fetch the Stripe subscription to get accurate status, period dates, and trial dates.
	// The checkout.session.completed event only has the subscription ID, not the full object.
	let stripeSub: Stripe.Subscription;
	try {
		stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
	} catch (err: any) {
		logger.error(`checkout.session.completed: failed to retrieve Stripe subscription ${subscriptionId}: ${err.message}`);
		return;
	}

	const subStatus = STATUS_MAP[stripeSub.status] || stripeSub.status;
	const dates = computeSubscriptionDates(stripeSub);

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

	// Single transaction: upsert the subscription row.
	// The partial unique index `subscriptions_unique_active_per_module`
	// enforces at most one non-terminal sub per (account, module).
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
			status: subStatus,
			billing_cycle: billingCycle,
			stripe_customer_id: customerId,
			stripe_subscription_id: subscriptionId,
			current_period_start: dates.current_period_start,
			current_period_end: dates.current_period_end,
			trial_start: dates.trial_start,
			trial_end: dates.trial_end,
			date_updated: nowIso,
		};

		if (existing) {
			await trx('subscriptions')
				.where('id', existing.id)
				.update(baseUpdate);
			// Refresh quotas for updates too — the Directus action hook only fires
			// for ItemsService writes; raw SQL updates bypass it.
			try {
				await trx.raw('SELECT public.refresh_feature_quotas(?)', [accountId]);
				logger.info(`feature_quotas refreshed for account=${accountId}`);
			} catch (err: any) {
				logger.error(`refresh_feature_quotas(${accountId}) failed after sub update: ${err?.message || err}`);
			}
		} else {
			await provisionSubscriptionRow(trx, logger, {
				accountId,
				module,
				tier,
				billingCycle,
				customerId,
				stripeSub,
				subStatus,
				source: 'webhook',
			});
		}
	});

	logger.info(`Subscription activated for account=${accountId} module=${module} tier=${tier} stripe_sub=${subscriptionId} status=${subStatus}`);
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

	const isAutoReload = meta.is_auto_reload === 'true';

	const { created } = await provisionWalletTopup(db, logger, {
		accountId,
		amountEur,
		paymentIntent: intent,
		isAutoReload,
		source: 'webhook',
	});

	if (!created) {
		logger.info(`wallet_topup payment_intent ${intent.id} already credited — skipping (dup webhook)`);
		return;
	}

	logger.info(`Wallet credited: account=${accountId} amount=€${amountEur.toFixed(2)} pi=${intent.id} auto_reload=${isAutoReload}`);
}

// ────────────────────────────────────────────────────────────────────────────
// payment_intent.payment_failed — auto-reload failure handler.
// ────────────────────────────────────────────────────────────────────────────
//
// For non-auto-reload failures (manual top-ups from Checkout), there's nothing
// for us to do — Stripe Checkout shows the error to the user directly.
// For auto-reload failures, we flip the pending row to 'failed' so it surfaces
// in ops dashboards. A subsequent debit that still crosses the threshold will
// enqueue a fresh row (the partial UNIQUE scope excludes 'failed' rows).

export async function handlePaymentIntentFailed(
	intent: Stripe.PaymentIntent,
	db: DB,
	logger: any,
): Promise<void> {
	const meta = intent.metadata || {};
	if (meta.is_auto_reload !== 'true') {
		logger.debug?.(`payment_intent.payment_failed ${intent.id}: not an auto-reload, skipping`);
		return;
	}

	const failureMessage = intent.last_payment_error?.message
		|| intent.last_payment_error?.code
		|| 'payment_failed';

	const updated = await db('wallet_auto_reload_pending')
		.where('stripe_payment_intent_id', intent.id)
		.update({
			status: 'failed',
			processed_at: new Date().toISOString(),
			last_error: String(failureMessage).slice(0, 1000),
		});

	if (updated === 0) {
		logger.warn(`payment_intent.payment_failed ${intent.id}: no matching auto-reload row`);
	} else {
		logger.info(`Auto-reload PI ${intent.id} marked failed: ${failureMessage}`);
	}
}
