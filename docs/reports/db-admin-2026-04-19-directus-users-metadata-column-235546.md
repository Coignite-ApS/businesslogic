# DB Admin Report — directus-users-metadata-column

**Slug:** directus-users-metadata-column
**Date:** 2026-04-19 23:55
**Status:** APPLIED
**Severity:** MINOR — additive column, no data loss

## Task
Add `metadata JSONB DEFAULT '{}'::jsonb NOT NULL` to `directus_users`. Migration file: `migrations/cms/032_directus_users_metadata.sql` (forward + down). Enables `use-onboarding.ts` composable to persist onboarding state per user.

## Snapshots
- Pre PG dump:  `infrastructure/db-snapshots/pre_directus-users-metadata-column_20260419_235413.sql.gz`
- Pre YAML:     `services/cms/snapshots/pre_directus-users-metadata-column_20260419_235419.yaml`
- Post PG dump: `infrastructure/db-snapshots/post_directus-users-metadata-column_20260419_235528.sql.gz`
- Post YAML:    `services/cms/snapshots/post_directus-users-metadata-column_20260419_235532.yaml`

## Classification
MINOR — pure additive column. No drops, no type narrowing, no data transformations.

## Changes Applied
- `ALTER TABLE public.directus_users ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`

## Migration Scripts
- `migrations/cms/032_directus_users_metadata.sql` (forward)
- `migrations/cms/032_directus_users_metadata_down.sql` (down: DROP COLUMN IF EXISTS)

## Phase 4.5 — Data-Loss Risk Audit
**Destructive operations detected:** none — additive only

**Baseline (captured 2026-04-19 23:55):**
| Table | Rows |
|-------|------|
| public.directus_users | 4 |

**Downstream usage:** `use-onboarding.ts` reads/writes `metadata.onboarding_state` via Directus REST API (`GET /users/me?fields[]=metadata`, `PATCH /users/me`). All callers expect JSONB object — column type matches exactly.

**Acceptance criteria:** row count = 4 (preserved), column `metadata` JSONB NOT NULL default `'{}'`.

## Phase 6.5 — Post-Apply Integrity Verification
| Table | Baseline rows | Post-apply rows | Expected | Result |
|-------|---------------|-----------------|----------|--------|
| public.directus_users | 4 | 4 | preserved | **PASS** |

Column verification:
| Column | Type | Default | Nullable | Result |
|--------|------|---------|----------|--------|
| metadata | jsonb | `'{}'::jsonb` | NO | **PASS** |

Verdict: **PASS**

## Rollback Plan
```bash
gunzip -c infrastructure/db-snapshots/pre_directus-users-metadata-column_20260419_235413.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```
Or surgical: `ALTER TABLE public.directus_users DROP COLUMN IF EXISTS metadata;`

## Downstream Impact
- `services/cms/extensions/local/project-extension-account/src/composables/use-onboarding.ts` — now fully functional (was silently failing PATCH with unknown field)
- No other services reference `directus_users.metadata`

## Follow-up Tasks
none — column satisfies all code requirements without further changes
