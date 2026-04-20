# DB Structure Cleanup — Post-Orphan-Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three consultations left open by the `register-orphan-fields` /db-admin task: add 21 missing m2o relations, remove two composite-PK aggregate collections from `directus_collections`, and grant account-scoped self-service READ permissions to 4 collections — producing a uniformly-structured Directus schema before production launch.

**Architecture:** Three self-contained change sets applied in order against the running local CMS, each with its own pre-change verification query and post-change assertion. Changes are either HTTP PATCH/POST against the Directus API, direct SQL INSERT/DELETE into system tables, or nothing (no DDL, no app code). Snapshot bracketing around the full run (one pre, one post) gives a single atomic rollback point. No service restarts required; Directus cache clear at the end.

**Tech Stack:** Directus 11.16.1, Postgres 16, bash/curl/jq, psql, python3 for JSON shaping. Local CMS at `http://localhost:18055`. Local PG at `localhost:15432` (db `directus`).

**Context:** Pre-production, zero customers. The pre-snapshot from the orphan-registration task (`infrastructure/db-snapshots/pre_register-orphan-fields_20260420_144607.sql.gz`, `services/cms/snapshots/pre_register-orphan-fields_20260420_144622.yaml`) is intentionally **still** the authoritative "before" state — a fresh pre-snapshot for this plan is mandatory so the two phases stay independently rollback-able.

**Decisions locked in** (per user priorities: best structure, lean, no data loss):
- **Consultation #1 (relations):** APPROVE — add all 21 m2o relations.
- **Consultation #2 (composite-PK):** APPROVE Option B — delete from `directus_collections`. Option A (surrogate `id`) was rejected because 5 migration files + 1 e2e test depend on `ON CONFLICT (account_id, period_yyyymm)` / `(api_key_id, period_yyyymm)` upserts; demoting composite PK to UNIQUE touches live aggregator SQL in 30/31/33.sql and breaks the hot path. These tables are pure backend rollups populated by `usage-consumer` cron — they do not need Directus UI presence.
- **Consultation #3 (permissions):** APPROVE all 4 — account-scoped READ via `$CURRENT_USER.account` filter.

**Tables being acted upon:**

| Action | Collections |
|---|---|
| Add m2o relation | `account_features` (×2), `ai_wallet`, `ai_wallet_failed_debits`, `ai_wallet_ledger` (×3), `ai_wallet_topup` (×2), `api_keys`, `calculator_slots` (×2), `feature_quotas` (×2), `subscription_addons` (×2), `subscriptions` (×2), `usage_events`, `wallet_auto_reload_pending` |
| Remove from `directus_collections` | `monthly_aggregates`, `api_key_usage` |
| Grant User-policy READ | `account_features`, `ai_token_usage`, `api_keys`, `platform_features` |

---

## File Structure

| File | Responsibility | Create/Modify |
|---|---|---|
| `scripts/db-structure-cleanup.sh` | Orchestrator: auth → task 2–4 → verify → cache-clear | Create |
| `scripts/add-missing-relations.sh` | Phase 1: build relation manifest, POST `/relations` for each, PATCH child field meta | Create |
| `scripts/remove-composite-pk-collections.sh` | Phase 2: DELETE from `directus_collections` + ghost `directus_fields` rows for 2 collections | Create |
| `scripts/add-user-read-permissions.sh` | Phase 3: POST `/permissions` for 4 collections with account-isolation filters | Create |
| `docs/reports/db-admin-structure-cleanup-2026-04-20.md` | Final consolidated report | Create |
| `docs/reports/db-admin-WIP-register-orphan-fields.md` | Close out with "resolved" status once all three phases verified | Modify |
| `services/cms/snapshots/pre_structure-cleanup_<ts>.yaml` | Pre-change YAML snapshot | Auto-generated |
| `infrastructure/db-snapshots/pre_structure-cleanup_<ts>.sql.gz` | Pre-change PG dump | Auto-generated |
| `services/cms/snapshots/post_structure-cleanup_<ts>.yaml` | Post-change YAML snapshot | Auto-generated |
| `infrastructure/db-snapshots/post_structure-cleanup_<ts>.sql.gz` | Post-change PG dump | Auto-generated |

No service code changes. No DDL migrations. All changes are Directus metadata (`directus_relations`, `directus_collections`, `directus_fields`, `directus_permissions`).

---

## Preflight — shared setup used by every script

All three phase scripts share the same auth + env block. Extract into `scripts/_directus-common.sh` so no duplication.

- [ ] **Step P.1: Create shared auth helper**

**Files:** Create `scripts/_directus-common.sh`

