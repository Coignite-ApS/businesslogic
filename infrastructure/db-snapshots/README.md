# Database Snapshots

This directory holds rolling database snapshots for the BusinessLogic platform.

**Managed by:** `/db-admin` skill (per-task `pre_/post_` snapshots), `/project-review` (routine), or manual `pg_dump`.

**Retention policy (count-based, never time-based):**
- Routine `snapshot_YYYYMMDD_HHMMSS[_slug].sql.gz` — keep last **10** (`KEEP_ROUTINE`)
- Task-bound `pre_<slug>_*.sql.gz` and `post_<slug>_*.sql.gz` — keep last **20 task slugs** (`KEEP_TASK`); `pre`+`post` of the same slug are deleted together
- Dryrun `dryrun_<purpose>_*.sql.gz` — keep last **2** (`KEEP_DRYRUN`); aggressively pruned
- Nothing is ever deleted because of age

Run `make prune` to apply rotation. See `.claude/skills/db-admin/SKILL.md` for the full workflow.

**Formats (strict — anything else is "irregular" and must be renamed or deleted manually):**
- `snapshot_YYYYMMDD_HHMMSS[_slug].sql.gz` — routine baseline (real history)
- `pre_<slug>_YYYYMMDD_HHMMSS.sql.gz` — before a db-admin task (real history)
- `post_<slug>_YYYYMMDD_HHMMSS.sql.gz` — after a db-admin task (real history)
- `dryrun_<purpose>_YYYYMMDD_HHMMSS.sql.gz` — exploratory / cancelled (NOT history)

**Irregular files** — names that look like ours (start with `snapshot_/pre_/post_/dryrun_`) but don't match the strict timestamp pattern — are reported by `make prune` and **never auto-deleted**. Goal: this directory contains only files you'd consult during an incident.

**Schema-only export:** `schema_current.sql` (always up-to-date after review)

## Quick Operations

```bash
# Routine snapshot
make snapshot

# Task-bound snapshot (REQUIRED for db-admin workflow)
make snapshot-pre  SLUG=<task-slug>
make snapshot-post SLUG=<task-slug>

# Restore from snapshot
gunzip -c infrastructure/db-snapshots/snapshot_XXXXX.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus

# Export schema only
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  pg_dump -U directus -d directus --schema-only --no-owner > \
  infrastructure/db-snapshots/schema_current.sql
```

**Note:** `.sql.gz` files are gitignored (too large for git). `schema_current.sql` and this README are tracked.
