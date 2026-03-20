# Database Snapshots

This directory holds rolling database snapshots for the BusinessLogic platform.

**Managed by:** `/project-review` skill (automatic) or manual `pg_dump`

**Policy:** Keep 5 most recent snapshots. Older ones are automatically rotated out.

**Format:** `snapshot_YYYYMMDD_HHMMSS_branchname.sql.gz`

**Schema-only export:** `schema_current.sql` (always up-to-date after review)

## Manual Operations

```bash
# Take a snapshot
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  pg_dump -U directus -d directus --clean --if-exists | gzip > \
  infrastructure/db-snapshots/snapshot_$(date +%Y%m%d_%H%M%S).sql.gz

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
