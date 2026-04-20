#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
LOG="docs/reports/db-admin-add-user-perms-apply.log"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --log)     LOG="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

source "$(dirname "$0")/_directus-common.sh"

mkdir -p "$(dirname "$LOG")"
label=""; [[ "$DRY_RUN" == "1" ]] && label=" (DRY-RUN)"
echo "# add-user-read-permissions @ $(date -u +%FT%TZ)${label}" | tee -a "$LOG"

# -------- Resolve the User Access policy UUID --------
USER_POLICY_ID=$(psql_cmd -t -A -c "SELECT id FROM directus_policies WHERE name='User Access' LIMIT 1;")
if [[ -z "$USER_POLICY_ID" ]]; then
  echo "FAIL: no 'User Access' policy found" | tee -a "$LOG" >&2
  exit 1
fi
echo "User Access policy: $USER_POLICY_ID" | tee -a "$LOG"

# -------- Manifest — 4 rows, pipe-delimited (JSON filter contains commas) --------
declare -a ROWS=(
  "account_features|{\"account\":{\"_eq\":\"\$CURRENT_USER.active_account\"}}|*"
  "ai_token_usage|{\"account\":{\"_eq\":\"\$CURRENT_USER.active_account\"}}|*"
  "api_keys|{\"account_id\":{\"_eq\":\"\$CURRENT_USER.active_account\"}}|id,account_id,name,last_used_at,created_at,revoked_at,ai_spend_cap_monthly_eur,kb_search_cap_monthly,module_allowlist"
  "platform_features|{\"enabled\":{\"_eq\":true}}|id,key,name,description,enabled"
)

# -------- Preflight — show per-row existing-permission state --------
echo "--- preflight: existing read permissions on User Access policy ---" | tee -a "$LOG"
for row in "${ROWS[@]}"; do
  IFS='|' read -r coll perm fields <<< "$row"
  existing=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_permissions WHERE policy='$USER_POLICY_ID' AND collection='$coll' AND action='read';")
  echo "  $coll: $existing existing read perm(s)" | tee -a "$LOG"
done

# -------- Preflight — verify listed fields actually exist on api_keys and platform_features --------
echo "--- preflight: verify restricted field lists exist in PG ---" | tee -a "$LOG"
for coll in api_keys platform_features; do
  expected_fields=$(printf '%s\n' "${ROWS[@]}" | grep "^$coll|" | cut -d'|' -f3 | tr ',' '\n')
  for f in $expected_fields; do
    [[ "$f" == "*" ]] && continue
    n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='$coll' AND column_name='$f';")
    if [[ "$n" != "1" ]]; then
      echo "  ABORT: $coll.$f does NOT exist in PG (fields allowlist is wrong)" | tee -a "$LOG" >&2
      exit 1
    fi
  done
  echo "  $coll: all $(echo "$expected_fields" | wc -l | tr -d ' ') fields verified in PG" | tee -a "$LOG"
done

# -------- Preflight — verify platform_features has 'enabled' column for the filter --------
enabled_col=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_features' AND column_name='enabled';")
if [[ "$enabled_col" != "1" ]]; then
  echo "  ABORT: platform_features.enabled column missing — filter {\"enabled\":{\"_eq\":true}} will always return empty set" | tee -a "$LOG" >&2
  exit 1
fi
echo "  platform_features.enabled: present" | tee -a "$LOG"

# -------- Dry-run: stop here --------
if [[ "$DRY_RUN" == "1" ]]; then
  echo "" | tee -a "$LOG"
  echo "--- DRY-RUN: no writes performed ---" | tee -a "$LOG"
  for row in "${ROWS[@]}"; do
    IFS='|' read -r coll perm fields <<< "$row"
    echo "  DRY  $coll (filter: $perm, fields: $fields)" | tee -a "$LOG"
  done
  exit 0
fi

# -------- Apply --------
TOKEN="$(directus_auth)"

ok=0; skipped=0; fail=0
for row in "${ROWS[@]}"; do
  IFS='|' read -r coll perm fields <<< "$row"

  existing=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_permissions WHERE policy='$USER_POLICY_ID' AND collection='$coll' AND action='read';")
  if [[ "$existing" != "0" ]]; then
    skipped=$((skipped+1))
    echo "SKIP   $coll (perm already exists)" | tee -a "$LOG"
    continue
  fi

  body=$(jq -nc \
    --arg policy "$USER_POLICY_ID" \
    --arg coll "$coll" \
    --argjson perm "$perm" \
    --arg fields "$fields" \
    '{policy:$policy, collection:$coll, action:"read", permissions:$perm, fields:$fields}')

  http_body="$(mktemp)"
  code="$(curl -s -o "$http_body" -w '%{http_code}' \
    -X POST "$CMS_URL/permissions" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' \
    -d "$body")"

  case "$code" in
    200|204)
      ok=$((ok+1))
      echo "OK     $coll" | tee -a "$LOG" ;;
    *)
      fail=$((fail+1))
      msg="$(jq -r '.errors[0].message // empty' "$http_body" 2>/dev/null | head -c 300)"
      echo "FAIL   $coll [$code] ${msg:-$(head -c 300 "$http_body")}" | tee -a "$LOG"
      echo "       body sent: $body" | tee -a "$LOG"
      rm -f "$http_body"
      exit 1
      ;;
  esac
  rm -f "$http_body"
done

directus_cache_clear "$TOKEN" | tee -a "$LOG"
echo "--- phase-3 summary: ok=$ok skipped=$skipped fail=$fail ---" | tee -a "$LOG"
