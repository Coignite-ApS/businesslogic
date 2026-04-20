# 56. 🟠 P1: Stripe webhook observability — surface misconfigs in Directus, not docker logs

**Status:** planned
**Severity:** P1 — prod misconfig (stale `STRIPE_WEBHOOK_SECRET`, rotated signing key, etc.) currently silent. Users would pay, get nothing, no one would notice until a support ticket.
**Source:** controller question during task 48 verification (2026-04-20). Motivated by the dev-session drift where a stale `whsec_` silently rejected all webhooks for hours.

## Problem

Current observability gaps:

1. **`stripe_webhook_events` table only logs SUCCESS** — `handleCheckoutCompleted` etc. INSERT after signature verification + processing. Silent 4xx produces no row; absence-of-row looks identical to "no customers tried to pay." Ops has no signal.
2. **Signature failures log only to `docker logs`** — `WARN: Webhook signature verification failed: ...`. No Directus-visible surface, no alerting pipeline, must SSH + tail to see.
3. **No startup sanity check** — CMS boots fine with a stale/missing `STRIPE_WEBHOOK_SECRET`. Fault surfaces only when a real payment fails hours later.
4. **Stripe Dashboard shows retry delivery status**, but ops have to leave Directus to check. Against principle of "ops open Directus once daily and see everything."

## Fix — 3-part minimum viable observability

### a) Persist EVERY webhook hit (not just successes)

Add `stripe_webhook_log` table (via db-admin, no directus_* changes):

```sql
CREATE TABLE stripe_webhook_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at   timestamptz NOT NULL DEFAULT now(),
  event_id      text,                       -- from payload; NULL if parse failed
  event_type    text,                       -- ditto
  status        text NOT NULL,              -- '200' | '400_signature' | '400_parse' | '400_missing_metadata' | '500'
  error_message text,
  response_ms   integer,
  source_ip     inet
);
CREATE INDEX idx_stripe_webhook_log_received_at ON stripe_webhook_log (received_at DESC);
CREATE INDEX idx_stripe_webhook_log_status ON stripe_webhook_log (status) WHERE status <> '200';
```

Update `project-extension-stripe/src/index.ts` webhook handler to INSERT a row in every code path (signature fail, parse fail, handler error, success). Never swallow — always record.

Retention: periodic cron trims rows older than 90 days (separate concern, out of scope here).

### b) Admin module "Billing Health" panel

New panel (or section in existing `project-extension-ai-observatory` or `project-extension-admin` — pick whichever is the right home; observability is probably cleaner) showing:

- Last successful webhook (timestamp + event_type + event_id)
- Last failure (timestamp + status + error_message)
- 24h counters: success count, failure count by status type
- **Red banner** if >0 signature failures in the last 1h — "⚠️ Stripe webhook signature verification failing — check STRIPE_WEBHOOK_SECRET"
- Green banner if last success was <24h ago and zero failures in last 1h

Endpoint: `GET /stripe/webhook-health` (admin-scoped) returns JSON. Panel Vue component polls every 60s while visible.

### c) Startup validation + visible secret prefix

In `project-extension-stripe/src/index.ts` (`init` block, before route registration):

- If `STRIPE_WEBHOOK_SECRET` missing → throw + fail boot (not warn+skip). Error message: `STRIPE_WEBHOOK_SECRET not set — webhook verification impossible`.
- If present but not matching `/^whsec_[a-f0-9]{32,}$/` → throw + fail boot. Malformed.
- If present and well-formed → log once at boot: `INFO: Stripe webhook secret loaded (${prefix.slice(0, 10)}...)`. Prefix only — never full secret. Makes drift instantly visible in `docker logs | grep "Stripe webhook secret"`.

Fail-fast at boot is preferred over degraded-runtime — if billing pipeline is misconfigured, the app shouldn't claim it's healthy.

## Acceptance

- [ ] `stripe_webhook_log` table created; webhook handler writes on every code path (unit-tested: 4+ rows from 4+ simulated request types)
- [ ] `GET /stripe/webhook-health` endpoint returns JSON with the 4 metrics; 401 for non-admin
- [ ] Billing Health panel visible in an admin module; polling update every 60s; red-banner threshold triggers on 1 signature failure in last 1h
- [ ] Startup validation fails the CMS boot if secret is missing/malformed; success path logs prefix-only INFO line
- [ ] Integration test: malformed secret → boot fails loudly; correct secret → boot succeeds + log line present
- [ ] Manual test: force a signature failure → panel shows red banner within 1 min

## Estimate

4-6h — table + handler refactor (1h), admin endpoint (30min), Vue panel (2h), startup validation (30min), tests (1h), doc (30min).

## Dependencies

- Task 48 completed (this builds on the now-working webhook pipeline)
- DB change via db-admin — will NOT touch directus_* tables (only new public table)

## Out of scope

- Slack/email alerting — handled by separate monitoring stack; log + UI are enough for MVP
- Historical data backfill — starts from deployment
- Per-account webhook breakdown — only global counts in MVP
- Stripe API key validation (separate from webhook secret) — task 57 covers reconciliation which catches this indirectly
