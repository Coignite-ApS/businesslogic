#!/usr/bin/env bash
# Polish interface/display metadata for ~62 orphan-registered fields.
# Categories: 3a currency (18), 3b enum dropdowns (20), 3c multiline→input (17), 3d JSON (7).
# All patches via Directus API (PATCH /fields/:col/:field) — raw SQL leaves schema cache stale.
# 3d fields use GET-then-merge to preserve pre-existing options keys.
#
# Usage:
#   ./scripts/polish-orphan-field-metadata.sh [--dry-run] [--log <path>]
set -euo pipefail

DRY_RUN=0
LOG="docs/reports/db-admin-polish-orphan-field-metadata-apply.log"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --log)     LOG="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_directus-common.sh"

[[ "${DRY_RUN:-0}" == "1" ]] || confirm_target_db || exit 1

mkdir -p "$(dirname "$LOG")"
label=""; [[ "$DRY_RUN" == "1" ]] && label=" (DRY-RUN)"
echo "# polish-orphan-field-metadata @ $(date -u +%FT%TZ)${label}" | tee -a "$LOG"

TOKEN=""
if [[ "$DRY_RUN" != "1" ]]; then
  TOKEN=$(directus_auth)
fi

ok=0; skipped=0; fail=0

# ------------------------------------------------------------
# patch_field <collection> <field> <json-body>
# PATCH /fields/:col/:field — Directus merges at the column level
# (only the keys you send are changed; sort/hidden/readonly/special preserved).
# ------------------------------------------------------------
patch_field() {
  local coll="$1" field="$2" body="$3"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY    $coll.$field" | tee -a "$LOG"
    ok=$((ok+1))
    return 0
  fi
  local http_body; http_body=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f '$http_body'" RETURN
  local code
  code=$(curl -s -o "$http_body" -w '%{http_code}' \
    -X PATCH "$CMS_URL/fields/$coll/$field" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' \
    -d "$body")
  if [[ "$code" == "200" ]]; then
    ok=$((ok+1))
    echo "OK     $coll.$field" | tee -a "$LOG"
  else
    fail=$((fail+1))
    local msg; msg=$(jq -r '.errors[0].message // empty' "$http_body" 2>/dev/null | head -c 300)
    echo "FAIL   $coll.$field [$code] ${msg:-$(head -c 300 "$http_body")}" | tee -a "$LOG" >&2
    exit 1
  fi
}

# ============================================================
# 3a — Currency fields (18)
# display: "formatted-value", display_options: {format: true, prefix: "€ " or "$ "}
# Leave interface as-is (orphan-reg set it to "input").
# ============================================================
echo "--- 3a: currency fields (18) ---" | tee -a "$LOG"

patch_currency_field() {
  local symbol="$1" coll="$2" field="$3"
  local body
  body=$(jq -nc --arg prefix "${symbol} " '{
    meta: {
      display: "formatted-value",
      display_options: {format: true, prefix: $prefix}
    }
  }')
  patch_field "$coll" "$field" "$body"
}

# EUR fields
patch_currency_field "€" ai_wallet            auto_reload_amount_eur
patch_currency_field "€" ai_wallet            auto_reload_threshold_eur
patch_currency_field "€" ai_wallet            balance_eur
patch_currency_field "€" ai_wallet            last_topup_eur
patch_currency_field "€" ai_wallet            monthly_cap_eur
patch_currency_field "€" ai_wallet_failed_debits cost_eur
patch_currency_field "€" ai_wallet_ledger     amount_eur
patch_currency_field "€" ai_wallet_ledger     balance_after_eur
patch_currency_field "€" ai_wallet_topup      amount_eur
patch_currency_field "€" api_keys             ai_spend_cap_monthly_eur
patch_currency_field "€" subscription_addons  price_eur_monthly
patch_currency_field "€" subscription_plans   price_eur_annual
patch_currency_field "€" subscription_plans   price_eur_monthly
patch_currency_field "€" subscriptions        grandfather_price_eur
patch_currency_field "€" usage_events         cost_eur
patch_currency_field "€" wallet_auto_reload_pending amount_eur

# USD fields
patch_currency_field "\$" ai_token_usage         cost_usd
patch_currency_field "\$" ai_wallet_failed_debits cost_usd

# ============================================================
# 3b — Enum dropdowns (20)
# interface: "select-dropdown", options: {choices: [...]},
# display: "labels", display_options: {choices: [...], showAsDot: true}
#
# Choice shape (mirroring account.status reference row):
#   options.choices:         [{text, value, color}]
#   display_options.choices: [{text, value, color, foreground, background}]
#
# Color tokens:
#   success  → color: var(--theme--success)      bg: var(--theme--success-background)
#   warning  → color: var(--theme--warning)      bg: var(--theme--warning-background)
#   danger   → color: var(--theme--danger)       bg: var(--theme--danger-background)
#   primary  → color: var(--theme--primary)      bg: var(--theme--primary-background)
#   neutral  → color: var(--theme--foreground)   bg: var(--theme--background-normal)
# ============================================================
echo "--- 3b: enum dropdowns (20) ---" | tee -a "$LOG"

# Helper: builds and patches a select-dropdown with labels display.
# Choices are passed as a compact JSON array of {text,value,color,foreground,background}.
# options.choices uses only {text,value,color}; display_options.choices uses all five.
patch_enum_field() {
  local coll="$1" field="$2" choices_json="$3"
  local body
  body=$(jq -nc --argjson choices "$choices_json" '{
    meta: {
      interface: "select-dropdown",
      options: {
        choices: ($choices | map({text: .text, value: .value, color: .color}))
      },
      display: "labels",
      display_options: {
        choices: ($choices | map({
          text: .text,
          value: .value,
          color: .color,
          foreground: .foreground,
          background: .background
        })),
        showAsDot: true
      }
    }
  }')
  patch_field "$coll" "$field" "$body"
}

# ------ ai_wallet_failed_debits.status ------
# pending (warning), reconciled (success), waived (neutral)
patch_enum_field ai_wallet_failed_debits status '[
  {"text":"Pending",      "value":"pending",      "color":"var(--theme--warning)",    "foreground":"var(--theme--warning)",    "background":"var(--theme--warning-background)"},
  {"text":"Reconciled",   "value":"reconciled",   "color":"var(--theme--success)",    "foreground":"var(--theme--success)",    "background":"var(--theme--success-background)"},
  {"text":"Waived",       "value":"waived",       "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"}
]'

