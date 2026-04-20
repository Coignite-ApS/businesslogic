/**
 * Task 48 — HTTP-level webhook transport test.
 *
 * Scope: verifies the HTTP transport + signature path of /stripe/webhook
 * against the live running CMS. POSTs a Stripe-signed payload and asserts:
 *   - 400 for missing / invalid / malformed stripe-signature header
 *   - 200 for a properly signed checkout.session.completed payload
 *   - the event is recorded in stripe_webhook_events (idempotency ledger)
 *
 * Exercises the full Express-route path including:
 *   - Directus's express.json() body parser pre-reading the stream
 *   - req.rawBody reuse in our webhook handler (the task 48 fix)
 *   - Stripe signature verification
 *
 * NOT covered here (intentional): downstream handler effects (subscription
 * row creation, refresh_feature_quotas call). The signed payload uses a
 * fake stripe_subscription_id, so the live CMS's stripe.subscriptions
 * .retrieve() returns "No such subscription" and the handler returns
 * early — by design. Handler logic with full assertions on subscription
 * row + refresh_feature_quotas calls lives in
 * multi-module-subs.integration.test.ts. Full e2e (real Stripe Checkout
 * → row → quotas → UI) requires browser verification — tracked as open
 * acceptance items in docs/tasks/cross-cutting/48-stripe-webhook-pipeline-broken.md.
 *
 * Auto-skips when:
 *   - CMS not reachable on :18055
 *   - Postgres not reachable on :15432
 *   - STRIPE_WEBHOOK_SECRET env var unavailable (we read it from the
 *     dev .env file via Docker exec; if the container isn't running, skip)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import Stripe from 'stripe';

const require = createRequire(import.meta.url);
const knex = require('knex');

const CMS_URL = process.env.TEST_CMS_URL ?? 'http://localhost:18055';
const WEBHOOK_PATH = '/stripe/webhook';

const testAccountIds: string[] = [];
const testEventIds: string[] = [];
let db: any;
let run = false;
let webhookSecret = '';
let plan: any;

async function dbReachable(): Promise<boolean> {
	try {
		await db.raw('SELECT 1');
		return true;
	} catch {
		return false;
	}
}

async function cmsReachable(): Promise<boolean> {
	try {
		const r = await fetch(`${CMS_URL}/server/ping`);
		return r.ok;
	} catch {
		return false;
	}
}

/**
 * Verify the stripe webhook route is actually registered. Returns true if
 * POSTing to it yields anything other than ROUTE_NOT_FOUND. We use this in
 * addition to /server/ping because the CMS can be healthy but have failed
 * to load the Stripe extension (e.g. invalid manifest in a sibling local
 * extension aborts the whole local-extension load). In that case we want
 * to auto-skip rather than fail with 404 noise.
 */