```bash
#!/usr/bin/env bash
# Shared helpers for db-admin scripts that talk to the local Directus API + PG.
# Sourced, not executed.

export CMS_URL="${CMS_URL:-http://localhost:18055}"
export PG_HOST="${PG_HOST:-localhost}"
export PG_PORT="${PG_PORT:-15432}"
export PG_DB="${PG_DB:-directus}"
export PG_USER="${PG_USER:-directus}"
export PG_PASS="${PG_PASS:-directus}"

if [[ -z "${ADMIN_EMAIL:-}" || -z "${ADMIN_PASSWORD:-}" ]]; then
  ENV_FILE="${ENV_FILE:-infrastructure/docker/.env}"
  if [[ -f "$ENV_FILE" ]]; then
    ADMIN_EMAIL="${ADMIN_EMAIL:-$(grep -E '^ADMIN_EMAIL=' "$ENV_FILE" | cut -d= -f2-)}"
    ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(grep -E '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)}"
  fi
fi

directus_auth() {
  local resp
  resp="$(curl -s -X POST "$CMS_URL/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")"
  local token
  token="$(printf '%s' "$resp" | jq -r '.data.access_token // empty')"
  if [[ -z "$token" ]]; then
    echo "AUTH FAILED: $resp" >&2
    return 1
  fi
  printf '%s' "$token"
}

psql_cmd() {
  PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" "$@"
}

directus_cache_clear() {
  local token="$1"
  curl -s -o /dev/null -w 'cache-clear: HTTP %{http_code}\n' \
    -X POST -H "Authorization: Bearer $token" "$CMS_URL/utils/cache/clear"
}
```

- [ ] **Step P.2: Verify helper works**

Run:
```bash
chmod +x scripts/_directus-common.sh
bash -c 'source scripts/_directus-common.sh && directus_auth | head -c 30 && echo "..."'
```

Expected: first ~30 chars of a JWT token printed, followed by `...`. Any other output = fail; fix env/creds before proceeding.

- [ ] **Step P.3: Commit shared helper**

```bash
git add scripts/_directus-common.sh
git commit -m "chore(scripts): extract directus auth helper for db-admin scripts"
```

---

## Preflight — pre-change snapshot

- [ ] **Step P.4: Take pre-change snapshots**

Run:
```bash
cd /Users/kropsi/Documents/Claude/businesslogic
make snapshot-pre SLUG=structure-cleanup
cd services/cms && make snapshot-pre SLUG=structure-cleanup
cd ../..
```

Expected output:
```
✓ Pre-task PG dump: infrastructure/db-snapshots/pre_structure-cleanup_<ts>.sql.gz
...
Saved: snapshots/pre_structure-cleanup_<ts>.yaml
```

Both files must exist before any Directus writes happen.

- [ ] **Step P.5: Record baseline counts**

Run:
```bash
psql_baseline() { PGPASSWORD=directus psql -h localhost -p 15432 -U directus -d directus -t -A -c "$1"; }
echo "directus_relations: $(psql_baseline 'SELECT COUNT(*) FROM directus_relations;')"
echo "directus_permissions: $(psql_baseline 'SELECT COUNT(*) FROM directus_permissions;')"
echo "directus_collections: $(psql_baseline 'SELECT COUNT(*) FROM directus_collections;')"
echo "directus_fields: $(psql_baseline 'SELECT COUNT(*) FROM directus_fields;')"
```

**Write the numbers into `docs/reports/db-admin-structure-cleanup-2026-04-20.md` — they are the "before" anchor for the final diff.** Do NOT skip this — the report section §3 needs exact deltas.

---

## Task 1: Phase 1 — Add 21 m2o relations

**Files:**
- Create: `scripts/add-missing-relations.sh`
- Reference: `docs/reports/db-admin-register-orphan-fields-2026-04-20.md` §4c for the canonical 21-row table

### 1.1 Understand how Directus stores m2o relations

`directus_relations` has one row per m2o (the child side). The `meta` column drives UI behavior; the `schema` block is informational (PG already has the FK). Minimal fields we set:

| Column | Value for `account_features.account` → `account.id` (example) |
|---|---|
| `many_collection` | `account_features` |
| `many_field` | `account` |
| `one_collection` | `account` |
| `one_field` | NULL (no reverse o2m registered unless we want it) |
| `sort_field` | NULL |
| `one_deselect_action` | `nullify` |

Directus API: `POST /relations` with body:
```json
{
  "collection": "account_features",
  "field": "account",
  "related_collection": "account",
  "meta": {"sort_field": null, "one_deselect_action": "nullify"},
  "schema": {"on_delete": "CASCADE"}
}
```

On success it returns 200 with the new row. On duplicate it returns 400 "relation already exists".

After the relation is created we also PATCH the child field's `directus_fields.meta` to set `special: ['m2o']` and `interface: 'select-dropdown-m2o'`, which is what gives the Admin UI the dropdown picker.

### 1.2 Tasks

- [ ] **Step 1.1: Write the assertion (baseline test)**

**Files:** Create `scripts/add-missing-relations.sh`

Start the script with a read-only assertion that prints the current relation count + the 21 expected new pairs. No writes yet.