# ------ ai_wallet_failed_debits.reconciliation_method ------
# manual/auto/waived — no status semantics, use neutral
patch_enum_field ai_wallet_failed_debits reconciliation_method '[
  {"text":"Manual", "value":"manual", "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Auto",   "value":"auto",   "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Waived", "value":"waived", "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"}
]'

# ------ ai_wallet_failed_debits.error_reason ------
# debit_returned_not_ok (danger), debit_threw (danger)
patch_enum_field ai_wallet_failed_debits error_reason '[
  {"text":"Debit Returned Not OK", "value":"debit_returned_not_ok", "color":"var(--theme--danger)", "foreground":"var(--theme--danger)", "background":"var(--theme--danger-background)"},
  {"text":"Debit Threw",          "value":"debit_threw",           "color":"var(--theme--danger)", "foreground":"var(--theme--danger)", "background":"var(--theme--danger-background)"}
]'

# ------ ai_wallet_failed_debits.event_kind ------
# ai.message, kb.ask — neutral labels
patch_enum_field ai_wallet_failed_debits event_kind '[
  {"text":"AI Message", "value":"ai.message", "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"KB Ask",     "value":"kb.ask",     "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"}
]'

# ------ ai_wallet_failed_debits.module ------
# calculators, kb, flows, ai — neutral
patch_enum_field ai_wallet_failed_debits module '[
  {"text":"Calculators", "value":"calculators", "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"KB",          "value":"kb",          "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Flows",       "value":"flows",       "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"AI",          "value":"ai",          "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"}
]'

