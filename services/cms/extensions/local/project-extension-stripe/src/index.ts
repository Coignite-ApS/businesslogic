import { defineHook } from '@directus/extensions-sdk';
import { getStripe } from './stripe-client.js';
import { getRegistrationPage } from './register.js';
import {
	handleCheckoutCompleted,
	handleSubscriptionUpdated,
	handleSubscriptionDeleted,
	handleInvoicePaymentFailed,
	handlePaymentIntentSucceeded,
	handlePaymentIntentFailed,
	handleProductUpdated,
	syncAllProducts,
	withIdempotency,
} from './webhook-handlers.js';
import { registerWalletRoutes } from './wallet-handlers.js';
import { processAutoReloadBatch } from './auto-reload-consumer.js';
import { buildRefreshQuotasHooks, buildRefreshAllQuotasCron } from './hooks/refresh-quotas.js';
import type { Module, BillingCycle } from './types.js';

const VALID_MODULES: Module[] = ['calculators', 'kb', 'flows'];
const VALID_CYCLES: BillingCycle[] = ['monthly', 'annual'];

export default defineHook(({ init, action, schedule }, { env, logger, database, services, getSchema }) => {
	const db = database;

	// Shared Redis client for cache invalidation publishes (task 22)
	// Lazy — created once on startup; null if REDIS_URL not set.
	let pubRedis: any = null;
	const redisUrl = (env['REDIS_URL'] as string) || '';
	if (redisUrl) {
		import('ioredis').then(({ default: Redis }) => {
			pubRedis = new Redis(redisUrl, {
				maxRetriesPerRequest: 1,
				enableOfflineQueue: false,
				retryStrategy: (times: number) => (times > 5 ? null : Math.min(times * 200, 2000)),
				lazyConnect: true,
			});
			return pubRedis.connect();
		}).catch((err: any) => {
			logger.warn(`[stripe] Redis pub client init failed: ${err?.message || err}`);
		});
	}

	// ─── Registration endpoints (no Stripe dependency) ──────

	init('routes.custom.before', ({ app }) => {
		const publicUrl = (env['PUBLIC_URL'] as string) || '';

		// GET /register — serve registration page
		app.get('/register', (_req: any, res: any) => {
			res.setHeader('Content-Type', 'text/html');
			res.send(getRegistrationPage(publicUrl));
		});

		// POST /register — handle registration
		app.post('/register', async (req: any, res: any) => {
			const { name, email, password } = req.body || {};

			if (!name || !email || !password) {
				return res.status(400).json({ errors: [{ message: 'Name, email, and password are required' }] });
			}

			if (password.length < 8) {
				return res.status(400).json({ errors: [{ message: 'Password must be at least 8 characters' }] });
			}

			try {
				const schema = await getSchema();
				const { UsersService, ItemsService } = services;

				// Find default non-admin role via policies (Directus 11.x)
				const roleRow = await db('directus_roles as r')
					.join('directus_access as a', 'a.role', 'r.id')
					.join('directus_policies as p', 'p.id', 'a.policy')
					.where('p.admin_access', false)
					.whereNot('r.name', 'Formula API')
					.select('r.id')
					.first();

				// Fallback: use registration role from Directus settings
				let defaultRoleId = roleRow?.id || null;
				if (!defaultRoleId) {
					const settings = await db('directus_settings').select('public_registration_role').first();
					defaultRoleId = settings?.public_registration_role || null;
				}

				if (!defaultRoleId) {
					logger.error('No non-admin role found for registration. Create a role or set public_registration_role in settings.');
					return res.status(500).json({ errors: [{ message: 'Registration not configured — no user role found' }] });
				}

				// Split name into first/last
				const nameParts = name.trim().split(/\s+/);
				const firstName = nameParts[0];
				const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

				// Create user
				const usersService = new UsersService({ schema, accountability: { admin: true } });
				const userId = await usersService.createOne({
					first_name: firstName,
					...(lastName && { last_name: lastName }),
					email,
					password,
					role: defaultRoleId,
					status: 'active',
				});

				// Create account
				const accountService = new ItemsService('account', { schema, accountability: { admin: true } });
				const accountId = await accountService.createOne({
					name: `${name}'s Account`,
					status: 'published',
				});

				// Link user to account
				const junctionService = new ItemsService('account_directus_users', { schema, accountability: { admin: true } });
				await junctionService.createOne({
					account_id: accountId,
					directus_users_id: userId,
				});

				// Set active_account on user
				await usersService.updateOne(userId, { active_account: accountId });

				// AI Wallet signup credit is provisioned by the account.items.create hook below.

				logger.info(`Registration complete: user=${userId}, account=${accountId}`);
				return res.status(201).json({ success: true });
			} catch (err: any) {
				const msg = err?.message || 'Registration failed';
				// Handle duplicate email
				if (msg.includes('unique') || msg.includes('duplicate') || err?.code === '23505') {
					return res.status(409).json({ errors: [{ message: 'An account with this email already exists' }] });
				}
				logger.error(`Registration failed: ${msg}`);
				return res.status(500).json({ errors: [{ message: msg }] });
			}
		});

		logger.info('Registration routes registered');
	});

	// ─── AI Wallet signup credit on account create ──────────
	//
	// v2 model: empty trial. New accounts get NO subscription rows; instead
	// they receive a €5.00 promo credit on their AI Wallet so they can try
	// AI features immediately. Per-module 14-day trials start when the user
	// activates a module via /stripe/checkout.

	const SIGNUP_CREDIT_EUR = 5.00;

	action('account.items.create', async ({ key }) => {
		try {
			await db.transaction(async (trx: any) => {
				// 1. Insert ai_wallet row (UNIQUE constraint on account_id; ignore if dup)
				const existingWallet = await trx('ai_wallet').where('account_id', key).first();
				if (existingWallet) {
					logger.debug(`ai_wallet already exists for account ${key} — skipping signup credit`);
					return;
				}

				await trx('ai_wallet').insert({
					account_id: key,
					balance_eur: SIGNUP_CREDIT_EUR,
				});

				// 2. Insert ledger row recording the credit
				await trx('ai_wallet_ledger').insert({
					account_id: key,
					entry_type: 'credit',
					amount_eur: SIGNUP_CREDIT_EUR,
					balance_after_eur: SIGNUP_CREDIT_EUR,
					source: 'promo',
					metadata: JSON.stringify({ reason: 'signup_bonus' }),
				});
			});

			logger.info(`AI wallet signup credit (€${SIGNUP_CREDIT_EUR.toFixed(2)}) granted to account ${key}`);

			// Auto-provision a default API key via the gateway (unchanged from v1)
			try {
				const gwUrl = (env['GATEWAY_URL'] as string) || '';
				const gwSecret = (env['GATEWAY_INTERNAL_SECRET'] as string) || '';
				if (gwUrl && gwSecret) {
					const provisionRes = await fetch(`${gwUrl}/internal/api-keys/auto-provision`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': gwSecret },
						body: JSON.stringify({ account_id: key }),
					});
					const result = await provisionRes.json();
					if (result.provisioned) {
						logger.info(`Auto-provisioned API key for account ${key}`);
					} else {
						logger.debug(`API key auto-provision skipped for account ${key}: ${result.message || 'already has keys'}`);
					}
				}
			} catch (provisionErr) {
				logger.warn(`API key auto-provision failed for account ${key}: ${provisionErr}`);
			}
		} catch (err) {
			logger.error(`Failed to provision AI wallet for account ${key}: ${err}`);
		}
	});

	// ─── Trial expiry cron (hourly) ─────────────────────────
	//
	// v2: one row per (account, module). Each row's trial_end is independent;
	// expired trials transition to 'canceled' (not 'expired' — the latter is
	// reserved for grace-period payment failures).

	schedule('0 * * * *', async () => {
		try {
			const now = new Date().toISOString();
			const updated = await db('subscriptions')
				.where('status', 'trialing')
				.where('trial_end', '<', now)
				.update({
					status: 'canceled',
					cancel_at: now,
					date_updated: now,
				});

			if (updated > 0) {
				logger.info(`Trial expiry cron: ${updated} subscription(s) marked canceled`);
			}
		} catch (err) {
			logger.error(`Trial expiry cron failed: ${err}`);
		}
	});

	// ─── feature_quotas refresh hooks (task 17) ────────────
	//
	// On every subscription or subscription_addon write, call
	// public.refresh_feature_quotas(account_id) to keep the materialized
	// quota table consistent. Errors are caught — hooks NEVER block writes.

	const quotaHooks = buildRefreshQuotasHooks(db, logger, pubRedis);
	for (const [event, handler] of Object.entries(quotaHooks)) {
		action(event as any, handler as any);
	}

	// ─── feature_quotas nightly full refresh (task 17) ──────
	//
	// Nightly catch-all at 3 AM: rebuilds all quota rows in case any
	// webhook event was missed. public.refresh_all_feature_quotas()
	// iterates accounts with non-terminal subscriptions.

	schedule('0 3 * * *', buildRefreshAllQuotasCron(db, logger));

	// ─── Stripe endpoints (require STRIPE_SECRET_KEY) ───────

	const stripeKey = env['STRIPE_SECRET_KEY'] as string | undefined;
	const webhookSecret = env['STRIPE_WEBHOOK_SECRET'] as string | undefined;

	if (!stripeKey) {
		logger.warn('STRIPE_SECRET_KEY not set — Stripe billing endpoints disabled');
		return;
	}

	const stripe = getStripe(stripeKey);

	// ─── Auto-reload consumer (every minute) ────────────────
	//
	// Task 31: drains public.wallet_auto_reload_pending by creating off-session
	// PaymentIntents. Runs at cron minute granularity (finest Directus supports).
	// A single in-flight guard prevents overlapping ticks if one batch runs long.

	let autoReloadInFlight = false;
	schedule('* * * * *', async () => {
		if (autoReloadInFlight) {
			logger.debug('auto-reload consumer tick skipped: previous batch still running');
			return;
		}
		autoReloadInFlight = true;
		try {
			const result = await processAutoReloadBatch(stripe, db, logger);
			if (result.claimed > 0) {
				logger.info(
					`auto-reload batch: claimed=${result.claimed} succeeded=${result.succeeded} retried=${result.retried} failed=${result.failed}`,
				);
			}
		} catch (err: any) {
			logger.error(`auto-reload batch fatal: ${err?.message || err}`);
		} finally {
			autoReloadInFlight = false;
		}
	});

	init('routes.custom.before', ({ app }) => {
		const publicUrl = (env['PUBLIC_URL'] as string) || '';

		// POST /stripe/checkout — create checkout session
		//
		// v2 contract: { module, tier, billing_cycle }
		//   module: 'calculators' | 'kb' | 'flows'
		//   tier:   'starter' | 'growth' | 'scale'  (no 'enterprise' — contact sales)
		//   billing_cycle: 'monthly' | 'annual'
		app.post('/stripe/checkout', async (req: any, res: any) => {
			const userId = req.accountability?.user;
			if (!userId) {
				return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
			}

			const { module, tier, billing_cycle } = req.body || {};

			if (!module || !VALID_MODULES.includes(module)) {
				return res.status(400).json({ errors: [{ message: `module must be one of: ${VALID_MODULES.join(', ')}` }] });
			}
			if (!tier || typeof tier !== 'string') {
				return res.status(400).json({ errors: [{ message: 'tier is required' }] });
			}
			if (tier === 'enterprise') {
				return res.status(400).json({ errors: [{ message: 'Enterprise tier requires contacting sales' }] });
			}
			if (!billing_cycle || !VALID_CYCLES.includes(billing_cycle)) {
				return res.status(400).json({ errors: [{ message: `billing_cycle must be one of: ${VALID_CYCLES.join(', ')}` }] });
			}

			try {
				const schema = await getSchema();
				const { UsersService } = services;

				// Get user's active_account
				const usersService = new UsersService({ schema, accountability: { admin: true } });
				const user = await usersService.readOne(userId, { fields: ['active_account', 'email'] });
				const accountId = user.active_account;

				if (!accountId) {
					return res.status(400).json({ errors: [{ message: 'No active account selected' }] });
				}

				// Lookup target plan
				const plan = await db('subscription_plans')
					.where('module', module)
					.where('tier', tier)
					.where('status', 'published')
					.first();

				if (!plan) {
					return res.status(404).json({ errors: [{ message: `No published plan for ${module}/${tier}` }] });
				}

				// Pick the right Stripe price ID based on billing cycle
				const stripePriceId = billing_cycle === 'annual'
					? plan.stripe_price_annual_id
					: plan.stripe_price_monthly_id;

				if (!stripePriceId) {
					return res.status(400).json({
						errors: [{ message: `Plan ${module}/${tier} has no stripe_price_${billing_cycle}_id configured. Run stripe:create-v2-products.` }],
					});
				}

				// Reuse existing Stripe customer if any subscription on the account already has one
				const existingCustomerRow = await db('subscriptions')
					.where('account_id', accountId)
					.whereNotNull('stripe_customer_id')
					.select('stripe_customer_id')
					.first();

				let customerId: string | null = existingCustomerRow?.stripe_customer_id || null;
				if (!customerId) {
					const customer = await stripe.customers.create({
						email: user.email,
						metadata: { account_id: accountId, directus_user_id: userId },
					});
					customerId = customer.id;
				}

				// Trial eligibility: only if account has NEVER trialed THIS module
				const priorTrial = await db('subscriptions')
					.where('account_id', accountId)
					.where('module', module)
					.whereNotNull('trial_end')
					.first();

				const sessionParams: any = {
					customer: customerId,
					mode: 'subscription',
					line_items: [{ price: stripePriceId, quantity: 1 }],
					success_url: `${publicUrl}/admin/content/account`,
					cancel_url: `${publicUrl}/admin/content/account`,
					metadata: {
						account_id: accountId,
						module,
						tier,
						billing_cycle,
					},
					subscription_data: {
						metadata: {
							account_id: accountId,
							module,
							tier,
							billing_cycle,
						},
					},
				};

				if (!priorTrial && plan.trial_days > 0) {
					sessionParams.subscription_data.trial_period_days = plan.trial_days;
				}

				const session = await stripe.checkout.sessions.create(sessionParams);
				return res.json({ url: session.url });
			} catch (err: any) {
				logger.error(`Stripe checkout failed: ${err.message}`);
				return res.status(500).json({ errors: [{ message: 'Failed to create checkout session' }] });
			}
		});

		// POST /stripe/portal — create billing portal session
		app.post('/stripe/portal', async (req: any, res: any) => {
			const userId = req.accountability?.user;
			if (!userId) {
				return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
			}

			try {
				const schema = await getSchema();
				const { UsersService } = services;

				const usersService = new UsersService({ schema, accountability: { admin: true } });
				const user = await usersService.readOne(userId, { fields: ['active_account'] });
				const accountId = user.active_account;

				if (!accountId) {
					return res.status(400).json({ errors: [{ message: 'No active account selected' }] });
				}

				// Find any active sub on this account that carries a stripe_customer_id
				const subRow = await db('subscriptions')
					.where('account_id', accountId)
					.whereNotNull('stripe_customer_id')
					.select('stripe_customer_id')
					.first();

				const customerId = subRow?.stripe_customer_id;
				if (!customerId) {
					return res.status(400).json({ errors: [{ message: 'No billing account found. Please subscribe first.' }] });
				}

				const session = await stripe.billingPortal.sessions.create({
					customer: customerId,
					return_url: `${publicUrl}/admin/content/account`,
				});

				return res.json({ url: session.url });
			} catch (err: any) {
				logger.error(`Stripe portal failed: ${err.message}`);
				return res.status(500).json({ errors: [{ message: 'Failed to create portal session' }] });
			}
		});

		// POST /stripe/webhook — handle Stripe events
		app.post('/stripe/webhook', async (req: any, res: any) => {
			if (!webhookSecret) {
				return res.status(500).json({ errors: [{ message: 'Webhook secret not configured' }] });
			}

			// Collect raw body for signature verification
			const chunks: Buffer[] = [];
			for await (const chunk of req) {
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			}
			const rawBody = Buffer.concat(chunks);
			const sig = req.headers['stripe-signature'];

			let event;
			try {
				event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
			} catch (err: any) {
				logger.warn(`Webhook signature verification failed: ${err.message}`);
				return res.status(400).json({ error: 'Invalid signature' });
			}

			try {
				await withIdempotency(db, event, logger, async () => {
					switch (event.type) {
						case 'checkout.session.completed':
							await handleCheckoutCompleted(event.data.object as any, db, logger);
							break;
						case 'customer.subscription.updated':
							await handleSubscriptionUpdated(event.data.object as any, db, logger);
							break;
						case 'customer.subscription.deleted':
							await handleSubscriptionDeleted(event.data.object as any, db, logger);
							break;
						case 'invoice.payment_failed':
							await handleInvoicePaymentFailed(event.data.object as any, db, logger);
							break;
						case 'product.updated':
							await handleProductUpdated(event.data.object as any, stripe, db, logger);
							break;
						case 'payment_intent.succeeded':
							await handlePaymentIntentSucceeded(event.data.object as any, db, logger);
							break;
						case 'payment_intent.payment_failed':
							await handlePaymentIntentFailed(event.data.object as any, db, logger);
							break;
						default:
							logger.debug(`Unhandled Stripe event: ${event.type}`);
					}
				});
			} catch (err) {
				logger.error(`Webhook handler error for ${event.type}: ${err}`);
			}

			return res.json({ received: true });
		});

		logger.info('Stripe billing routes registered');

		// AI Wallet endpoints (Phase 3)
		registerWalletRoutes({
			app,
			stripe,
			db,
			logger,
			services,
			getSchema,
			publicUrl,
		});

		// Sync plans from Stripe on startup
		syncAllProducts(stripe, db, logger).catch((err) => {
			logger.warn(`Startup product sync failed: ${err.message}`);
		});
	});
});
