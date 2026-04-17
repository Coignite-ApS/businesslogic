# `cms` Schema Migrations

Owns: PostgreSQL schema `cms.*` and the Directus internal `directus_*` system tables.

## File Convention

```
NNN_short_description.sql        # up migration (idempotent if possible)
NNN_short_description_down.sql   # paired down migration (must reverse the up)
```

`NNN` is the next sequential number in this directory. Always pair `up` + `_down`.

## Authoring Rules

1. **Schema changes go through Directus when possible.** Use the snapshot+apply workflow (`services/cms/snapshots/`) instead of raw SQL whenever the change can be expressed as a Directus schema change. Use raw SQL here only for things Directus can't model (custom indexes, partitions, `pg_*` extensions, custom constraints, data migrations).

2. **Always provide a down script.** The down must actually reverse the up. If a change is one-way (e.g., destructive data migration), document why and provide the closest-possible reversal (restore from snapshot reference).

3. **Use idempotent constructs.**
   - `CREATE TABLE IF NOT EXISTS`
   - `CREATE INDEX IF NOT EXISTS`
   - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
   - Wrap data changes in transactions; use `ON CONFLICT DO NOTHING/UPDATE` where applicable.

4. **Never modify an applied migration.** Add a new one. The applied numbers are immutable history.

5. **Test on a snapshot first.** Before applying to dev:
   ```bash
   make snapshot                       # baseline PG dump
   docker compose exec -T postgres psql -U directus -d directus \
     -v ON_ERROR_STOP=1 -1 -f - < migrations/cms/NNN_*.sql
   # -1 wraps in a single transaction; if it errors, nothing committed.
   ```

6. **Pair every migration with a db-admin report.** The report at `docs/reports/db-admin-YYYY-MM-DD-<slug>.md` must reference both the up and down files. See `.claude/skills/db-admin/SKILL.md`.

## Directus + Raw SQL Coexistence

Directus owns the schema as defined in `services/cms/snapshots/snapshot.yaml`. Raw SQL migrations in this directory must NOT conflict with Directus's view of the schema:

- **Allowed:** add indexes, add CHECK constraints, partition existing tables, add columns NOT managed by Directus (rare — only for system-internal use)
- **Risky:** changing column types, dropping columns, renaming — these will desync from Directus and break the next `schema apply`. Always do these via Directus snapshot, not raw SQL.

When in doubt, route through the db-admin skill (`/db-admin <task>`).

## Current Migrations

(none yet — this directory is the entry point for `cms` schema migrations going forward)
