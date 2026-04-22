#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
LOG="docs/reports/db-admin-expand-api-keys-whitelist-apply.log"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --log)     LOG="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

source "$(dirname "$0")/_directus-common.sh"
[[ "${DRY_RUN:-0}" == "1" ]] || confirm_target_db || exit 1

mkdir -p "$(dirname "$LOG")"
label=""; [[ "$DRY_RUN" == "1" ]] && label=" (DRY-RUN)"
echo "# expand-api-keys-whitelist @ $(date -u +%FT%TZ)${label}" | tee -a "$LOG"

NEW_FIELDS="id,account_id,name,last_used_at,created_at,revoked_at,ai_spend_cap_monthly_eur,kb_search_cap_monthly,module_allowlist,key_prefix,environment,permissions,allowed_ips,allowed_origins"

# Safety gate: every field must exist in PG
for c in $(echo "$NEW_FIELDS" | tr ',' ' '); do
  preflight_column_exists api_keys "$c" || exit 1
done
echo "all 14 fields verified in PG" | tee -a "$LOG"

POLICY_ID=$(psql_cmd -t -A -c "SELECT id FROM directus_policies WHERE name='User Access' LIMIT 1;")
if [[ -z "$POLICY_ID" ]]; then
  echo "FAIL: no 'User Access' policy found" | tee -a "$LOG" >&2
  exit 1
fi
echo "User Access policy: $POLICY_ID" | tee -a "$LOG"

# Locate the existing permission row (Task D added it; we're widening, not creating)
PERM_ID=$(psql_cmd -t -A -c "SELECT id FROM directus_permissions WHERE policy='$POLICY_ID' AND collection='api_keys' AND action='read';")
if [[ -z "$PERM_ID" ]]; then
  echo "FAIL: no api_keys READ permission on User Access policy — run add-user-read-permissions.sh first" | tee -a "$LOG" >&2
  exit 1
fi
CURRENT=$(psql_cmd -t -A -c "SELECT fields FROM directus_permissions WHERE id='$PERM_ID';")
echo "permission id: $PERM_ID" | tee -a "$LOG"
echo "current fields: $CURRENT" | tee -a "$LOG"
echo "target fields:  $NEW_FIELDS" | tee -a "$LOG"

if [[ "$CURRENT" == "$NEW_FIELDS" ]]; then
  echo "SKIP: already at target" | tee -a "$LOG"
  exit 0
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY: would PATCH /permissions/$PERM_ID to target fields" | tee -a "$LOG"
  exit 0
fi

# Use Directus API PATCH (not raw SQL UPDATE) — the /permissions endpoint triggers
# the schema cache invalidation hook. Raw SQL writes to the same column but leaves
# the in-memory permission cache stale, so Sarah (or any non-admin) would continue
# seeing the OLD field whitelist until a full service restart. Learned the hard way.
TOKEN=$(directus_auth)
body=$(jq -nc --arg fields "$NEW_FIELDS" '{fields: ($fields | split(","))}')
http_body=$(mktemp); trap 'rm -f "$http_body"' EXIT
code=$(curl -s -o "$http_body" -w '%{http_code}' \
  -X PATCH "$CMS_URL/permissions/$PERM_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "$body")
if [[ "$code" == "200" ]]; then
  echo "PATCH /permissions/$PERM_ID succeeded" | tee -a "$LOG"
else
  msg=$(jq -r '.errors[0].message // empty' "$http_body" 2>/dev/null | head -c 300)
  echo "FAIL PATCH /permissions/$PERM_ID [$code] ${msg:-$(head -c 300 "$http_body")}" | tee -a "$LOG" >&2
  exit 1
fi

directus_cache_clear "$TOKEN" | tee -a "$LOG"
echo "--- done ---" | tee -a "$LOG"
