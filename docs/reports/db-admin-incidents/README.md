# DB Admin Incidents

Permanent log of database-admin failures: rollbacks (Phase 6.5 integrity check failed) and restore failures (rollback itself failed). Written by the `db-admin` skill — see `.claude/skills/db-admin/SKILL.md`.

## What goes here

One markdown file per incident, named:

```
YYYY-MM-DD-<slug>-HHMMSS.md
```

The timestamp suffix guarantees uniqueness even if the same slug fails twice on the same date.

## What does NOT go here

- Successful db-admin tasks → `docs/reports/db-admin-YYYY-MM-DD-<slug>-HHMMSS.md`
- Cancelled tasks → `docs/reports/db-admin-YYYY-MM-DD-<slug>-HHMMSS-cancelled.md`
- Rolled-back task reports → `docs/reports/db-admin-YYYY-MM-DD-<slug>-HHMMSS-rolled-back.md` (paired with an incident log here)
- WIP files → `docs/reports/db-admin-WIP-<slug>.md`

## Retention

**Never auto-deleted, never archived.** Incidents are forensic evidence and historical record. Any cleanup is manual and deliberate.

The `make prune` script only touches `docs/reports/db-admin-*.md` at depth 1; this subfolder is excluded by design.

## Incident file structure

Every incident file MUST contain (writer fills first 5 sections; investigator fills the last 3):

1. **Header** — date, slug, severity, status (OPEN | INVESTIGATING | RESOLVED), classification (ROLLBACK | RESTORE-FAILURE)
2. **What was attempted** — one paragraph + link to the rolled-back report
3. **Failure detected** — the exact metric that failed (table, expected vs actual)
4. **Forensic artifacts** — absolute paths to `forensic_*` and `pre_*` snapshots, plus the failing baseline
5. **Restore outcome** — did the restore succeed? was the pre-baseline restored byte-for-byte?
6. **Investigation** — fill in as you analyze
7. **Root cause** — fill in once known
8. **Resolution** — link to the follow-up db-admin task that re-applied the change correctly
