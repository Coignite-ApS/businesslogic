-- Reverse of 003_pricing_v2_drop_legacy.sql
--
-- Cannot programmatically restore dropped data + metadata. Restore from the
-- pre-task PG dump:
--
--   gunzip -c infrastructure/db-snapshots/pre_pricing-v2-schema-approved_20260418_062925.sql.gz | \
--     docker exec -i businesslogic-postgres-1 psql -U directus -d directus -v ON_ERROR_STOP=1
--
-- This file exists only to satisfy the up/down pairing convention.

SELECT 'Restore from pre_pricing-v2-schema-approved_20260418_062925.sql.gz — see file header' AS message;
