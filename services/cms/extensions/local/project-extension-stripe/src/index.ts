import { defineHook } from '@directus/extensions-sdk';
import { getStripe } from './stripe-client.js';
import { getRegistrationPage } from './register.js';
import {
	handleCheckoutCompleted,
	handleSubscriptionUpdated,
	handleSubscriptionDeleted,
	handleInvoicePaymentFailed,
	handleProductUpdated,
	syncAllProducts,
} from './webhook-handlers.js';

export default defineHook(({ init, action, schedule }, { env, logger, database, services, getSchema }) => {
	const db = database;

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

				// Trial subscription is auto-created by the account.items.create hook below

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

	// ─── Trial auto-creation on account create ──────────────

	action('account.items.create', async ({ key }) => {
		try {
			const schema = await getSchema();
			const { ItemsService } = services;

			// Find default trial plan: published, trial_days > 0, lowest sort
			const planService = new ItemsService('subscription_plans', { schema, accountability: { admin: true } });
			const plans = await planService.readByQuery({
				filter: {
					status: { _eq: 'published' },
					trial_days: { _gt: 0 },
				},
				sort: ['sort'],
				limit: 1,
			});

			if (!plans.length) {
				logger.warn('No trial plan found — skipping trial subscription creation');
				return;
			}

			const plan = plans[0];
			const now = new Date();
			const trialEnd = new Date(now.getTime() + plan.trial_days * 24 * 60 * 60 * 1000);

			const subService = new ItemsService('subscriptions', { schema, accountability: { admin: true } });
			await subService.createOne({
				account: key,
				plan: plan.id,
				status: 'trialing',
				trial_start: now.toISOString(),
				trial_end: trialEnd.toISOString(),
			});

			logger.info(`Trial subscription created for account ${key}: ${plan.name}, ${plan.trial_days} days`);

			// Auto-provision a default API key via the gateway
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
			logger.error(`Failed to create trial subscription for account ${key}: ${err}`);
		}
	});

	// ─── Trial expiry cron (hourly) ─────────────────────────

	schedule('0 * * * *', async () => {
		try {
			const now = new Date().toISOString();
			const updated = await db('subscriptions')
				.where('status', 'trialing')
				.where('trial_end', '<', now)
				.update({
					status: 'expired',
					date_updated: now,
				});

			if (updated > 0) {
				logger.info(`Trial expiry cron: ${updated} subscription(s) marked expired`);
			}
		} catch (err) {
			logger.error(`Trial expiry cron failed: ${err}`);
		}
	});

	// ─── Stripe endpoints (require STRIPE_SECRET_KEY) ───────

	const stripeKey = env['STRIPE_SECRET_KEY'] as string | undefined;
	const webhookSecret = env['STRIPE_WEBHOOK_SECRET'] as string | undefined;

	if (!stripeKey) {
		logger.warn('STRIPE_SECRET_KEY not set — Stripe billing endpoints disabled');
		return;
	}

	const stripe = getStripe(stripeKey);

	init('routes.custom.before', ({ app }) => {
		const publicUrl = (env['PUBLIC_URL'] as string) || '';

		// POST /stripe/checkout — create checkout session
		app.post('/stripe/checkout', async (req: any, res: any) => {
			const userId = req.accountability?.user;
			if (!userId) {
				return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
			}

			const { plan_id } = req.body || {};
			if (!plan_id) {
				return res.status(400).json({ errors: [{ message: 'plan_id is required' }] });
			}

			try {
				const schema = await getSchema();
				const { ItemsService, UsersService } = services;

				// Get user's active_account
				const usersService = new UsersService({ schema, accountability: { admin: true } });
				const user = await usersService.readOne(userId, { fields: ['active_account', 'email'] });
				const accountId = user.active_account;

				if (!accountId) {
					return res.status(400).json({ errors: [{ message: 'No active account selected' }] });
				}

				// Get plan
				const planService = new ItemsService('subscription_plans', { schema, accountability: { admin: true } });
				const plan = await planService.readOne(plan_id);

				if (!plan?.stripe_product_id) {
					return res.status(400).json({ errors: [{ message: 'Plan has no Stripe product configured' }] });
				}

				// Resolve the default price from the Stripe product
				let stripePriceId = plan.stripe_product_id;
				if (stripePriceId.startsWith('prod_')) {
					const product = await stripe.products.retrieve(stripePriceId);
					if (!product.default_price) {
						return res.status(400).json({ errors: [{ message: 'Stripe product has no default price' }] });
					}
					stripePriceId = typeof product.default_price === 'string' ? product.default_price : product.default_price.id;
				}

				// Get or create subscription record
				const subService = new ItemsService('subscriptions', { schema, accountability: { admin: true } });
				const subs = await subService.readByQuery({
					filter: { account: { _eq: accountId } },
					limit: 1,
				});

				const sub = subs[0];

				// Reuse or create Stripe customer
				let customerId = sub?.stripe_customer_id;
				if (!customerId) {
					const customer = await stripe.customers.create({
						email: user.email,
						metadata: { account_id: accountId, directus_user_id: userId },
					});
					customerId = customer.id;

					// Store customer ID
					if (sub) {
						await subService.updateOne(sub.id, { stripe_customer_id: customerId });
					}
				}

				// Build checkout session params
				const sessionParams: any = {
					customer: customerId,
					mode: 'subscription',
					line_items: [{ price: stripePriceId, quantity: 1 }],
					success_url: `${publicUrl}/admin/content/account`,
					cancel_url: `${publicUrl}/admin/content/account`,
					metadata: { account_id: accountId },
				};

				// Preserve remaining trial days if currently trialing
				if (sub?.status === 'trialing' && sub.trial_end) {
					const remaining = Math.max(0, Math.ceil((new Date(sub.trial_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
					if (remaining > 0) {
						sessionParams.subscription_data = { trial_period_days: remaining };
					}
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
				const { ItemsService, UsersService } = services;

				const usersService = new UsersService({ schema, accountability: { admin: true } });
				const user = await usersService.readOne(userId, { fields: ['active_account'] });
				const accountId = user.active_account;

				if (!accountId) {
					return res.status(400).json({ errors: [{ message: 'No active account selected' }] });
				}

				const subService = new ItemsService('subscriptions', { schema, accountability: { admin: true } });
				const subs = await subService.readByQuery({
					filter: { account: { _eq: accountId } },
					fields: ['stripe_customer_id'],
					limit: 1,
				});

				const customerId = subs[0]?.stripe_customer_id;
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
					default:
						logger.debug(`Unhandled Stripe event: ${event.type}`);
				}
			} catch (err) {
				logger.error(`Webhook handler error for ${event.type}: ${err}`);
			}

			return res.json({ received: true });
		});

		logger.info('Stripe billing routes registered');

		// Sync plans from Stripe on startup
		syncAllProducts(stripe, db, logger).catch((err) => {
			logger.warn(`Startup product sync failed: ${err.message}`);
		});
	});
});