```bash
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
```

Count is 20 data lines above (including header). Manifest should be **20 lines** — the original §4c table listed 22 FKs minus 1 (`ai_token_usage.account` already m2o) minus 1 (either composite-PK collection's relation, since those collections are getting deleted — we'll exclude `monthly_aggregates.account_id`). Adjust: drop `monthly_aggregates` (line will be removed as part of Task 2) and drop the `api_key_usage` relations that don't exist (none listed). Final: **20 relations**. (Plan reconciles: earlier text said "21" from the audit; post-decision removes `monthly_aggregates.account_id` → 20.)

- [ ] **Step 1.2: Run the assertion to verify baseline**

```bash
chmod +x scripts/add-missing-relations.sh
bash scripts/add-missing-relations.sh
```

Expected:
- `manifest: 20 m2o relations expected to be added`
- `current directus_relations rows: N` (some number — this is our baseline)
- zero or very few `SKIP` lines (expected: `ai_token_usage.account` is not in the manifest, so no overlap)

- [ ] **Step 1.3: Extend the script — write the POST + PATCH loop**

Append to `scripts/add-missing-relations.sh`:

```bash
TOKEN="$(directus_auth)"
LOG="docs/reports/db-admin-add-relations.log"
mkdir -p "$(dirname "$LOG")"
echo "# add-missing-relations @ $(date -u +%FT%TZ)" | tee -a "$LOG"

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

  # Build body
  body=$(jq -nc \
    --arg c "$mcol" --arg f "$mfield" --arg r "$ocol" --arg od "$ondelete" \
    '{collection:$c, field:$f, related_collection:$r,
      meta:{sort_field:null, one_deselect_action:"nullify"},
      schema:{on_delete:$od}}')

  http_body="$(mktemp)"
  code="$(curl -s -o "$http_body" -w '%{http_code}' \
    -X POST "$CMS_URL/relations" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' \
    -d "$body")"

  if [[ "$code" == "200" || "$code" == "204" ]]; then
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
      echo "FAIL   $mcol.$mfield [patch $pcode]" | tee -a "$LOG"
      exit 1
    fi
  else
    fail=$((fail+1))
    msg="$(jq -r '.errors[0].message // empty' "$http_body" 2>/dev/null | head -c 300)"
    echo "FAIL   $mcol.$mfield [$code] ${msg:-$(head -c 300 "$http_body")}" | tee -a "$LOG"
    rm -f "$http_body"
    exit 1
  fi
  rm -f "$http_body"
done <<< "$MANIFEST"

echo "--- phase-1 summary: ok=$ok skipped=$skipped fail=$fail ---" | tee -a "$LOG"
```

- [ ] **Step 1.4: Run Phase 1 for real**

```bash
bash scripts/add-missing-relations.sh
```

Expected:
- 20 `OK` lines (one per relation)
- 0 `FAIL`
- Summary: `ok=20 skipped=0 fail=0` (or higher `skipped` if re-run)

- [ ] **Step 1.5: Assertion — verify API-visible relations**

```bash
TOKEN=$(curl -s -X POST http://localhost:18055/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"admin123"}' | jq -r '.data.access_token')
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:18055/items/subscriptions?limit=1&fields=id,account_id.id,account_id.name,subscription_plan_id.id,subscription_plan_id.name" | jq '.data[0]'
```

Expected: the response shows `account_id: {id: "...", name: "..."}` as an object, not a raw UUID string. If it's still a string, the relation wasn't created or the cache isn't refreshed.

- [ ] **Step 1.6: Commit Phase 1**

```bash
git add scripts/add-missing-relations.sh docs/reports/db-admin-add-relations.log
git commit -m "feat(cms): add 20 missing m2o relations to directus_relations"
```

---

## Task 2: Phase 2 — Remove composite-PK collections from Directus

**Files:**
- Create: `scripts/remove-composite-pk-collections.sh`
- Affected: `monthly_aggregates`, `api_key_usage` — rows in `directus_collections` + ghost rows in `directus_fields`

### 2.1 Understand the delete path

Directus has `DELETE /collections/:collection`, but calling it also **drops the Postgres table**. That would be catastrophic — the aggregator uses these tables. Solution: direct SQL DELETE from `directus_collections` only, leaving PG tables alone. No Directus API call.

Also need to remove 33 ghost `directus_fields` rows (19 for `monthly_aggregates` + 14 for `api_key_usage`) since they reference collections that no longer appear in `directus_collections`.

