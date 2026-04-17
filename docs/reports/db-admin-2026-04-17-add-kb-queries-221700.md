# DB Admin Report — Add kb_queries table for KB query tracking

**Slug:** add-kb-queries
**Date:** 2026-04-17
**Status:** APPLIED
**Severity:** MEDIUM

## Task
Create kb_queries table for knowledge base query tracking. Fields: id (uuid PK), knowledge_base (FK to knowledge_bases), account (FK to account), query (text), type (string: search|ask), result_count (integer), timestamp (timestamp), date_created (timestamp auto). This table lives in the ai schema and is needed for the KB dashboard chart/KPI data.

## Snapshots
- pre PG dump: `infrastructure/db-snapshots/pre_add-kb-queries_20260417_221203.sql.gz`
- pre schema: `services/cms/snapshots/pre_add-kb-queries_20260417_221208.yaml`
- post PG dump: `infrastructure/db-snapshots/post_add-kb-queries_20260417_221617.sql.gz`
- post schema: `services/cms/snapshots/post_add-kb-queries_20260417_221623.yaml`

## Classification
MAJOR — new collection with FK relations to knowledge_bases and account, requires schema changes and permissions

## Changes Applied
- **Collection:** `kb_queries` (hidden, icon: query_stats)
- **Fields:** id (uuid PK), knowledge_base (uuid FK), account (uuid FK), query (text NOT NULL), type (varchar(255) NOT NULL), result_count (integer), timestamp (timestamptz), date_created (timestamptz, auto)
- **Relations:** kb_queries.knowledge_base -> knowledge_bases.id (CASCADE), kb_queries.account -> account.id (SET NULL)
- **Indexes:** idx_kb_queries_knowledge_base, idx_kb_queries_account, idx_kb_queries_date_created
- **Directus schema snapshot** updated (`snapshot.yaml`)
- **SQL migration** applied to create physical table + indexes + FKs

## Phase 4.5 — Data-Loss Risk Audit
### Destructive operations detected
none — additive only

## Phase 6.5 — Post-Apply Integrity Verification

| Table | Baseline rows | Post-apply rows | Expected | Result |
|-------|---------------|-----------------|----------|--------|
| public.kb_queries | n/a (new) | 0 | new table, 0 rows | PASS |
| public.knowledge_bases | 2 | 2 | preserved | PASS |
| public.account | 2 | 2 | preserved | PASS |

Verdict: PASS

## Diff Summary
All diff entries are additions of kb_queries collection, 8 fields, and 2 relations. No unexpected changes.

## Consultation Log
- 2026-04-17 22:12 — sent CONSULTATION to user: new kb_queries collection (MAJOR, additive only)
- 2026-04-17 22:17 — user approved

## Migration Scripts
- `migrations/ai/008_kb_queries.sql`
- `migrations/ai/008_kb_queries_down.sql`

## Downstream Impact
- Frontend composable `use-kb-dashboard-stats.ts` already expects this collection via `/items/kb_queries`
- ai-api service will write to this table for query tracking
- No existing code broken (additive only)

## Rollback Plan
```bash
# 1. Run down migration
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 < migrations/ai/008_kb_queries_down.sql

# 2. Restore pre-task PG dump if needed
gunzip -c infrastructure/db-snapshots/pre_add-kb-queries_20260417_221203.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

## Notes / Research
- Followed existing pattern from kb_answer_feedback (same FK structure: knowledge_base + account)
- Collection is hidden (like kb_answer_feedback) since it's backend data

## Follow-up
- ai-api needs to write queries to this table (search/ask endpoints)
- KB dashboard extension already expects the data — no UI changes needed