# ------ ai_wallet_ledger.entry_type ------
# credit (success), debit (danger)
patch_enum_field ai_wallet_ledger entry_type '[
  {"text":"Credit", "value":"credit", "color":"var(--theme--success)", "foreground":"var(--theme--success)", "background":"var(--theme--success-background)"},
  {"text":"Debit",  "value":"debit",  "color":"var(--theme--danger)",  "foreground":"var(--theme--danger)",  "background":"var(--theme--danger-background)"}
]'

# ------ ai_wallet_ledger.source ------
# topup (primary), usage (neutral), refund (neutral), promo (primary), adjustment (neutral)
patch_enum_field ai_wallet_ledger source '[
  {"text":"Top-up",     "value":"topup",      "color":"var(--theme--primary)",    "foreground":"var(--theme--primary)",    "background":"var(--theme--primary-background)"},
  {"text":"Usage",      "value":"usage",      "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Refund",     "value":"refund",     "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Promo",      "value":"promo",      "color":"var(--theme--primary)",    "foreground":"var(--theme--primary)",    "background":"var(--theme--primary-background)"},
  {"text":"Adjustment", "value":"adjustment", "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"}
]'

# ------ ai_wallet_topup.status ------
# pending (warning), completed (success), refunded (neutral), failed (danger)
patch_enum_field ai_wallet_topup status '[
  {"text":"Pending",   "value":"pending",   "color":"var(--theme--warning)",    "foreground":"var(--theme--warning)",    "background":"var(--theme--warning-background)"},
  {"text":"Completed", "value":"completed", "color":"var(--theme--success)",    "foreground":"var(--theme--success)",    "background":"var(--theme--success-background)"},
  {"text":"Refunded",  "value":"refunded",  "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Failed",    "value":"failed",    "color":"var(--theme--danger)",     "foreground":"var(--theme--danger)",     "background":"var(--theme--danger-background)"}
]'

# ------ api_keys.environment ------
# live (success), test (warning), dev (neutral)
patch_enum_field api_keys environment '[
  {"text":"Live", "value":"live", "color":"var(--theme--success)",    "foreground":"var(--theme--success)",    "background":"var(--theme--success-background)"},
  {"text":"Test", "value":"test", "color":"var(--theme--warning)",    "foreground":"var(--theme--warning)",    "background":"var(--theme--warning-background)"},
  {"text":"Dev",  "value":"dev",  "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"}
]'

# ------ feature_quotas.module ------
patch_enum_field feature_quotas module '[
  {"text":"Calculators", "value":"calculators", "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"KB",          "value":"kb",          "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Flows",       "value":"flows",       "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"AI",          "value":"ai",          "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"}
]'

# ------ subscription_addons.status ------
# active (success), canceled (neutral), expired (danger)
patch_enum_field subscription_addons status '[
  {"text":"Active",   "value":"active",   "color":"var(--theme--success)",    "foreground":"var(--theme--success)",    "background":"var(--theme--success-background)"},
  {"text":"Canceled", "value":"canceled", "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Expired",  "value":"expired",  "color":"var(--theme--danger)",     "foreground":"var(--theme--danger)",     "background":"var(--theme--danger-background)"}
]'

# ------ subscription_plans.module ------
patch_enum_field subscription_plans module '[
  {"text":"Calculators", "value":"calculators", "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"KB",          "value":"kb",          "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Flows",       "value":"flows",       "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"AI",          "value":"ai",          "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"}
]'

# ------ subscription_plans.status ------
# published (success), draft (warning), archived (neutral)
patch_enum_field subscription_plans status '[
  {"text":"Published", "value":"published", "color":"var(--theme--success)",    "foreground":"var(--theme--success)",    "background":"var(--theme--success-background)"},
  {"text":"Draft",     "value":"draft",     "color":"var(--theme--warning)",    "foreground":"var(--theme--warning)",    "background":"var(--theme--warning-background)"},
  {"text":"Archived",  "value":"archived",  "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"}
]'

