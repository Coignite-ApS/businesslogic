#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0
LOG="docs/reports/db-admin-add-relations-apply.log"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --log)     LOG="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

source "$(dirname "$0")/_directus-common.sh"

MANIFEST=$(cat <<'CSV'
many_collection,many_field,one_collection
account_features,account,account
account_features,feature,platform_features
ai_wallet,account_id,account
ai_wallet_failed_debits,account_id,account
ai_wallet_ledger,account_id,account
ai_wallet_ledger,topup_id,ai_wallet_topup
ai_wallet_ledger,usage_event_id,usage_events
ai_wallet_topup,account_id,account
ai_wallet_topup,initiated_by_user_id,directus_users
api_keys,account_id,account
calculator_slots,account_id,account
calculator_slots,calculator_config_id,calculator_configs
feature_quotas,account_id,account
feature_quotas,source_subscription_id,subscriptions
subscription_addons,account_id,account
subscription_addons,subscription_id,subscriptions
subscriptions,account_id,account
subscriptions,subscription_plan_id,subscription_plans
usage_events,account_id,account
wallet_auto_reload_pending,account_id,account
CSV
)

mkdir -p "$(dirname "$LOG")"
label=""; [[ "$DRY_RUN" == "1" ]] && label=" (DRY-RUN)"
echo "# add-missing-relations @ $(date -u +%FT%TZ)${label}" | tee -a "$LOG"
echo "# path: SQL INSERT into directus_relations (Directus 11.16.1 POST/PATCH bugs out when FK already exists)" | tee -a "$LOG"

MANIFEST_LINES=$(printf '%s\n' "$MANIFEST" | tail -n +2 | wc -l | tr -d ' ')
echo "manifest: $MANIFEST_LINES m2o relations expected to be added" | tee -a "$LOG"

EXISTING=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_relations;")
echo "current directus_relations rows: $EXISTING" | tee -a "$LOG"

# Auth — surface failures before any DB work (skipped in dry-run)
if [[ "$DRY_RUN" != "1" ]]; then
  TOKEN="$(directus_auth)"
fi

# Dry-run: print which manifest lines are already in directus_relations
echo "--- already-present manifest rows ---" | tee -a "$LOG"
while IFS=, read -r mcol mfield ocol; do
  [[ "$mcol" == "many_collection" ]] && continue
  n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_relations WHERE many_collection='$mcol' AND many_field='$mfield';")
  [[ "$n" -gt 0 ]] && echo "  SKIP $mcol.$mfield (already registered)" | tee -a "$LOG"
done <<< "$MANIFEST"

err=$(mktemp); trap 'rm -f "$err"' EXIT

ok=0; skipped=0; fail=0
while IFS=, read -r mcol mfield ocol; do
  [[ "$mcol" == "many_collection" ]] && continue

  # Dry-run path
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY    $mcol.$mfield -> $ocol" | tee -a "$LOG"
    ok=$((ok+1))
    continue
  fi

  # Idempotency check
  n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_relations WHERE many_collection='$mcol' AND many_field='$mfield';")
  if [[ "$n" -gt 0 ]]; then
    skipped=$((skipped+1))
    echo "SKIP   $mcol.$mfield (already in directus_relations)" | tee -a "$LOG"
    continue
  fi

  # All 20 relations already have Postgres FK constraints but no directus_relations meta row.
  # PATCH /relations/:col/:field crashes Directus (alterType bug on pre-existing FKs).
  # INSERT directly into directus_relations to register metadata without touching DB schema.
  if psql_cmd -v ON_ERROR_STOP=1 2>"$err" >/dev/null <<SQL
INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
VALUES ('$mcol', '$mfield', '$ocol', NULL, NULL, NULL, NULL, NULL, 'nullify')
ON CONFLICT DO NOTHING;
SQL
  then
    # Patch the child field's meta so the UI uses select-dropdown-m2o
    patch=$(jq -nc '{meta:{special:["m2o"], interface:"select-dropdown-m2o"}}')
    patch_body=$(mktemp)
    pcode="$(curl -s -o "$patch_body" -w '%{http_code}' \
      -X PATCH "$CMS_URL/fields/$mcol/$mfield" \
      -H "Authorization: Bearer $TOKEN" \
      -H 'content-type: application/json' \
      -d "$patch")"
    if [[ "$pcode" == "200" ]]; then
      ok=$((ok+1))
      echo "OK     $mcol.$mfield -> $ocol" | tee -a "$LOG"
    else
      fail=$((fail+1))
      msg="$(jq -r '.errors[0].message // empty' "$patch_body" 2>/dev/null | head -c 300)"
      echo "FAIL   $mcol.$mfield [fields PATCH $pcode] ${msg:-$(head -c 300 "$patch_body")}" | tee -a "$LOG"
      rm -f "$patch_body"
      exit 1
    fi
    rm -f "$patch_body"
  else
    fail=$((fail+1))
    echo "FAIL   $mcol.$mfield [sql insert]" | tee -a "$LOG"
    sed 's/^/       /' "$err" | tee -a "$LOG"
    exit 1
  fi
done <<< "$MANIFEST"

# Clear Directus schema cache so the running service picks up the new relations.
if [[ "$DRY_RUN" != "1" ]]; then
  directus_cache_clear "$TOKEN" | tee -a "$LOG"
fi

echo "--- phase-1 summary: sql_inserts=$ok skipped=$skipped fail=$fail ---" | tee -a "$LOG"
