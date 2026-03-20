# Stripe Billing Integration

## Architecture

The `project-extension-stripe` hook extension handles all Stripe billing:

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /register` | none | Standalone registration page |
| `POST /register` | none | Create user + account + trial |
| `POST /stripe/checkout` | required | Create Stripe Checkout session |
| `POST /stripe/portal` | required | Create Stripe billing portal session |
| `POST /stripe/webhook` | Stripe sig | Receive Stripe events |

**Automatic behaviors:**
- `account.items.create` hook → creates trial subscription (finds lowest-sort published plan with `trial_days > 0`) + creates default formula API key (encrypted, label "Default API Key")
- Hourly cron → expires trials past `trial_end`
- **Startup sync** → fetches all Stripe products and syncs prices + metadata to `subscription_plans`
- **`product.updated` webhook** → real-time sync when products change in Stripe

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | `.env` | Stripe API secret key (`sk_test_...` or `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | `.env` | Webhook signing secret (`whsec_...`) |
| `TOKEN_ENCRYPTION_KEY` | `.env` | 64 hex chars — used to encrypt auto-created formula API keys |

All are passed to the container via `docker-compose.yml`.

---

## Stripe ↔ Directus Sync

Plans are the **single source of truth in Stripe**. Prices and limits sync automatically to Directus.

### What Syncs

| Stripe | Direction | Directus `subscription_plans` |
|---|---|---|
| Product `default_price` (monthly interval) | → | `monthly_price` (cents) |
| Product prices (yearly interval) | → | `yearly_price` (cents) |
| Product metadata `bl_service_limit` | → | `calculator_limit` |
| Product metadata `bl_request_limit` | → | `calls_per_month` |

### When It Syncs

1. **On Directus startup** — all plans with a `stripe_product_id` are synced from Stripe
2. **On `product.updated` webhook** — when you edit a product/price in Stripe Dashboard

### Stripe Product Setup

Each product in Stripe should have:

- **Monthly price** (recurring, interval: month) — syncs to `monthly_price`
- **Yearly price** (recurring, interval: year) — syncs to `yearly_price`
- **Metadata:**
  - `bl_service_limit` — max calculators (e.g., `5`)
  - `bl_request_limit` — API calls per month (e.g., `100000`)

### Checkout Flow

When a user clicks Upgrade, the extension:
1. Looks up the plan's `stripe_product_id`
2. Resolves the **default price** from the Stripe product (`prod_` → `price_`)
3. Creates a Checkout session with that price
4. Preserves remaining trial days if currently trialing

This means `stripe_product_id` stores **product IDs** (`prod_...`), not price IDs.

---

## Local Development

### 1. Get Your Test API Key

Stripe Dashboard → **Developers → API keys → Secret key** (toggle to test mode).

Starts with `sk_test_...`.

### 2. Set Up Webhook Forwarding

Stripe can't reach `localhost`, so use the **Stripe CLI** to forward events:

```bash
# Install (once)
brew install stripe/stripe-cli/stripe

# Authenticate (once)
stripe login

# Forward webhooks to local Directus
stripe listen --forward-to localhost:8056/stripe/webhook
```

The CLI prints a `whsec_test_...` secret on startup. This secret stays the same across sessions for your account.

### 3. Configure `.env`

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 4. Restart

```bash
docker compose up -d
```

### 5. Testing the Flow

**Registration:**
- Visit `http://localhost:8056/register`
- Fill in name, email, password
- Submit → user + account + trial subscription + default formula API key created
- Redirects to login
- User can immediately use the Formulas module (no manual API key setup needed)

**Checkout:**
- Log in → Account → Subscription → Upgrade
- Redirected to Stripe Checkout
- Use test card `4242 4242 4242 4242` (any future expiry, any CVC)
- On success → webhook fires → subscription activated

**Billing Portal:**
- Account → Subscription → Manage Billing
- Opens Stripe-hosted portal to manage/cancel subscription

**Trigger events manually (for testing):**
```bash
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
stripe trigger invoice.payment_failed
stripe trigger product.updated
```

### 6. Monitor Events

```bash
# See events in real-time
stripe listen --forward-to localhost:8056/stripe/webhook --print-json

# Or check Directus logs
docker compose logs -f directus | grep -i stripe
```

---

## Production Setup

### 1. Use Live API Key

Stripe Dashboard → toggle to **live mode** → **Developers → API keys → Secret key**.

Starts with `sk_live_...`.