# ------ subscription_plans.tier ------
# starter/growth/scale/enterprise — progression, neutral
patch_enum_field subscription_plans tier '[
  {"text":"Starter",    "value":"starter",    "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Growth",     "value":"growth",     "color":"var(--theme--primary)",    "foreground":"var(--theme--primary)",    "background":"var(--theme--primary-background)"},
  {"text":"Scale",      "value":"scale",      "color":"var(--theme--primary)",    "foreground":"var(--theme--primary)",    "background":"var(--theme--primary-background)"},
  {"text":"Enterprise", "value":"enterprise", "color":"var(--theme--primary)",    "foreground":"var(--theme--primary)",    "background":"var(--theme--primary-background)"}
]'

# ------ subscriptions.billing_cycle ------
# monthly, annual — neutral
patch_enum_field subscriptions billing_cycle '[
  {"text":"Monthly", "value":"monthly", "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Annual",  "value":"annual",  "color":"var(--theme--success)",    "foreground":"var(--theme--success)",    "background":"var(--theme--success-background)"}
]'

# ------ subscriptions.module ------
patch_enum_field subscriptions module '[
  {"text":"Calculators", "value":"calculators", "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"KB",          "value":"kb",          "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Flows",       "value":"flows",       "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"AI",          "value":"ai",          "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"}
]'

# ------ subscriptions.status ------
# trialing (warning), active (success), past_due (danger), canceled (neutral), expired (danger)
patch_enum_field subscriptions status '[
  {"text":"Trialing", "value":"trialing", "color":"var(--theme--warning)",    "foreground":"var(--theme--warning)",    "background":"var(--theme--warning-background)"},
  {"text":"Active",   "value":"active",   "color":"var(--theme--success)",    "foreground":"var(--theme--success)",    "background":"var(--theme--success-background)"},
  {"text":"Past Due", "value":"past_due", "color":"var(--theme--danger)",     "foreground":"var(--theme--danger)",     "background":"var(--theme--danger-background)"},
  {"text":"Canceled", "value":"canceled", "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Expired",  "value":"expired",  "color":"var(--theme--danger)",     "foreground":"var(--theme--danger)",     "background":"var(--theme--danger-background)"}
]'

# ------ subscriptions.tier ------
patch_enum_field subscriptions tier '[
  {"text":"Starter",    "value":"starter",    "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Growth",     "value":"growth",     "color":"var(--theme--primary)",    "foreground":"var(--theme--primary)",    "background":"var(--theme--primary-background)"},
  {"text":"Scale",      "value":"scale",      "color":"var(--theme--primary)",    "foreground":"var(--theme--primary)",    "background":"var(--theme--primary-background)"},
  {"text":"Enterprise", "value":"enterprise", "color":"var(--theme--primary)",    "foreground":"var(--theme--primary)",    "background":"var(--theme--primary-background)"}
]'

# ------ usage_events.module ------
patch_enum_field usage_events module '[
  {"text":"Calculators", "value":"calculators", "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"KB",          "value":"kb",          "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"Flows",       "value":"flows",       "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"},
  {"text":"AI",          "value":"ai",          "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"}
]'

# ------ wallet_auto_reload_pending.status ------
# pending (warning), processing (warning), succeeded (success), failed (danger), cancelled (neutral)
patch_enum_field wallet_auto_reload_pending status '[
  {"text":"Pending",    "value":"pending",    "color":"var(--theme--warning)",    "foreground":"var(--theme--warning)",    "background":"var(--theme--warning-background)"},
  {"text":"Processing", "value":"processing", "color":"var(--theme--warning)",    "foreground":"var(--theme--warning)",    "background":"var(--theme--warning-background)"},
  {"text":"Succeeded",  "value":"succeeded",  "color":"var(--theme--success)",    "foreground":"var(--theme--success)",    "background":"var(--theme--success-background)"},
  {"text":"Failed",     "value":"failed",     "color":"var(--theme--danger)",     "foreground":"var(--theme--danger)",     "background":"var(--theme--danger-background)"},
  {"text":"Cancelled",  "value":"cancelled",  "color":"var(--theme--foreground)", "foreground":"var(--theme--foreground)", "background":"var(--theme--background-normal)"}
]'