async function stripeRouteRegistered(): Promise<boolean> {
	try {
		const r = await fetch(`${CMS_URL}${WEBHOOK_PATH}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
		});
		// 404 with ROUTE_NOT_FOUND means the extension never registered the route.
		// Any other status (400 invalid signature, 500 etc.) means it IS registered.
		if (r.status === 404) {
			const body = await r.json().catch(() => ({} as any));
			const code = (body as any)?.errors?.[0]?.extensions?.code;
			return code !== 'ROUTE_NOT_FOUND';
		}
		return true;
	} catch {
		return false;
	}
}

async function createTestAccount(name: string): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.account (id, status, name, date_created)
		 VALUES (gen_random_uuid(), 'active', ?, now())
		 RETURNING id`,
		[name],
	).then((r: any) => r.rows);
	testAccountIds.push(id);
	return id;
}

/**
 * Read the webhook secret from the running CMS container's env.
 * We can't import .env directly from the test (it lives at infrastructure/docker/.env)
 * and we want to ensure we're using the SAME secret the CMS is using.
 *
 * Order of precedence:
 *   1. STRIPE_WEBHOOK_SECRET env var passed to the test process
 *   2. docker exec into the CMS container and read its env
 */
async function readWebhookSecret(): Promise<string> {
	if (process.env.STRIPE_WEBHOOK_SECRET) {
		return process.env.STRIPE_WEBHOOK_SECRET;
	}
	try {
		const { execSync } = await import('child_process');
		const out = execSync('docker exec businesslogic-bl-cms-1 printenv STRIPE_WEBHOOK_SECRET', {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		return out;
	} catch (err: any) {
		console.warn(`readWebhookSecret: docker exec failed: ${err?.message || err}`);
		return '';
	}
}

/**
 * Build a checkout.session.completed event payload + valid Stripe signature.
 * Uses Stripe SDK's official test header generator (the same code path Stripe
 * itself uses to verify production payloads).
 */
function buildSignedRequest(opts: {
	accountId: string;
	module: string;
	tier: string;
	subscriptionId: string;
	eventId: string;
	customerId?: string;
	billingCycle?: string;
}): { body: string; headers: Record<string, string> } {
	const session = {
		id: `cs_test_${Date.now()}`,
		object: 'checkout.session',
		mode: 'subscription',
		subscription: opts.subscriptionId,
		customer: opts.customerId ?? 'cus_test_http',
		metadata: {
			account_id: opts.accountId,
			module: opts.module,
			tier: opts.tier,
			billing_cycle: opts.billingCycle ?? 'monthly',
		},
	};
	const event = {
		id: opts.eventId,
		object: 'event',
		api_version: '2024-04-10',
		created: Math.floor(Date.now() / 1000),
		type: 'checkout.session.completed',
		data: { object: session },
		livemode: false,
		pending_webhooks: 0,
		request: { id: null, idempotency_key: null },
	};
	const body = JSON.stringify(event);
	const header = Stripe.webhooks.generateTestHeaderString({
		payload: body,
		secret: webhookSecret,
	});
	return {
		body,
		headers: {
			'Content-Type': 'application/json',
			'stripe-signature': header,
		},
	};
}

/**
 * Stub the Stripe API call (subscriptions.retrieve) by intercepting via a
 * fake stripe customer + subscription. We can't easily mock the live CMS's
 * Stripe client from the outside, so we use a real Stripe sandbox subscription
 * ID — but the test's stripe_subscription_id needs to actually exist in
 * Stripe for stripe.subscriptions.retrieve() to succeed.
 *
 * Workaround: create a real Stripe checkout subscription in test mode, OR
 * skip the test if STRIPE_SECRET_KEY is unavailable. This is documented as
 * a known limitation — the unit/integration tests in
 * multi-module-subs.integration.test.ts already cover the handler logic
 * with mocks; this test verifies the HTTP plumbing and signature path
 * end-to-end.
 *
 * For this test we use stripe trigger to create a real checkout session
 * and use its subscription ID. Since that's a heavy lift, we instead
 * simply verify the response status + signature acceptance, accepting
 * that the handler will fail to retrieve the fake subscription and log
 * an error (still returns 200 — webhook always 200s on signature OK).
 */

function makeStripeWebhookKey(): Stripe {
	// Used only for the generateTestHeaderString static helper; no API key needed.
	// Placeholder key works because we never call .request() in this test.
	return new Stripe('sk_test_placeholder', { apiVersion: '2024-04-10' as any });
}

describe('Task 48 — HTTP-level webhook integration', () => {
	beforeAll(async () => {
		// Initialize Stripe (only used for the static signature helper)
		makeStripeWebhookKey();

		db = knex({
			client: 'pg',
			connection: {
				host: process.env.TEST_DB_HOST ?? '127.0.0.1',
				port: Number(process.env.TEST_DB_PORT ?? 15432),
				user: process.env.TEST_DB_USER ?? 'directus',
				password: process.env.TEST_DB_PASSWORD ?? 'directus',
				database: process.env.TEST_DB_NAME ?? 'directus',
			},
			pool: { min: 0, max: 2 },
		});

		const dbOk = await dbReachable();
		const cmsOk = await cmsReachable();
		const routeOk = cmsOk ? await stripeRouteRegistered() : false;

		if (!dbOk || !cmsOk || !routeOk) {
			console.warn(
				`Skipping HTTP webhook test (db=${dbOk}, cms=${cmsOk}, stripeRoute=${routeOk}). ` +
				`Start the full dev stack and ensure the Stripe extension loaded ` +
				`("Stripe billing routes registered" in CMS logs) to run this suite.`,
			);
			return;
		}

		webhookSecret = await readWebhookSecret();
		if (!webhookSecret) {
			if (process.env.TEST_ALLOW_SKIP === '1') {
				console.warn('STRIPE_WEBHOOK_SECRET unreadable from container — skipping');
				return;
			}
			throw new Error('Could not read STRIPE_WEBHOOK_SECRET from CMS container');
		}

		// Pick a published plan to attach our subscription rows to
		plan = await db('subscription_plans')
			.where({ module: 'calculators', tier: 'growth', status: 'published' })
			.first();
		if (!plan) {
			if (process.env.TEST_ALLOW_SKIP === '1') {
				console.warn('No published calculators/growth plan — skipping');
				return;
			}
			throw new Error('No published calculators/growth plan in DB — seed catalog first');
		}

		run = true;
	});

	afterAll(async () => {
		if (!db) return;
		if (run && testAccountIds.length > 0) {
			// Clean up: cascade order matters
			await db('feature_quotas').whereIn('account_id', testAccountIds).delete().catch(() => {});
			await db('subscriptions').whereIn('account_id', testAccountIds).delete().catch(() => {});
			await db('account').whereIn('id', testAccountIds).delete().catch(() => {});
		}
		// Clean up any test webhook events we inserted
		if (testEventIds.length > 0) {
			await db('stripe_webhook_events').whereIn('stripe_event_id', testEventIds).delete().catch(() => {});
		}
		await db.destroy();
	});

	it('rejects requests without a stripe-signature header (400)', async () => {
		if (!run) return;

		const r = await fetch(`${CMS_URL}${WEBHOOK_PATH}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: 'evt_no_sig', type: 'checkout.session.completed', data: { object: {} } }),
		});

		expect(r.status).toBe(400);
		const body = await r.json() as any;
		expect(body.error).toBe('Invalid signature');
	});

	it('rejects requests with an invalid signature (400)', async () => {
		if (!run) return;

		const r = await fetch(`${CMS_URL}${WEBHOOK_PATH}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'stripe-signature': 't=1,v1=deadbeef',
			},
			body: JSON.stringify({ id: 'evt_bad_sig', type: 'checkout.session.completed', data: { object: {} } }),
		});

		expect(r.status).toBe(400);
	});

	it('accepts signed payload (200) and records idempotency event', async () => {
		if (!run) return;

		const accountId = await createTestAccount('task-48-http-webhook-test');
		const eventId = `evt_t48_http_${Date.now()}`;
		testEventIds.push(eventId);

		// Note: subscriptionId is fake. The handler will attempt
		// stripe.subscriptions.retrieve() which will fail. The handler logs the
		// error and returns early (no subscription row created). Despite that,
		// the webhook endpoint MUST return 200 (signature verified, handler ran).
		// This is the contract Stripe expects: 2xx for any signature-verified event.
		const { body, headers } = buildSignedRequest({
			accountId,
			module: 'calculators',
			tier: 'growth',
			subscriptionId: 'sub_test_fake_does_not_exist',
			eventId,
		});

		const r = await fetch(`${CMS_URL}${WEBHOOK_PATH}`, {
			method: 'POST',
			headers,
			body,
		});

		expect(r.status).toBe(200);
		const respBody = await r.json() as any;
		expect(respBody.received).toBe(true);

		// Verify the event was recorded in stripe_webhook_events for idempotency
		const eventRow = await db('stripe_webhook_events')
			.where('stripe_event_id', eventId)
			.first();
		expect(eventRow).toBeDefined();
		expect(eventRow.event_type).toBe('checkout.session.completed');
	});

	it('rejects events with a malformed timestamp (400)', async () => {
		if (!run) return;

		const r = await fetch(`${CMS_URL}${WEBHOOK_PATH}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'stripe-signature': 'malformed_no_t_or_v1',
			},
			body: '{"id":"evt_malformed","type":"x","data":{"object":{}}}',
		});

		expect(r.status).toBe(400);
	});

	// Note: a fully end-to-end test (signature OK + handler creates row +
	// feature_quotas refreshed) requires either:
	//   (a) a real Stripe test-mode subscription ID that stripe.subscriptions
	//       .retrieve() can fetch, or
	//   (b) injecting a stripe client mock into the running CMS process.
	// Both are out of scope for this CI-friendly test. The mocked-DB tests in
	// multi-module-subs.integration.test.ts cover the handler logic
	// (refresh_feature_quotas call, period dates, status mapping) with full
	// assertions. This file proves the HTTP transport layer (signature
	// verification + req.rawBody reuse) works end-to-end.
});
