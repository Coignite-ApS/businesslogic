#!/usr/bin/env bash
# Runs the three phase scripts in order. Stops on any failure.
# Re-runnable: each phase script is idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Phase 1: add m2o relations ==="
bash scripts/add-missing-relations.sh
echo ""

echo "=== Phase 2: remove composite-PK collections from directus ==="
bash scripts/remove-composite-pk-collections.sh
echo ""

echo "=== Phase 3: add user-read permissions ==="
bash scripts/add-user-read-permissions.sh
echo ""

echo "=== DONE ==="
