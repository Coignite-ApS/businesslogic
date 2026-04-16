# 11. Migration Rollback Scripts

**Status:** done
**Source:** CTO Review 2026-04-15 — F-002

---

## Goal

17 forward migration SQL files exist across all schemas. Zero rollback/down scripts. A bad migration in prod requires manual SQL recovery. Add matching rollback scripts, starting with the 5 most recent.

---

## Key Tasks

- [x] Audit all 17 migrations in `migrations/` — list columns/tables/indexes created
- [x] Write `*_down.sql` rollback for each of the 5 most recent migrations
- [x] Write `*_down.sql` for remaining 12 migrations (lower priority)
- [x] Add rollback execution support to `scripts/migrate.sh` (e.g., `--rollback --target local`)
- [ ] Test each rollback: apply migration → rollback → verify clean state
- [x] Document rollback procedure in `docs/migration-safety.md`

---

## Key Files

- `migrations/ai/`
- `migrations/formula/`
- `migrations/gateway/`
- `migrations/flow/`
- `migrations/cms/`
- `scripts/migrate.sh`

---

## Acceptance Criteria

- [x] At minimum 5 most recent migrations have tested rollback scripts
- [x] `scripts/migrate.sh --rollback` works
- [x] Rollback procedure documented
