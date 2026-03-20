#!/bin/bash
# =============================================================================
# Diff Directus Schema
# =============================================================================
# Shows differences between current database schema and a snapshot
#
# Usage: ./diff-schema.sh [snapshot_file.yaml]
#        ./diff-schema.sh                    # Uses latest snapshot
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
        echo "Usage: ./diff-schema.sh [snapshot_file.yaml]"
        exit 1
    fi
    SNAPSHOT_FILE=$(basename "$SNAPSHOT_FILE")
fi

echo "Comparing current schema with: ${SNAPSHOT_FILE}"
echo ""

# Show the diff
docker compose exec directus npx directus schema diff "/directus/snapshots/${SNAPSHOT_FILE}"
