# DB Admin Report — Structure Cleanup

**Date:** 2026-04-20
**Slug:** structure-cleanup
**Status:** DONE
**Severity:** INFO
**Classification:** MINOR (Directus metadata only; no DDL; fully reversible)

## Summary

Three follow-ups from the `register-orphan-fields` task closed. Directus schema now uniformly structured: every collection has a single PK, every FK has a Directus-registered m2o relation, self-service users can read their own data through the User Access policy with account-isolation filters.

| Phase | Change | Commit |
|---|---|---|
| 1 | Added 20 m2o relations to `directus_relations` + set m2o interface on 20 child fields | 1d997cf / 9f2a76a |
| 2 | Removed `monthly_aggregates` + `api_key_usage` from `directus_collections` (2 rows) + cleaned 33 ghost `directus_fields` rows. PG tables untouched. | 66f6f9f |
| 3 | Added 4 account-scoped User-policy READ permissions (account_features, ai_token_usage, api_keys, platform_features) | e5a07ce |

Also: `scripts/_directus-common.sh` (shared helper), `scripts/db-structure-cleanup.sh` (orchestrator), style fix for dry-run header label consistency.

## Snapshot bracket

- pre PG dump:   `infrastructure/db-snapshots/pre_structure-cleanup_20260420_175017.sql.gz` (26.2 MB)
- pre YAML:      `services/cms/snapshots/pre_structure-cleanup_20260420_175024.yaml` (562 KB)
- post PG dump:  `infrastructure/db-snapshots/post_structure-cleanup_20260420_191018.sql.gz` (25 MB) — taken after bogus_table prune
- post YAML:     `services/cms/snapshots/post_structure-cleanup_20260420_191022.yaml` (561 KB) — taken after bogus_table prune

## Delta counts (baseline → final)

| Table | Before (Task A) | After | Δ | Expected Δ |
|---|---:|---:|---:|---:|
| directus_relations | 35 | 55 | +20 | +20 |
| directus_collections | 45 | 43 | −2 | −2 |
| directus_fields | 562 | 529 | −33 | −33 |
| directus_permissions | 81 | 85 | +4 | +4 |

All four deltas match expected exactly. (An initial post-snapshot at `20260420_190408`/`190415` briefly showed +21 relations due to a `bogus_table/bogus_field` test row left from Task B's error-smoke; pruned before final post-snapshot.)

## Verification evidence

- **Aggregator end-to-end** — inserted `usage_events` row for account `8eeb078e-d01d-49db-859e-f30671ff9e53` with `event_kind='calc_call', module='calculators'`. Ran `aggregate_usage_events(202604)`: returned `{"lag_seconds": 0.082737, "periods_touched": 1, "accounts_touched": 1, "events_aggregated": 1}`, no error. `monthly_aggregates` upsert via `ON CONFLICT (account_id, period_yyyymm)` confirmed — row exists with `calc_calls=71`. Confirms composite-PK tables still work as backend rollup targets despite no longer being Directus-managed.
- **PG tables intact** — `pg_class` still shows `monthly_aggregates` and `api_key_usage` with `relkind='r'`.
- **Composite-PK collections de-managed** — `monthly_aggregates` and `api_key_usage` absent from `directus_collections` query (0 rows returned).
- **20 m2o relations for target collections** — subquery on `many_collection IN (account_features, ai_wallet, ...)` returns exactly 20.
- **4 user-scoped perms** — `directus_permissions` query for User Access policy on the 4 collections returns exactly 4.
- **CMS health** — HTTP 200.
- **CMS logs (30 min window)** — no new errors (only normal access log lines).

## Rollback (if ever needed)

```bash
# Restore the full DB to pre-structure-cleanup state:
gunzip -c infrastructure/db-snapshots/pre_structure-cleanup_20260420_175017.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

Snapshots retained under the standard `KEEP_TASK=20` policy — do not auto-prune.

## Corrections made to the plan during execution

1. **`platform_features` columns** — plan said `code` and `active`; actual PG columns are `key` and `enabled`. Preflight in Task D caught it before any write.
2. **Filter variable** — plan said `$CURRENT_USER.account`; actual field on `directus_users` is `active_account`. Caught by Sarah functional test AFTER the first apply; 4 broken rows deleted, re-applied with correction.
3. **Number of relations** — 20, not 21 as originally audited. Excluded `monthly_aggregates.account_id` since that collection is being removed per Phase 2.
4. **Task B mechanism** — used direct SQL `INSERT INTO directus_relations` (not `POST /relations`) because Directus 11.16.1 has a bug: `POST /relations` rejects when PG FK exists ("Field already has an associated relationship") and `PATCH /relations` crashes with `TypeError` in `RelationsService.alterType`. SQL insert is semantically identical and avoids the bug.

## Known non-issues

- `monthly_aggregates` and `api_key_usage` no longer appear in `directus schema snapshot` YAML output or Directus admin UI. Intentional. They are pure backend rollup tables populated by usage-consumer cron; schema is tracked via `migrations/cms/010_*.sql` and `014_*.sql`, not via Directus.
- The `api_keys` User-policy READ whitelist is narrow (9 fields). Code review flagged possible UX gaps (fields like `environment`, `permissions`, `allowed_ips`, `rate_limit_rps`, `expires_at` are non-secret but not exposed). Filed as follow-up; verify against API-keys UI and expand if needed.

## Follow-up items filed (non-blocking)

- **Harden preflight across scripts** — add filter-variable and child-collection-column checks to catch the `active_account` kind of drift before apply.
- **API-keys User read whitelist** — expand to include non-secret config fields once UI requirements confirmed.
- **`confirm_target_db()` helper** — guard all three phase scripts against accidental prod-DB execution. Lives in `_directus-common.sh`; all scripts would call it before any write.
- **Orphan-field interface polish (LOW)** — the 219 originally-registered fields use defaults; a batch polish pass could add currency formatting, enum dropdowns, etc. Filed in `docs/tasks/cms/55-batch-metadata-polish.md` (per the orphan-registration final report).
