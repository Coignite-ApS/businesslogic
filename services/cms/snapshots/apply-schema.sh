#!/bin/bash
# =============================================================================
# Apply Directus Schema Snapshot
# =============================================================================
# Applies a schema snapshot to the current Directus instance
#
# Usage: ./apply-schema.sh [snapshot_file.yaml]
#        ./apply-schema.sh                    # Uses latest snapshot
# =============================================================================

set -e

# Find snapshot file
if [ -n "$1" ]; then
    SNAPSHOT_FILE="$1"
else
    # Find the latest snapshot
    SNAPSHOT_FILE=$(ls -t snapshots/snapshot_*.yaml 2>/dev/null | head -1)
    if [ -z "$SNAPSHOT_FILE" ]; then
        echo "ERROR: No snapshot files found in snapshots/"
        echo "Usage: ./apply-schema.sh [snapshot_file.yaml]"
        exit 1
    fi
    SNAPSHOT_FILE=$(basename "$SNAPSHOT_FILE")
fi

echo "Applying schema from: ${SNAPSHOT_FILE}"
echo ""

# Apply the schema
docker compose exec directus npx directus schema apply "/directus/snapshots/${SNAPSHOT_FILE}" --yes

echo ""
echo "Schema applied successfully!"