No permission rows exist for these collections (verified in review), so no cleanup needed there. No `directus_relations` rows either (neither was in Phase 1's manifest after filtering).

### 2.2 Tasks

- [ ] **Step 2.1: Write the assertion (verify only 2 collections are targeted)**

**Files:** Create `scripts/remove-composite-pk-collections.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_directus-common.sh"

TARGETS=(monthly_aggregates api_key_usage)

echo "--- preflight: target collections in directus_collections ---"
for c in "${TARGETS[@]}"; do
  n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_collections WHERE collection='$c';")
  echo "  $c: $n row(s)"
done

echo ""
echo "--- preflight: ghost directus_fields rows ---"
for c in "${TARGETS[@]}"; do
  n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_fields WHERE collection='$c';")
  echo "  $c: $n field row(s)"
done

echo ""
echo "--- preflight: verify PG tables EXIST (must NOT be dropped) ---"
for c in "${TARGETS[@]}"; do
  n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM pg_class WHERE relname='$c' AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public');")
  if [[ "$n" != "1" ]]; then
    echo "  $c: pg table MISSING — ABORT (expected relkind='r' in public schema)" >&2
    exit 1
  fi
  rows=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM public.$c;")
  echo "  $c: pg table present with $rows row(s)"
done

echo ""
echo "--- preflight: verify no directus_relations reference these collections ---"
for c in "${TARGETS[@]}"; do
  n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_relations WHERE many_collection='$c' OR one_collection='$c';")
  [[ "$n" == "0" ]] || { echo "  $c: $n relation(s) reference this — must remove first"; exit 1; }
  echo "  $c: 0 referencing relations ✓"
done
```

- [ ] **Step 2.2: Run the assertion**

```bash
chmod +x scripts/remove-composite-pk-collections.sh
bash scripts/remove-composite-pk-collections.sh
```

Expected:
```
  monthly_aggregates: 1 row(s)
  api_key_usage: 1 row(s)

  monthly_aggregates: 19 field row(s)
  api_key_usage: 14 field row(s)

  monthly_aggregates: pg table present with <N> row(s)
  api_key_usage: pg table present with <N> row(s)

  monthly_aggregates: 0 referencing relations ✓
  api_key_usage: 0 referencing relations ✓
```

Any deviation = STOP and investigate. This is a safety gate.

- [ ] **Step 2.3: Extend script — write the DELETEs in a transaction**

Append to `scripts/remove-composite-pk-collections.sh`:

```bash
LOG="docs/reports/db-admin-remove-composite-pk.log"
mkdir -p "$(dirname "$LOG")"
echo "# remove-composite-pk-collections @ $(date -u +%FT%TZ)" | tee -a "$LOG"

psql_cmd -v ON_ERROR_STOP=1 <<'SQL' 2>&1 | tee -a "$LOG"
BEGIN;

-- Remove ghost field metadata rows
DELETE FROM directus_fields WHERE collection IN ('monthly_aggregates', 'api_key_usage');

-- Remove from directus_collections (Directus stops trying to load them)
DELETE FROM directus_collections WHERE collection IN ('monthly_aggregates', 'api_key_usage');

-- Double-check no orphaned permissions/presets/policies mentioning these
-- (there shouldn't be any, but defensive)
DELETE FROM directus_permissions WHERE collection IN ('monthly_aggregates', 'api_key_usage');

COMMIT;

-- Assertions after commit
SELECT 'directus_collections remaining: ' ||
       COUNT(*) FILTER (WHERE collection = 'monthly_aggregates') ||
       ' monthly_aggregates, ' ||
       COUNT(*) FILTER (WHERE collection = 'api_key_usage') ||
       ' api_key_usage'
FROM directus_collections;

SELECT 'directus_fields remaining: ' ||
       COUNT(*) FILTER (WHERE collection = 'monthly_aggregates') ||
       ' monthly_aggregates, ' ||
       COUNT(*) FILTER (WHERE collection = 'api_key_usage') ||
       ' api_key_usage'
FROM directus_fields;

SELECT 'pg_class ' || relname || ' still present' FROM pg_class
WHERE relname IN ('monthly_aggregates', 'api_key_usage')
  AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND relkind = 'r';
SQL

# Clear Directus cache so the running service stops serving stale collection list
TOKEN="$(directus_auth)"
directus_cache_clear "$TOKEN" | tee -a "$LOG"

echo "--- phase-2 done ---" | tee -a "$LOG"
```

- [ ] **Step 2.4: Run Phase 2**

```bash
bash scripts/remove-composite-pk-collections.sh
```

Expected output tail:
```
DELETE 33   (19+14 field rows)
DELETE 2    (2 collection rows)
DELETE 0    (0 permission rows — no non-admin perms existed)
COMMIT
directus_collections remaining: 0 monthly_aggregates, 0 api_key_usage
directus_fields remaining: 0 monthly_aggregates, 0 api_key_usage
pg_class monthly_aggregates still present
pg_class api_key_usage still present
cache-clear: HTTP 200
```

- [ ] **Step 2.5: Assertion — aggregator still writes correctly**

```bash
# Trigger the aggregator manually to confirm ON CONFLICT still works
TOKEN=$(curl -s -X POST http://localhost:18055/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"admin123"}' | jq -r '.data.access_token')
curl -s -X POST -H "Authorization: Bearer $TOKEN" "http://localhost:18055/server/ping" >/dev/null

# Directly call the aggregate function with a narrow period
psql_cmd -c "SELECT * FROM public.aggregate_usage_events(202604) LIMIT 1;" 2>&1 | head -5
```

Expected: function returns rows (or empty result if no events this period), but **does not error**. If `ERROR: relation "monthly_aggregates" does not exist` — the PG table was accidentally dropped. Restore from pre-snapshot.

- [ ] **Step 2.6: Assertion — Admin UI no longer lists these collections**

```bash
TOKEN=$(curl -s -X POST http://localhost:18055/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"admin123"}' | jq -r '.data.access_token')
for c in monthly_aggregates api_key_usage; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "http://localhost:18055/collections/$c")
  echo "  GET /collections/$c: $code (expected 403 or 404)"
done
```

Expected: `403` or `404` for both. If `200`, cache wasn't cleared.

- [ ] **Step 2.7: Commit Phase 2**

```bash
git add scripts/remove-composite-pk-collections.sh docs/reports/db-admin-remove-composite-pk.log
git commit -m "feat(cms): remove composite-PK monthly_aggregates/api_key_usage from directus_collections"
```

---

## Task 3: Phase 3 — Add User-policy READ permissions for 4 collections

**Files:**
- Create: `scripts/add-user-read-permissions.sh`
- Affected: `directus_permissions` (add 4 rows)

### 3.1 Understand the permissions model

Directus 11 permissions live on **policies**, not roles. Roles → policies via `directus_access`. The "User Access" policy ID was identified during review:

```sql
SELECT id FROM directus_policies WHERE name='User Access';
-- 54f17d5e-e565-47d0-9372-b3b48db16109
```

Each permission row has:
- `policy` — the policy UUID
- `collection` — which table this grants access to
- `action` — `read`, `create`, `update`, `delete`, or `share`
- `permissions` — JSON filter: e.g. `{"account": {"_eq": "$CURRENT_USER.account"}}` scopes rows to the current user's account
- `fields` — comma-separated allowed field list, or `*` for all, or `["a","b","c"]` subset

Use `POST /permissions` (Directus API — idempotency: returns 400 if duplicate policy+collection+action exists).

### 3.2 Tasks

- [ ] **Step 3.1: Write the 4-row manifest inline + assertion**

**Files:** Create `scripts/add-user-read-permissions.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_directus-common.sh"

USER_POLICY_ID=$(psql_cmd -t -A -c "SELECT id FROM directus_policies WHERE name='User Access' LIMIT 1;")
if [[ -z "$USER_POLICY_ID" ]]; then
  echo "FAIL: no 'User Access' policy found" >&2
  exit 1
fi
echo "User Access policy: $USER_POLICY_ID"

# Manifest: collection, permissions-json, fields
# - account_features: account-scoped
# - ai_token_usage: account-scoped (field is literally 'account')
# - api_keys: account-scoped, excludes key_hash + encrypted_key + key_prefix
# - platform_features: global catalog, filter active=true, restricted fields
declare -a ROWS=(
  "account_features|{\"account\":{\"_eq\":\"\$CURRENT_USER.account\"}}|*"
  "ai_token_usage|{\"account\":{\"_eq\":\"\$CURRENT_USER.account\"}}|*"
  "api_keys|{\"account_id\":{\"_eq\":\"\$CURRENT_USER.account\"}}|id,account_id,name,last_used_at,created_at,revoked_at,ai_spend_cap_monthly_eur,kb_search_cap_monthly,module_allowlist"
  "platform_features|{\"active\":{\"_eq\":true}}|id,code,name,description,active"
)

echo "--- preflight ---"
for row in "${ROWS[@]}"; do
  IFS='|' read -r coll perm fields <<< "$row"
  existing=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM directus_permissions WHERE policy='$USER_POLICY_ID' AND collection='$coll' AND action='read';")
  echo "  $coll: existing read perms on User Access policy = $existing"
done
```

- [ ] **Step 3.2: Run the assertion**

```bash
chmod +x scripts/add-user-read-permissions.sh
bash scripts/add-user-read-permissions.sh
```

Expected: all 4 collections show `existing read perms on User Access policy = 0`. If any is `1`, the manifest already applies; re-running will 400, safe to skip.

- [ ] **Step 3.3: Verify `$CURRENT_USER.account` works in this Directus**

Before POSTing, sanity-check that the filter variable is supported by this version. Query the docs:

Run: `curl -s 'https://directus.io/docs/guides/auth/access-control' >/dev/null` (heartbeat). Reference: Directus docs confirm `$CURRENT_USER.<field>` dynamic filters (11.x).

Also check we have a non-admin test user whose `account` is populated:

```bash
psql_cmd -c "
SELECT du.id, du.email, du.role, (SELECT name FROM directus_roles WHERE id=du.role) AS role_name,
       (SELECT account FROM account_directus_users WHERE directus_users_id=du.id LIMIT 1) AS account
FROM directus_users du
WHERE du.role != '3fae9d27-9cc7-4f54-a74c-5c396b844be1'
LIMIT 3;"
```

Expected: at least one non-admin user with a non-null `account` column. If none → create one for the verification step (Step 3.6) or skip that step and rely on API-level filter assertion.

- [ ] **Step 3.4: Extend script — write the POST loop**

Append to `scripts/add-user-read-permissions.sh`:

```bash
TOKEN="$(directus_auth)"
LOG="docs/reports/db-admin-add-user-perms.log"
mkdir -p "$(dirname "$LOG")"
echo "# add-user-read-permissions @ $(date -u +%FT%TZ)" | tee -a "$LOG"

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
```

- [ ] **Step 3.5: Run Phase 3**

```bash
bash scripts/add-user-read-permissions.sh
```

Expected: `ok=4 skipped=0 fail=0`.

- [ ] **Step 3.6: Assertion — account isolation works**

Pick a non-admin test user (from Step 3.3 query output — substitute their email). Log in as them, request `/items/api_keys`, assert only their-account rows return.

```bash
# Replace <user-email> + <password> with a real non-admin test user
NA_EMAIL="<user-email>"
NA_PASS="<password>"
NA_TOKEN=$(curl -s -X POST http://localhost:18055/auth/login -H 'content-type: application/json' -d "{\"email\":\"$NA_EMAIL\",\"password\":\"$NA_PASS\"}" | jq -r '.data.access_token')

echo "=== /items/account_features (expect only their account) ==="
curl -s -H "Authorization: Bearer $NA_TOKEN" "http://localhost:18055/items/account_features?limit=10" | jq '.data | length'

echo "=== /items/api_keys (expect key_hash field MISSING) ==="
curl -s -H "Authorization: Bearer $NA_TOKEN" "http://localhost:18055/items/api_keys?limit=1" | jq '.data[0] | keys'

echo "=== /items/platform_features (expect all active=true rows) ==="
curl -s -H "Authorization: Bearer $NA_TOKEN" "http://localhost:18055/items/platform_features?limit=50" | jq '.data | length'
```

Expected:
- `account_features`: non-zero only if that account has rows; MUST NOT return other accounts' rows (verify by cross-referencing `account_id` in response with the test user's account UUID).
- `api_keys`: response keys list DOES NOT include `key_hash`, `encrypted_key`, `key_prefix`.
- `platform_features`: count equals `SELECT COUNT(*) FROM platform_features WHERE active=true`.

