#!/bin/bash
# =============================================================================
# Diff Directus Schema
# =============================================================================
# Shows differences between the CURRENT live database schema and a target
# snapshot YAML. Directus 11's CLI removed the `schema diff` subcommand, so
# we implement it manually: take a temporary "current" snapshot, run `diff -u`.
#
# Usage: ./diff-schema.sh [snapshot_file.yaml]
#        ./diff-schema.sh                    # Uses latest snapshot_*.yaml
# =============================================================================

set -e

# Must be run from services/cms/ so relative paths resolve correctly.
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f ../../infrastructure/docker/docker-compose.dev.yml"
CMS_SVC="bl-cms"
CMS_CONTAINER="businesslogic-bl-cms-1"

# Find snapshot file
if [ -n "$1" ]; then
    SNAPSHOT_FILE="$1"
else
    SNAPSHOT_FILE=$(ls -t snapshots/snapshot_*.yaml 2>/dev/null | head -1)
    if [ -z "$SNAPSHOT_FILE" ]; then
        echo "ERROR: No snapshot files found in snapshots/"
        echo "Usage: ./diff-schema.sh [snapshot_file.yaml]"
        exit 1
    fi
    SNAPSHOT_FILE=$(basename "$SNAPSHOT_FILE")
fi

TARGET_PATH="snapshots/${SNAPSHOT_FILE}"
if [ ! -f "$TARGET_PATH" ]; then
    echo "ERROR: $TARGET_PATH not found"
    exit 1
fi

# Take a temporary snapshot of the CURRENT DB state
TMP_NAME="_diff_current_$(date +%Y%m%d_%H%M%S).yaml"
trap "rm -f snapshots/${TMP_NAME}; ${COMPOSE} exec -T ${CMS_SVC} rm -f /directus/snapshots/${TMP_NAME} >/dev/null 2>&1 || true" EXIT

$COMPOSE exec -T "$CMS_SVC" node /directus/cli.js schema snapshot "/directus/snapshots/${TMP_NAME}" >/dev/null
docker cp "${CMS_CONTAINER}:/directus/snapshots/${TMP_NAME}" "snapshots/${TMP_NAME}" >/dev/null

echo "Diff: current DB schema vs ${SNAPSHOT_FILE}"
echo "      (- = in snapshot only, + = in live DB only)"
echo ""

# Unified diff. Exit 0 = no diff, 1 = differences, 2 = error. We want to return 0 either way
# (diff's "differences found" isn't an error from the user's perspective).
diff -u "$TARGET_PATH" "snapshots/${TMP_NAME}" || true
