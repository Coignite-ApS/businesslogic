#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_directus-common.sh"

MANIFEST=$(cat <<'CSV'
many_collection,many_field,one_collection,on_delete
account_features,account,account,CASCADE
account_features,feature,platform_features,CASCADE
ai_wallet,account_id,account,CASCADE
ai_wallet_failed_debits,account_id,account,CASCADE
ai_wallet_ledger,account_id,account,CASCADE
ai_wallet_ledger,topup_id,ai_wallet_topup,SET NULL
ai_wallet_ledger,usage_event_id,usage_events,SET NULL
ai_wallet_topup,account_id,account,CASCADE
ai_wallet_topup,initiated_by_user_id,directus_users,SET NULL
api_keys,account_id,account,CASCADE
calculator_slots,account_id,account,CASCADE
calculator_slots,calculator_config_id,calculator_configs,CASCADE
feature_quotas,account_id,account,CASCADE
feature_quotas,source_subscription_id,subscriptions,SET NULL
subscription_addons,account_id,account,CASCADE
subscription_addons,subscription_id,subscriptions,CASCADE
subscriptions,account_id,account,CASCADE
subscriptions,subscription_plan_id,subscription_plans,SET NULL
usage_events,account_id,account,CASCADE
wallet_auto_reload_pending,account_id,account,CASCADE
CSV
)

MANIFEST_LINES=$(printf '%s\n' "$MANIFEST" | tail -n +2 | wc -l | tr -d ' ')
echo "manifest: $MANIFEST_LINES m2o relations expected to be added"

EXISTING=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_relations;")
echo "current directus_relations rows: $EXISTING"

# Dry-run: print which manifest lines are already in directus_relations
echo "--- already-present manifest rows ---"
while IFS=, read -r mcol mfield ocol ondelete; do
  [[ "$mcol" == "many_collection" ]] && continue
  n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_relations WHERE many_collection='$mcol' AND many_field='$mfield';")
  [[ "$n" -gt 0 ]] && echo "  SKIP $mcol.$mfield (already registered)"
done <<< "$MANIFEST"

TOKEN="$(directus_auth)"
LOG="docs/reports/db-admin-add-relations.log"
mkdir -p "$(dirname "$LOG")"
echo "# add-missing-relations @ $(date -u +%FT%TZ)" | tee -a "$LOG"
echo "# path: SQL INSERT into directus_relations (Directus 11.16.1 POST/PATCH bugs out when FK already exists)" | tee -a "$LOG"

ok=0; skipped=0; fail=0
while IFS=, read -r mcol mfield ocol ondelete; do
  [[ "$mcol" == "many_collection" ]] && continue

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
  if psql_cmd -v ON_ERROR_STOP=1 -c "
    INSERT INTO directus_relations (many_collection, many_field, one_collection, one_field, one_collection_field, one_allowed_collections, junction_field, sort_field, one_deselect_action)
    VALUES ('$mcol', '$mfield', '$ocol', NULL, NULL, NULL, NULL, NULL, 'nullify')
    ON CONFLICT DO NOTHING;" >/dev/null 2>&1; then
    # Patch the child field's meta so the UI uses select-dropdown-m2o
    patch=$(jq -nc '{meta:{special:["m2o"], interface:"select-dropdown-m2o"}}')
    pcode="$(curl -s -o /dev/null -w '%{http_code}' \
      -X PATCH "$CMS_URL/fields/$mcol/$mfield" \
      -H "Authorization: Bearer $TOKEN" \
      -H 'content-type: application/json' \
      -d "$patch")"
    if [[ "$pcode" == "200" ]]; then
      ok=$((ok+1))
      echo "OK     $mcol.$mfield -> $ocol" | tee -a "$LOG"
    else
      fail=$((fail+1))
      echo "FAIL   $mcol.$mfield [field patch $pcode]" | tee -a "$LOG"
      exit 1
    fi
  else
    fail=$((fail+1))
    echo "FAIL   $mcol.$mfield [sql insert failed]" | tee -a "$LOG"
    exit 1
  fi
done <<< "$MANIFEST"

# Clear Directus schema cache so the running service picks up the new relations.
directus_cache_clear "$TOKEN" | tee -a "$LOG"

echo "--- phase-1 summary: sql_inserts=$ok skipped=$skipped fail=$fail ---" | tee -a "$LOG"