If no non-admin test user exists, substitute: login as admin, add `?filter[policy][_eq]=$USER_POLICY_ID` to `/permissions` and confirm the 4 rows exist with the correct `permissions` JSON.

- [ ] **Step 3.7: Commit Phase 3**

```bash
git add scripts/add-user-read-permissions.sh docs/reports/db-admin-add-user-perms.log
git commit -m "feat(cms): add account-scoped User read permissions for 4 collections"
```

---

## Task 4: Orchestrator + final verification + post-snapshot + report

**Files:**
- Create: `scripts/db-structure-cleanup.sh` (thin wrapper)
- Modify: `docs/reports/db-admin-WIP-register-orphan-fields.md` (close out)
- Create: `docs/reports/db-admin-structure-cleanup-2026-04-20.md`

- [ ] **Step 4.1: Write the orchestrator**

**Files:** Create `scripts/db-structure-cleanup.sh`

```bash
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
```

- [ ] **Step 4.2: Take post-change snapshots**

```bash
cd /Users/kropsi/Documents/Claude/businesslogic
make snapshot-post SLUG=structure-cleanup
cd services/cms && make snapshot-post SLUG=structure-cleanup
cd ../..
```

Expected: two new files, `post_structure-cleanup_<ts>.sql.gz` and `post_structure-cleanup_<ts>.yaml`.

