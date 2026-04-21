# 56. 🟠 P1: Stripe webhook observability — surface misconfigs in Directus, not docker logs

**Status:** completed (2026-04-20)
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

- [x] `stripe_webhook_log` table created (migration 035); webhook handler writes on every code path — 10 unit-test cases in `webhook-route.test.ts` cover 400_signature, 400_parse, 500 (handler error), 200 (success), missing-secret-at-runtime, plus source_ip + response_ms invariants
- [x] `GET /stripe/webhook-health` endpoint returns JSON with the 4 metrics (last_success, last_failure, counters_24h, banner); 401 for non-admin — verified live via curl: anon → 401, admin bearer → 200 + JSON
- [x] Billing Health panel visible at `/ai-observatory/billing-health`; polls every 60s via `setInterval`, cleared on unmount; red-banner state validated in unit + live runtime (1 forced sig-fail → banner.state = 'red' in API response)
- [x] Startup validation fails CMS boot on missing/malformed `STRIPE_WEBHOOK_SECRET` (throws `WebhookSecretValidationError`); success path logs `INFO: Stripe webhook secret loaded (whsec_XXXX...)` — confirmed in dev CMS boot logs
- [x] Integration tests: 5 cases in `startup-validation.integration.test.ts` covering realistic 64-hex secret shape, unset env, prefix-only, pk_live_* misuse, prefix-only-INFO leak check
- [x] Manual test: live sig-fail via unsigned POST /stripe/webhook → row written to `stripe_webhook_log` with status=`400_signature` → /stripe/webhook-health returns `banner.state: 'red'` with spec'd message

## Implementation Notes

- **Observability home:** `project-extension-ai-observatory` (per spec preference — observability is the cleaner fit than admin module). New route + navigation entry added; preserves existing `admin_access` pre-register check.
- **Schema:** `stripe_webhook_events` (idempotency ledger) kept unchanged. New `stripe_webhook_log` is a broader HTTP-level hit log — different purpose, different retention expectations.
- **Handler refactor:** the webhook body was extracted into `webhook-route.ts` (`createWebhookRouteHandler` factory) so every code path can be unit-tested with a synthetic req/res, no Directus boot required. `index.ts` composes the factory with the live Stripe client + knex + idempotency.
- **HTTP status policy:** 400 for signature/parse (Stripe retries are safe); 200 for handler errors (the event was received — a 500 would trigger Stripe retries while our backend tries to catch up). Handler errors surface via the log table's status='500', not HTTP.
- **Log write never throws:** `recordWebhookLog` swallows DB errors and reports to logger. Log-write failure must never break the billing pipeline.
- **Secret prefix log:** exactly 10 chars (`whsec_` + 4 hex) so drift is visible in `docker logs` but entropy leakage ≤ 16 bits.

## Files Delivered

- `migrations/cms/035_stripe_webhook_log.sql` (+ `_down.sql`)
- `services/cms/extensions/local/project-extension-stripe/src/webhook-log.ts` (recordWebhookLog, extractSourceIp, isValidWebhookSecret)
- `services/cms/extensions/local/project-extension-stripe/src/webhook-health.ts` (computeWebhookHealth, computeBanner, registerWebhookHealthRoute)
- `services/cms/extensions/local/project-extension-stripe/src/webhook-route.ts` (createWebhookRouteHandler factory)
- `services/cms/extensions/local/project-extension-stripe/src/startup-validation.ts` (validateWebhookSecret, WebhookSecretValidationError)
- `services/cms/extensions/local/project-extension-stripe/src/index.ts` (integrates all of the above)
- `services/cms/extensions/local/project-extension-stripe/__tests__/{webhook-log,webhook-health,webhook-route,startup-validation,startup-validation.integration}.test.ts` — 59 new vitest cases
- `services/cms/extensions/local/project-extension-ai-observatory/src/routes/billing-health.vue`
- `services/cms/extensions/local/project-extension-ai-observatory/src/{index.ts,types.ts,components/observatory-navigation.vue,composables/use-observatory-api.ts}` (glue)

## Follow-ups (out of scope here)

- Retention cron (trim `stripe_webhook_log` rows older than 90 days) — separate task
- Per-account breakdown in the panel — MVP is global only
- Slack / email alerting — handled by external monitoring stack

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