# ============================================================
# 3c — input-multiline → input downgrade (17 fields)
# These are varchar/text columns that contain single-line identifiers/names,
# misclassified as multiline by the orphan-reg heuristic (varchar > 255 threshold).
# Excluded: error_detail, last_error (may contain stack traces), platform_features.description (prose).
# None of the 17 overlap with 3b enum fields.
# ============================================================
echo "--- 3c: input-multiline → input downgrade (17) ---" | tee -a "$LOG"

BODY_INPUT='{"meta":{"interface":"input"}}'

for cf in \
  ai_wallet_failed_debits.anthropic_request_id \
  ai_wallet_failed_debits.model \
  ai_wallet_topup.stripe_charge_id \
  ai_wallet_topup.stripe_payment_intent_id \
  calculator_slots.size_class \
  stripe_webhook_events.stripe_event_id \
  subscription_addons.addon_kind \
  subscription_addons.currency \
  subscription_addons.stripe_price_id \
  subscription_addons.stripe_subscription_item_id \
  subscription_plans.name \
  subscription_plans.stripe_price_annual_id \
  subscription_plans.stripe_price_monthly_id \
  subscription_plans.stripe_product_id \
  subscriptions.stripe_customer_id \
  subscriptions.stripe_subscription_id \
  wallet_auto_reload_pending.stripe_payment_intent_id
do
  coll="${cf%%.*}"; field="${cf#*.}"
  patch_field "$coll" "$field" "$BODY_INPUT"
done

# ============================================================
# 3d — JSON fields (7) — GET-then-merge
# Already have interface: "input-code" from orphan-reg.
# We merge special: ["cast-json"] and options: {language, lineNumber, lineWrapping}.
# GET first to avoid dropping any existing options keys.
# ============================================================
echo "--- 3d: JSON fields (7) ---" | tee -a "$LOG"

DESIRED_OPTIONS='{"language":"json","lineNumber":true,"lineWrapping":true}'

for cf in \
  ai_token_usage.tool_calls \
  ai_wallet_ledger.metadata \
  api_keys.module_allowlist \
  api_keys.permissions \
  stripe_webhook_events.payload \
  subscription_plans.currency_variants \
  usage_events.metadata
do
  coll="${cf%%.*}"; field="${cf#*.}"

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY    $coll.$field" | tee -a "$LOG"
    ok=$((ok+1))
    continue
  fi

  # GET current field state
  current=$(curl -s -H "Authorization: Bearer $TOKEN" "$CMS_URL/fields/$coll/$field")
  current_options=$(printf '%s' "$current" | jq '.data.meta.options // {}')
  current_special=$(printf '%s' "$current" | jq '.data.meta.special // []')

  # Merge desired options (preserves any existing keys, adds/overwrites desired ones)
  new_options=$(printf '%s' "$current_options" | jq -c --argjson desired "$DESIRED_OPTIONS" '. + $desired')

  # Merge cast-json into special array (deduplicate)
  new_special=$(printf '%s' "$current_special" | jq -c '. + ["cast-json"] | unique')

  # Check if already matches (idempotency skip — avoids a no-op write but not strictly required)
  already_has_special="no"
  printf '%s' "$current_special" | jq -e 'index("cast-json") != null' >/dev/null 2>&1 && already_has_special="yes"
  already_has_opts="no"
  printf '%s' "$current_options" | jq -e \
    '.language == "json" and .lineNumber == true and .lineWrapping == true' >/dev/null 2>&1 && already_has_opts="yes"

  if [[ "$already_has_special" == "yes" && "$already_has_opts" == "yes" ]]; then
    echo "SKIP   $coll.$field (already has cast-json + desired options)" | tee -a "$LOG"
    skipped=$((skipped+1))
    continue
  fi

  body=$(jq -nc --argjson opts "$new_options" --argjson spec "$new_special" '{
    meta: {options: $opts, special: $spec}
  }')
  patch_field "$coll" "$field" "$body"
done

# ============================================================
# Cache clear
# ============================================================
if [[ "$DRY_RUN" != "1" ]]; then
  directus_cache_clear "$TOKEN" | tee -a "$LOG"
fi

echo "--- summary: ok=$ok skipped=$skipped fail=$fail ---" | tee -a "$LOG"