- [ ] **Step 4.3: Run the canonical sanity query suite**

```bash
psql_q() { PGPASSWORD=directus psql -h localhost -p 15432 -U directus -d directus -t -A -c "$1"; }

echo "--- counts: expect directus_relations +20, directus_collections -2, directus_fields -33, directus_permissions +4 ---"
echo "directus_relations:   $(psql_q 'SELECT COUNT(*) FROM directus_relations;')"
echo "directus_collections: $(psql_q 'SELECT COUNT(*) FROM directus_collections;')"
echo "directus_fields:      $(psql_q 'SELECT COUNT(*) FROM directus_fields;')"
echo "directus_permissions: $(psql_q 'SELECT COUNT(*) FROM directus_permissions;')"

echo ""
echo "--- monthly_aggregates / api_key_usage must NOT appear ---"
psql_q "SELECT collection FROM directus_collections WHERE collection IN ('monthly_aggregates','api_key_usage');"
psql_q "SELECT collection, field FROM directus_fields WHERE collection IN ('monthly_aggregates','api_key_usage');"

echo ""
echo "--- PG tables must still exist ---"
psql_q "SELECT relname FROM pg_class WHERE relname IN ('monthly_aggregates','api_key_usage') AND relkind='r';"

echo ""
echo "--- 20 new relations visible ---"
psql_q "SELECT many_collection || '.' || many_field || ' -> ' || one_collection
        FROM directus_relations
        WHERE many_collection IN
          ('account_features','ai_wallet','ai_wallet_failed_debits','ai_wallet_ledger',
           'ai_wallet_topup','api_keys','calculator_slots','feature_quotas',
           'subscription_addons','subscriptions','usage_events','wallet_auto_reload_pending')
        ORDER BY many_collection, many_field;"

echo ""
echo "--- 4 new user-scoped perms visible ---"
psql_q "SELECT collection, action, permissions
        FROM directus_permissions
        WHERE collection IN ('account_features','ai_token_usage','api_keys','platform_features')
          AND action='read';"
```

