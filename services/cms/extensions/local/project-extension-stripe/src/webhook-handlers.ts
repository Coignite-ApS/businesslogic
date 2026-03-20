import type Stripe from 'stripe';
import type { DB } from './types.js';

export async function handleProductUpdated(
	product: Stripe.Product,
	stripe: Stripe,
	db: DB,
	logger: any,
) {
	const productId = product.id;

	const row = await db('subscription_plans')
		.where('stripe_product_id', productId)
		.first();

	if (!row) {
		logger.debug(`No local plan for stripe_product_id=${productId}`);
		return;
	}

	// Sync metadata → limits
	const updates: Record<string, any> = {};
	const meta = product.metadata || {};

	if (meta.bl_request_limit) updates.calls_per_month = parseInt(meta.bl_request_limit, 10) || null;
	if (meta.bl_service_limit) updates.calculator_limit = parseInt(meta.bl_service_limit, 10) || null;

	// Fetch prices for this product
	const prices = await stripe.prices.list({ product: productId, active: true, limit: 10 });
	for (const price of prices.data) {
		if (price.type !== 'recurring' || !price.unit_amount) continue;
		if (price.recurring?.interval === 'month') updates.monthly_price = price.unit_amount;
		if (price.recurring?.interval === 'year') updates.yearly_price = price.unit_amount;
	}

	if (Object.keys(updates).length > 0) {
		await db('subscription_plans')
			.where('stripe_product_id', productId)
			.update(updates);
		logger.info(`Plan synced from Stripe product ${productId}: ${JSON.stringify(updates)}`);
	}
}

export async function syncAllProducts(
	stripe: Stripe,
	db: DB,
	logger: any,
) {
	const plans = await db('subscription_plans').whereNotNull('stripe_product_id');
	for (const plan of plans) {
		try {
			const product = await stripe.products.retrieve(plan.stripe_product_id);
			await handleProductUpdated(product, stripe, db, logger);
		} catch (err: any) {
			logger.warn(`Failed to sync product ${plan.stripe_product_id}: ${err.message}`);
		}
	}
}

export async function handleCheckoutCompleted(
	session: Stripe.Checkout.Session,
	db: DB,
	logger: any,
) {
	const subscriptionId = session.subscription as string;
	const customerId = session.customer as string;
	const accountId = session.metadata?.account_id;

	if (!accountId || !subscriptionId) {
		logger.warn('Checkout session missing account_id or subscription');
		return;
	}

	await db('subscriptions')
		.where('account', accountId)
		.update({
			status: 'active',
			stripe_customer_id: customerId,
			stripe_subscription_id: subscriptionId,
			date_updated: new Date().toISOString(),
		});

	logger.info(`Subscription activated for account ${accountId}`);
}

export async function handleSubscriptionUpdated(
	subscription: Stripe.Subscription,
	db: DB,
	logger: any,
) {
	const stripeSubId = subscription.id;

	const row = await db('subscriptions')
		.where('stripe_subscription_id', stripeSubId)
		.first();

	if (!row) {
		logger.warn(`No local subscription for stripe_subscription_id=${stripeSubId}`);
		return;
	}

	const statusMap: Record<string, string> = {
		active: 'active',
		trialing: 'trialing',
		past_due: 'past_due',
		canceled: 'canceled',
		unpaid: 'past_due',
		incomplete: 'past_due',
		incomplete_expired: 'expired',
		paused: 'canceled',
	};

	await db('subscriptions')
		.where('stripe_subscription_id', stripeSubId)
		.update({
			status: statusMap[subscription.status] || subscription.status,
			current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
			current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
			date_updated: new Date().toISOString(),
		});

	logger.info(`Subscription ${stripeSubId} updated to ${subscription.status}`);
}

export async function handleSubscriptionDeleted(
	subscription: Stripe.Subscription,
	db: DB,
	logger: any,
) {
	await db('subscriptions')
		.where('stripe_subscription_id', subscription.id)
		.update({
			status: 'canceled',
			date_updated: new Date().toISOString(),
		});

	logger.info(`Subscription ${subscription.id} canceled`);
}

export async function handleInvoicePaymentFailed(
	invoice: Stripe.Invoice,
	db: DB,
	logger: any,
) {
	const stripeSubId = invoice.subscription as string;
	if (!stripeSubId) return;

	await db('subscriptions')
		.where('stripe_subscription_id', stripeSubId)
		.update({
			status: 'past_due',
			date_updated: new Date().toISOString(),
		});

	logger.info(`Subscription ${stripeSubId} marked past_due (payment failed)`);
}
