# DB Admin — Stripe Webhook Events Dedup Ledger

**Slug:** stripe-webhook-events
**Date:** 2026-04-18 12:02 → 12:04
**Phase:** done
**Status:** APPLIED
**Severity:** MINOR
**Classification:** Additive new table (idempotent, paired down) — MINOR per skill table; no consultation required.

## Task
Apply the new `public.stripe_webhook_events` dedup ledger table — staged migration `016_stripe_webhook_events.sql` (33 lines) + `_down.sql` (2 lines) authored by Phase 2 sub-agent for task 14 (Pricing v2 Stripe Refactor). Consumed by refactored `webhook-handlers.ts` `withIdempotency()` for at-most-once Stripe event processing across handler retries / redeliveries / restarts (replaces relying on Stripe's 24-hour internal dedup cache).

Schema is `public.*` per task 15 Q1=1C decision; cms/* schema split deferred.

## Snapshots Taken
- pre PG dump:  `infrastructure/db-snapshots/pre_stripe-webhook-events_20260418_120202.sql.gz` (26115709 B)
- pre schema:   `services/cms/snapshots/pre_stripe-webhook-events_20260418_120240.yaml` (375137 B)
- post PG dump: `infrastructure/db-snapshots/post_stripe-webhook-events_20260418_120339.sql.gz` (26115911 B; +202 B)
- post schema:  `services/cms/snapshots/post_stripe-webhook-events_20260418_120345.yaml` (375137 B; identical — Directus YAML doesn't track non-Directus-managed `public.*` raw tables)

YAML snapshots taken via `docker exec businesslogic-bl-cms-1 …` workaround (Makefile container-name bug; tracked in task 16). Files then `docker cp`'d out of container (no snapshot volume mount).

## Proposed Changes (executed)
- CREATE TABLE `public.stripe_webhook_events` (5 cols)
  - `id` BIGSERIAL PRIMARY KEY
  - `stripe_event_id` TEXT NOT NULL UNIQUE
  - `event_type` TEXT NOT NULL
  - `processed_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
  - `payload` JSONB NULL
- CREATE INDEX `idx_stripe_webhook_events_processed_at` ON (processed_at DESC)
- Implicit indexes: `stripe_webhook_events_pkey` (PK), `stripe_webhook_events_stripe_event_id_key` (UNIQUE)

## Diff Summary
`make diff` not usable (Makefile container-name bug, task 16). Pre-flight verification done via dry-run inside a transaction:

```sql
BEGIN;
\i migrations/cms/016_stripe_webhook_events.sql
-- inspect resulting columns and indexes
ROLLBACK;
```

Result matched spec exactly. Then applied via `psql -1` (single transaction, ON_ERROR_STOP=1):
```
CREATE TABLE
CREATE INDEX
```

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected
**none — additive only.** No DROP / ALTER / DELETE / UPDATE / RENAME / TRUNCATE.

### Baseline (captured 2026-04-18 12:03)
| Table | Pre rows | Fingerprint |
|-------|---------:|-------------|
| public.stripe_webhook_events | (does not exist) | n/a |
| public.subscriptions | 0 | n/a |
| public.subscription_plans | 0 | n/a |
| public.account | 2 | n/a |

### Downstream usage (grep across `services/`)
- `services/cms/extensions/local/project-extension-stripe/src/webhook-handlers.ts:10,13,30` — sole reader/writer (the new `withIdempotency()` helper). Expected.
- No other consumers in any service.

### Migration plan
None required (additive only).

### Acceptance criteria (post-apply)
- `public.stripe_webhook_events`: rows = 0 (newly created, empty)
- `public.subscriptions`: rows = 0 (UNCHANGED)
- `public.subscription_plans`: rows = 0 (UNCHANGED)
- `public.account`: rows = 2 (UNCHANGED)

## Phase 6.5 — Post-Apply Integrity Verification

| Table | Baseline rows | Post-apply rows | Expected | Result |
|-------|--------------:|----------------:|----------|--------|
| public.stripe_webhook_events | (n/a, didn't exist) | 0 | 0 (newly created) | **PASS** |
| public.subscriptions | 0 | 0 | unchanged | **PASS** |
| public.subscription_plans | 0 | 0 | unchanged | **PASS** |
| public.account | 2 | 2 | unchanged | **PASS** |

Schema verification (post-apply):
- 5 columns matching spec exactly (types, nullability, defaults all correct)
- 3 indexes present: `stripe_webhook_events_pkey`, `stripe_webhook_events_stripe_event_id_key` (UNIQUE on stripe_event_id), `idx_stripe_webhook_events_processed_at` (btree DESC on processed_at)

**Verdict: PASS — proceed to report.**

## Migration Scripts
- `migrations/cms/016_stripe_webhook_events.sql` (up, idempotent — `IF NOT EXISTS` on table + index)
- `migrations/cms/016_stripe_webhook_events_down.sql` (down — `DROP TABLE IF EXISTS public.stripe_webhook_events CASCADE`)

## Downstream Impact
- `services/cms/extensions/local/project-extension-stripe/src/webhook-handlers.ts` — refactored 439-line file uses `withIdempotency()` to check/insert event IDs against this table before processing. Already deployed in code; was waiting on this DDL.
- No other service code touches this table.
- No Directus collection metadata created (intentional — `public.*` raw infra table; not exposed in Directus admin UI).

## Rollback Plan
If rollback needed:
```bash
# Either: targeted DROP via the down migration
docker exec -i businesslogic-postgres-1 psql -U directus -d directus -v ON_ERROR_STOP=1 \
  -1 < migrations/cms/016_stripe_webhook_events_down.sql

# Or: full restore from pre-task PG dump
gunzip -c infrastructure/db-snapshots/pre_stripe-webhook-events_20260418_120202.sql.gz | \
  docker exec -i businesslogic-postgres-1 psql -U directus -d directus -v ON_ERROR_STOP=1
```

## Follow-up
None required (no structural risk; webhook-handlers.ts already references the new table; no UI surface).