Use the baseline numbers from Step P.5 as the reference. Deltas must match the assertion comments.

- [ ] **Step 4.4: Verify aggregator still works end-to-end**

```bash
# Insert a bogus usage event, run aggregator, verify monthly_aggregates upsert
psql_q "INSERT INTO public.usage_events (account_id, event_kind, module, quantity, cost_eur, occurred_at)
         SELECT id, 'calc_call', 'formula', 1, 0.01, now() FROM public.account LIMIT 1;"
psql_q "SELECT * FROM public.aggregate_usage_events(202604);"
# confirm a row exists in monthly_aggregates for that account/period
psql_q "SELECT account_id, period_yyyymm, calc_calls FROM public.monthly_aggregates WHERE period_yyyymm=202604 LIMIT 3;"
```

Expected: at least 1 row returned. If aggregator errors with "relation does not exist" or "ON CONFLICT" failure → **rollback immediately** (Step 4.8) and investigate.

- [ ] **Step 4.5: Run Directus health check**

```bash
curl -s -w "CMS health: %{http_code}\n" -o /dev/null http://localhost:18055/server/health
make cms-logs 2>&1 | tail -20 | grep -iE 'error|exception' | grep -v 'punycode\|DeprecationWarning\|MaxListener' || echo "no new errors"
```

Expected: `200` and `no new errors`.

- [ ] **Step 4.6: Close out the orphan-registration WIP file**

**Files:** Modify `docs/reports/db-admin-WIP-register-orphan-fields.md`

Change the header:
```
**Phase:** done
**Severity:** INFO (all follow-ups resolved via structure-cleanup plan)
```

Append a closing note:
```
## Closing Note (2026-04-20 <ts>)

All three consultations resolved by the db-structure-cleanup plan:
1. 20 m2o relations added — see `docs/reports/db-admin-add-relations.log`
2. `monthly_aggregates` + `api_key_usage` removed from `directus_collections` — see `docs/reports/db-admin-remove-composite-pk.log`
3. 4 User-policy READ permissions added — see `docs/reports/db-admin-add-user-perms.log`

Final consolidated report: `docs/reports/db-admin-structure-cleanup-2026-04-20.md`
```

- [ ] **Step 4.7: Write the final consolidated report**

**Files:** Create `docs/reports/db-admin-structure-cleanup-2026-04-20.md`

Use this structure — every placeholder `<...>` MUST be filled with the actual value from your verification runs:

```markdown
# DB Admin Report — Structure Cleanup

**Date:** 2026-04-20
**Slug:** structure-cleanup
**Severity:** INFO
**Classification:** MINOR (Directus metadata only; no DDL; reversible)

## Summary

Three follow-ups from the orphan-registration task (register-orphan-fields-2026-04-20) applied:

| Phase | Change | Result |
|---|---|---|
| 1 | Add 20 m2o relations | <ok count> succeeded, <skip count> skipped |
| 2 | Remove `monthly_aggregates` + `api_key_usage` from `directus_collections` | 2 collection rows deleted, 33 ghost field rows deleted |
| 3 | Add 4 account-scoped User-policy READ permissions | 4 succeeded |

## Snapshot bracket

- pre PG dump: `infrastructure/db-snapshots/pre_structure-cleanup_<ts>.sql.gz`
- pre YAML:    `services/cms/snapshots/pre_structure-cleanup_<ts>.yaml`
- post PG dump: `infrastructure/db-snapshots/post_structure-cleanup_<ts>.sql.gz`
- post YAML:    `services/cms/snapshots/post_structure-cleanup_<ts>.yaml`

## Delta counts (baseline → final)

| Table | Before | After | Δ |
|---|---:|---:|---:|
| directus_relations | <baseline> | <final> | +20 |
| directus_collections | <baseline> | <final> | -2 |
| directus_fields | <baseline> | <final> | -33 |
| directus_permissions | <baseline> | <final> | +4 |

## Verification evidence

- Aggregator test: `SELECT * FROM aggregate_usage_events(202604)` — <N> rows, no error ✓
- CMS health: HTTP 200 ✓
- CMS logs: no new errors ✓
- `/collections/monthly_aggregates` and `/collections/api_key_usage` return <403/404> ✓
- Non-admin test (`<user email>`): /items/api_keys response fields list does NOT include key_hash/encrypted_key/key_prefix ✓

## Rollback

```bash
# Restore the full DB to pre-structure-cleanup state:
gunzip -c infrastructure/db-snapshots/pre_structure-cleanup_<ts>.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

