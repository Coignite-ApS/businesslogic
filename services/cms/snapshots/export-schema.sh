#!/bin/bash
# =============================================================================
# Export Directus Schema Snapshot
# =============================================================================
# Creates a timestamped snapshot of the current Directus schema
#
# Usage: ./export-schema.sh
# =============================================================================

set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SNAPSHOT_FILE="snapshot_${TIMESTAMP}.yaml"

echo "Exporting Directus schema snapshot..."
echo ""

docker compose exec directus npx directus schema snapshot "/directus/snapshots/${SNAPSHOT_FILE}"

echo ""
echo "Schema exported to: snapshots/${SNAPSHOT_FILE}"
echo ""
echo "Commit this file to version control to track schema changes."
