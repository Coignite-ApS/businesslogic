# DB Admin Report — Structure Cleanup Follow-ups

**Date:** 2026-04-20
**Slug:** structure-cleanup-followups
**Status:** DONE
**Severity:** INFO
**Classification:** MINOR (Directus metadata + script hardening only; no DDL; fully reversible via pre-snapshot)

## Summary

Closed all four non-blocking follow-ups filed from the db-structure-cleanup task's final code review:

| Phase | Change | Commit |
|---|---|---|
| F1 | Shared preflight helpers + prod-DB guard across all db-admin phase scripts | 451c062 |
| F2 | api_keys User-policy READ whitelist widened from 9 to 14 fields | 082423a |
| F3 | Polished 62 orphan-registered field interfaces (currencies/enums/downgrades/JSON) | 5af29b1 |

## Snapshot bracket

- pre PG dump:  `infrastructure/db-snapshots/pre_structure-cleanup-followups_20260420_200352.sql.gz`
- pre YAML:     `services/cms/snapshots/pre_structure-cleanup-followups_20260420_200356.yaml`
- post PG dump: `infrastructure/db-snapshots/post_structure-cleanup-followups_20260420_202939.sql.gz`
- post YAML:    `services/cms/snapshots/post_structure-cleanup-followups_20260420_202947.yaml`

## F1 — Script hardening

Added 3 helpers to `scripts/_directus-common.sh`:
- `confirm_target_db` — aborts if PG_HOST is not localhost/127.0.0.1/host.docker.internal/$PG_HOST_ALLOWLIST; override via ALLOW_NON_LOCAL=1.
- `preflight_column_exists <table> <col>` — aborts if column missing from PG.
- `preflight_filter_var <filter_json>` — validates every `$CURRENT_USER.<field>` in a Directus filter against `directus_users` columns.

Wired into 4 scripts: all 3 phase scripts + orchestrator. Phase scripts gate the guard on not-dry-run. `add-user-read-permissions.sh` gains a per-row filter-variable preflight loop — the check that would have caught the `$CURRENT_USER.account` → `active_account` drift from the prior task.

**Verification:** `PG_HOST=fake-prod bash scripts/add-missing-relations.sh` → exits 1 with "ABORT: non-local PG_HOST". `ALLOW_NON_LOCAL=1` override works.

## F2 — api_keys whitelist widening

`directus_permissions.id=171` (User Access policy, api_keys, action=read) widened from 9 fields to 14. New fields: `key_prefix, environment, permissions, allowed_ips, allowed_origins`. Secrets still excluded: `key_hash, encrypted_key`.

**Key learning:** raw SQL UPDATE on `directus_permissions.fields` writes the column correctly but leaves Directus's in-memory permission cache stale — non-admin reads kept returning the OLD field whitelist even after `/utils/cache/clear` + full container restart. Only `PATCH /permissions/:id` via the Directus API triggers proper cache invalidation. Script uses the API path.

The 3 other non-secret fields (`rate_limit_rps, monthly_quota, expires_at`) remain excluded — not referenced by current UI (YAGNI).

**Caveat:** the self-service UI at `project-extension-account/src/module.vue` reads api_keys via gateway proxy (`/account/api-keys` → `/internal/api-keys/`), not Directus. F2 is defense-in-depth for any future direct Directus reader.

**Verification:** E2E test `account-isolation.e2e.test.ts` at 37/37 pass — the api_keys test now asserts `key_prefix` IS exposed AND `key_hash`/`encrypted_key` are NOT. Live Sarah test: `GET /items/api_keys` returns all 14 fields, none of the 2 secrets.

## F3 — Orphan-field interface polish

62 fields patched via PATCH /fields/:col/:field:

| Category | Count | Treatment |
|---|---:|---|
| 3a Currency (€/$) | 18 | `display: "formatted-value"` + `display_options: {format: true, prefix: "€ "\|"$ "}` |
| 3b Enum dropdown | 20 | `interface: "select-dropdown"` + `display: "labels"` + theme-colored choices (success/warning/danger/foreground) |
| 3c input-multiline → input | 17 | Correct misclassified varchar>255 ID-string fields |
| 3d JSON fields | 7 | `options: {language: "json", lineNumber: true, lineWrapping: true}` + `special: ["cast-json"]` (GET-then-merge to preserve existing keys) |

**Excluded from 3b:**
- `stripe_webhook_events.event_type` — open-ended Stripe namespace (200+ values); leave as free-form input.
- `usage_events.event_kind` — data/migration mismatch (dot vs underscore); filed as `docs/tasks/cms/58-usage-events-event-kind-naming.md`.

Enum color strategy matches existing `account.status` pattern:
- `success`: active, completed, succeeded, published, reconciled
- `warning`: pending, processing, trialing, draft
- `danger`: failed, canceled, expired, past_due, debit_threw
- `foreground` (neutral): archived, waived, refunded, cancelled

**Verification:**
- `subscriptions.status` returns 5-element choices array with theme colors.
- `subscription_plans.price_eur_monthly.display_options == {format: true, prefix: "€ "}`.
- `usage_events.metadata.special == ["cast-json"]`; options.language == "json".
- Re-run script: 3d correctly SKIPs already-merged rows.

## Delta counts (baseline → final)

Nothing that shows up in row counts — all changes are column-level updates (`fields`, `options`, `display`, `display_options`, `interface`, `special`) on existing rows.

| Table | Rows before | Rows after | Note |
|---|---:|---:|---|
| directus_relations | 55 | 55 | unchanged |
| directus_collections | 43 | 43 | unchanged |
| directus_fields | 529 | 529 | unchanged |
| directus_permissions | 85 | 85 | unchanged (id 171 column-updated) |

## Rollback

```bash
gunzip -c infrastructure/db-snapshots/pre_structure-cleanup-followups_20260420_200352.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

## Separate follow-up filed

`docs/tasks/cms/58-usage-events-event-kind-naming.md` — data-integrity bug in `usage_events.event_kind`. Aggregator SQL (migrations 030/031/033) uses dot-notation; live data uses underscore. HIGH severity — affects billing aggregates.

## Learnings (for future db-admin tasks)

1. **SQL UPDATE on Directus system tables is cache-hostile.** Always use the Directus API (PATCH /fields, /permissions, /collections) when the update concerns runtime behavior. Raw SQL only for bulk operations + always follow with full service restart if the table affects the permission/schema cache.
2. **PATCH /fields/:col/:field merges columns but REPLACES JSONB values wholesale.** For options/display_options, use GET-then-merge client-side.
3. **Directus preflight should include filter-variable checks.** A filter like `{"account_id":{"_eq":"$CURRENT_USER.active_account"}}` only surfaces wrong-variable errors when actually invoked — at functional-test time, not apply time. F1's `preflight_filter_var` closes that gap for future scripts.
