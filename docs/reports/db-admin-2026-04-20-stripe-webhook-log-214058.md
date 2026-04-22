# DB Admin Report — stripe-webhook-log

**Slug:** stripe-webhook-log
**Date:** 2026-04-20
**Status:** APPLIED
**Severity:** INFO
**Classification:** MINOR — additive only (new table + indexes, no existing data affected)

## Task
Create `public.stripe_webhook_log` table for task 56 — Stripe webhook observability.
New public table only; no directus_* changes. Raw SQL migration (035).

## Snapshots
- Pre PG dump:   `infrastructure/db-snapshots/pre_stripe-webhook-log_20260420_213955.sql.gz`
- Pre YAML:      `services/cms/snapshots/pre_stripe-webhook-log_20260420_214002.yaml`
- Post PG dump:  `infrastructure/db-snapshots/post_stripe-webhook-log_20260420_214036.sql.gz`
- Post YAML:     `services/cms/snapshots/post_stripe-webhook-log_20260420_214042.yaml`

## Phase 4.5 — Data-Loss Risk Audit
**Destructive operations detected:** none — additive only.

No DROPs, no type changes, no NOT NULL on existing columns. New table with default values only.

## Changes Applied
1. `CREATE TABLE public.stripe_webhook_log` — 7 columns + uuid PK with gen_random_uuid()
2. `CREATE INDEX idx_stripe_webhook_log_received_at` — btree(received_at DESC)
3. `CREATE INDEX idx_stripe_webhook_log_status` — partial btree(status) WHERE status <> '200'

## Migration Scripts
- `migrations/cms/035_stripe_webhook_log.sql` — up
- `migrations/cms/035_stripe_webhook_log_down.sql` — down

## Phase 6.5 — Post-Apply Integrity Verification

| Table | Expected rows | Post-apply rows | Result |
|-------|---------------|-----------------|--------|
| public.stripe_webhook_log | 0 (new) | 0 | PASS |

Schema verified via `\d public.stripe_webhook_log` — all 7 columns + PK + 2 indexes match spec.

**Verdict: PASS**

## Rollback Plan
```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 \
  -f - < migrations/cms/035_stripe_webhook_log_down.sql
```
Or restore from pre-task dump:
```bash
gunzip -c infrastructure/db-snapshots/pre_stripe-webhook-log_20260420_213955.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

## Downstream Impact
No existing code references `stripe_webhook_log` — confirmed by grep before apply.
The extension code that will write to this table is part of task 56 implementation (not yet committed).

## Follow-up Tasks
- Task 56 (in progress): implement webhook handler writes + health endpoint + Vue panel
- Retention cron (>90d trim) explicitly out of scope per task 56 spec