### 2. Create Webhook Endpoint in Dashboard

Stripe Dashboard → **Developers → Webhooks → Add endpoint**:

- **URL:** `https://your-domain.com/stripe/webhook`
- **Events to listen to:**
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `product.updated`

After creating, click the endpoint → **Reveal signing secret** → copy the `whsec_...` value.

### 3. Set Environment Variables

In your deployment config (App Platform, etc.):

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## Stripe Dashboard Setup

### Products & Prices

Create products in Stripe Dashboard → **Product catalog**. Each plan needs:

1. A **product** with metadata:
   - `bl_service_limit` = calculator limit (e.g., `5`)
   - `bl_request_limit` = calls per month (e.g., `100000`)
2. A **monthly recurring price** (e.g., $49.90/mo)
3. A **yearly recurring price** (e.g., $499.00/yr)

Copy each product ID (`prod_...`) into `subscription_plans.stripe_product_id` in Directus. On restart, prices and limits sync automatically.

### Billing Portal Configuration

Stripe Dashboard → **Settings → Billing → Customer portal**:

- Enable the portal
- Configure which actions customers can take (cancel, switch plans, update payment)
- Set cancellation policy

### Test Mode vs Live Mode

| | Test Mode | Live Mode |
|---|---|---|
| Keys | `sk_test_...` / `pk_test_...` | `sk_live_...` / `pk_live_...` |
| Cards | Use `4242 4242 4242 4242` | Real cards |
| Webhooks | Stripe CLI or test endpoint | Dashboard endpoint |
| Money | No real charges | Real charges |

Always develop and test with test mode keys. Switch to live mode only for production.

---

## Database Tables

### `subscription_plans`

Maps to Stripe products. Synced automatically from Stripe.

| Field | Source | Purpose |
|---|---|---|
| `stripe_product_id` | Manual | Links to Stripe Product (`prod_...`) |
| `monthly_price` | Auto-synced | Monthly price in cents |
| `yearly_price` | Auto-synced | Yearly price in cents |
| `calculator_limit` | Auto-synced | Max calculators (from `bl_service_limit` metadata) |
| `calls_per_month` | Auto-synced | API call quota (from `bl_request_limit` metadata) |
| `calls_per_second` | Manual | Rate limit (not in Stripe) |
| `trial_days` | Manual | Auto-trial duration for new accounts |

### `subscriptions`

Managed by code (hidden collection). Synced with Stripe via webhooks.

| Field | Purpose |
|---|---|
| `status` | `trialing` / `active` / `past_due` / `canceled` / `expired` |
| `stripe_customer_id` | Stripe Customer (`cus_...`) |
| `stripe_subscription_id` | Stripe Subscription (`sub_...`) |
| `trial_start` / `trial_end` | Trial period dates |
| `current_period_start` / `current_period_end` | Billing period (synced via webhook) |

### `account`

| Field | Purpose |
|---|---|
| `exempt_from_subscription` | Boolean — bypasses all subscription checks (e.g., admin accounts) |

---

## Webhook Events

| Event | Handler | Action |
|---|---|---|
| `checkout.session.completed` | `handleCheckoutCompleted` | Activate subscription, store Stripe IDs |
| `customer.subscription.updated` | `handleSubscriptionUpdated` | Sync status + billing period |
| `customer.subscription.deleted` | `handleSubscriptionDeleted` | Mark canceled |
| `invoice.payment_failed` | `handleInvoicePaymentFailed` | Mark past_due |
| `product.updated` | `handleProductUpdated` | Sync prices + limits from metadata |

---

## Troubleshooting

**Stripe billing endpoints disabled:**
→ `STRIPE_SECRET_KEY` not set or empty. Check `.env` and restart.

**Webhook signature verification failed:**
→ `STRIPE_WEBHOOK_SECRET` doesn't match. For local dev, make sure `stripe listen` is running and the secret matches.

**Trial not created on registration:**
→ No published plan with `trial_days > 0` exists in `subscription_plans`. Create one in Directus.

**Checkout fails with "Stripe product has no default price":**
→ The product has no default price set. In Stripe Dashboard, edit the product and set a default price.

**Prices not showing on subscription page:**
→ Run `docker compose restart directus` to trigger startup sync, or update the product in Stripe to trigger `product.updated` webhook.

**Limits not syncing from Stripe:**
→ Ensure product metadata keys are exactly `bl_service_limit` and `bl_request_limit`. Check Directus logs for sync messages.