Snapshots are retained under the standard KEEP_TASK=20 policy — do not auto-prune.

## Known non-issues

- `monthly_aggregates` and `api_key_usage` are now invisible to Directus admin UI. This is intentional — they are pure backend rollup tables populated by usage-consumer cron. Schema is tracked via `migrations/cms/010_*.sql` and `014_*.sql`, not via Directus snapshot.
- The composite-PK tables are excluded from `directus schema snapshot` YAML output. This is Directus 11 behavior, not a bug.
```

- [ ] **Step 4.8: Rollback contingency**

If any verification in Step 4.3 / 4.4 / 4.5 / 4.6 fails with an unfixable issue:

```bash
# Stop immediately — do NOT commit
# Restore from pre-structure-cleanup PG dump (Step P.4)
gunzip -c infrastructure/db-snapshots/pre_structure-cleanup_<ts>.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus

# Clear Directus cache
TOKEN=$(curl -s -X POST http://localhost:18055/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"admin123"}' | jq -r '.data.access_token')
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://localhost:18055/utils/cache/clear

# Investigate from logs before retrying
```

- [ ] **Step 4.9: Final commit**

```bash
git add scripts/db-structure-cleanup.sh \
        docs/reports/db-admin-structure-cleanup-2026-04-20.md \
        docs/reports/db-admin-WIP-register-orphan-fields.md
git commit -m "feat(cms): close orphan-registration follow-ups (relations, composite-pk cleanup, user perms)"
```

---

## Acceptance criteria

- [ ] `directus_relations` has +20 rows vs P.5 baseline; every row from the Task 1 manifest is present.
- [ ] `directus_collections` has `monthly_aggregates` and `api_key_usage` **absent**.
- [ ] `directus_fields` has 0 rows for either removed collection.
- [ ] `public.monthly_aggregates` and `public.api_key_usage` PG tables **still exist with their original row counts**.
- [ ] `aggregate_usage_events(<yyyymm>)` runs successfully and produces rows in `monthly_aggregates` (proves `ON CONFLICT (account_id, period_yyyymm)` upsert still works).
- [ ] `directus_permissions` has 4 new `read` rows on the User Access policy, each with a non-null `permissions` filter referencing `$CURRENT_USER.account` (or `active: true` for `platform_features`).
- [ ] Non-admin test user can read `/items/api_keys` and **cannot see `key_hash`, `encrypted_key`, `key_prefix` in response**.
- [ ] CMS `/server/health` returns 200 and logs show no new errors.
- [ ] Final report `docs/reports/db-admin-structure-cleanup-2026-04-20.md` exists with all placeholders filled.
- [ ] WIP file for `register-orphan-fields` is closed out with Phase: `done`.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Aggregator upsert breaks after Phase 2 | Step 4.4 explicitly exercises the aggregator. If it fails → rollback via Step 4.8 and reinvestigate Option A (surrogate PK). |
| Filter variable `$CURRENT_USER.account` not supported in this Directus version | Step 3.3 sanity-checks; fallback is to hardcode account UUID per user at request time (breaks multi-user) or skip Phase 3 pending Directus upgrade. |
| Cross-account leak via new m2o relation (Consultation #1's stated risk) | Every new m2o points to a collection the User policy already has read permission on (`account`, `directus_users`, etc.). No new visibility granted. Verify via Step 1.5 with a non-admin user. |
| `platform_features.active` column does not exist | Check before Phase 3: `\d platform_features` in psql. If missing, update the manifest filter to `{}` or add a CHECK constraint task first. |

---

## Out of scope (explicitly)

- **Task 4a batch metadata polish** (LOW) — interface/display refinements on the 219 registered fields. Filed as follow-up `docs/tasks/cms/55-batch-metadata-polish.md`. Not in this plan.
- Adding `directus_relations` entries for the two removed composite-PK collections. They're gone from Directus; no relation needed.
- Surrogate-PK DDL migration for `monthly_aggregates` / `api_key_usage`. Rejected in favor of Option B.

---

## Unresolved Questions

None — all three consultations decided. Execute linearly.
