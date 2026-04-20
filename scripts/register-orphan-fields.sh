#!/usr/bin/env bash
# register-orphan-fields.sh — register orphan Postgres columns into directus_fields.
#
# Reads orphan (collection, column) pairs straight from Postgres, derives a
# minimal Directus field body per pg type, and POSTs /fields/:collection
# against the local CMS. Idempotent (skips already-registered). Re-runnable.
#
# Env overrides:
#   CMS_URL        default: http://localhost:18055
#   PG_HOST/PORT/DB/USER/PASS  default: localhost/15432/directus/directus/directus
#   ADMIN_EMAIL/ADMIN_PASSWORD read from infrastructure/docker/.env if not set
#
# Flags:
#   --dry-run    print first 5 proposed bodies + per-collection counts, no POST
#   --log <path> apply log path (default docs/reports/db-admin-register-orphan-fields-apply.log)

set -euo pipefail

DRY_RUN=0
LOG="docs/reports/db-admin-register-orphan-fields-apply.log"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --log)     LOG="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

CMS_URL="${CMS_URL:-http://localhost:18055}"
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-15432}"
PG_DB="${PG_DB:-directus}"
PG_USER="${PG_USER:-directus}"
PG_PASS="${PG_PASS:-directus}"

if [[ -z "${ADMIN_EMAIL:-}" || -z "${ADMIN_PASSWORD:-}" ]]; then
  ENV_FILE="infrastructure/docker/.env"
  if [[ -f "$ENV_FILE" ]]; then
    ADMIN_EMAIL="${ADMIN_EMAIL:-$(grep -E '^ADMIN_EMAIL=' "$ENV_FILE" | cut -d= -f2-)}"
    ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(grep -E '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)}"
  fi
fi
: "${ADMIN_EMAIL:?ADMIN_EMAIL not set}"
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD not set}"

mkdir -p "$(dirname "$LOG")"
echo "# register-orphan-fields run @ $(date -u +%FT%TZ)" | tee -a "$LOG"

# --- 1) Pull orphans as TSV -------------------------------------------------
TSV="$(PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -t -A -F $'\t' -c "
SELECT
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  COALESCE(c.column_default, ''),
  c.ordinal_position,
  COALESCE(c.character_maximum_length::text, ''),
  CASE WHEN EXISTS(
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type='PRIMARY KEY'
      AND tc.table_schema='public'
      AND tc.table_name=c.table_name
      AND kcu.column_name=c.column_name
  ) THEN 't' ELSE 'f' END AS is_pk
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN (SELECT collection FROM directus_collections)
  AND NOT EXISTS (
    SELECT 1 FROM directus_fields df
    WHERE df.collection = c.table_name AND df.field = c.column_name)
ORDER BY c.table_name, c.ordinal_position;
")"

TOTAL="$(printf '%s\n' "$TSV" | awk 'NF' | wc -l | tr -d ' ')"
echo "orphans: $TOTAL" | tee -a "$LOG"

if [[ "$TOTAL" == "0" ]]; then
  echo "nothing to do" | tee -a "$LOG"
  exit 0
fi

# --- 2) Type mapping (python helper written to tmpfile, TSV via stdin) ------
HELPER="$(mktemp -t reg-orphan-XXXX.py)"
trap 'rm -f "$HELPER"' EXIT
cat > "$HELPER" <<'PY'
import json, sys

row = sys.stdin.read().rstrip("\n").split("\t")
(coll, col, data_type, udt, is_nullable, col_default, ordinal, charmax, is_pk) = row
ordinal = int(ordinal)
is_pk = (is_pk == 't')
bookkeeping = col in ("id", "date_created", "date_updated", "user_created", "user_updated")

# type mapping
u = udt.lower()
special = []
interface = "input"
display = None
d_type = "string"

if u in ("int2", "int4", "int8", "serial", "bigserial"):
    d_type = "integer"
elif u in ("float4", "float8", "real", "double_precision"):
    d_type = "float"
elif u in ("numeric", "decimal"):
    d_type = "decimal"
elif u == "bool":
    d_type = "boolean"; interface = "boolean"
elif u == "uuid":
    d_type = "uuid"
    if is_pk:
        special = ["uuid"]
elif u in ("json", "jsonb"):
    d_type = "json"; interface = "input-code"
elif u in ("timestamp", "timestamptz"):
    d_type = "timestamp"; interface = "datetime"; display = "datetime"
    if col == "date_created":
        special = ["date-created"]
    elif col == "date_updated":
        special = ["date-updated"]
elif u == "date":
    d_type = "date"; interface = "datetime"; display = "datetime"
elif u in ("time", "timetz"):
    d_type = "time"; interface = "datetime"
elif u == "text":
    d_type = "text"; interface = "input-multiline"
elif u in ("varchar", "bpchar", "char"):
    try:
        n = int(charmax) if charmax else 0
    except ValueError:
        n = 0
    d_type = "text" if n > 255 else "string"
    interface = "input-multiline" if n > 255 else "input"
else:
    # fallback — let Directus decide; keep string
    d_type = "string"

meta = {
    "interface": interface,
    "hidden": bool(bookkeeping),
    "sort": ordinal,
    "readonly": bool(bookkeeping and col != "id" or False),
    "width": "full",
}
if special:
    meta["special"] = special
if display:
    meta["display"] = display
# readonly rule: bookkeeping timestamps + id are readonly in the admin UI
if col in ("id", "date_created", "date_updated", "user_created", "user_updated"):
    meta["readonly"] = True
else:
    meta["readonly"] = False

body = {
    "field": col,
    "type": d_type,
    "meta": meta,
}
sys.stdout.write(json.dumps(body))
PY

build_body() {
  python3 "$HELPER"
}

# --- 3) Dry-run preview -----------------------------------------------------
if [[ "$DRY_RUN" == "1" ]]; then
  echo "--- dry-run preview (first 5 bodies) ---" | tee -a "$LOG"
  i=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    body="$(printf '%s' "$line" | build_body)"
    coll="$(printf '%s' "$line" | cut -f1)"
    echo "POST $CMS_URL/fields/$coll  $body" | tee -a "$LOG"
    i=$((i+1)); [[ $i -ge 5 ]] && break
  done <<< "$TSV"

  echo "--- per-collection counts ---" | tee -a "$LOG"
  printf '%s\n' "$TSV" | awk -F '\t' 'NF {print $1}' | sort | uniq -c | sort -k1,1rn | tee -a "$LOG"
  exit 0
fi

# --- 4) Auth ----------------------------------------------------------------
echo "auth: POST $CMS_URL/auth/login ($ADMIN_EMAIL)" | tee -a "$LOG"
AUTH="$(curl -s -X POST "$CMS_URL/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")"
TOKEN="$(printf '%s' "$AUTH" | jq -r '.data.access_token // empty')"
if [[ -z "$TOKEN" ]]; then
  echo "AUTH FAILED: $AUTH" | tee -a "$LOG"
  exit 1
fi

# --- 5) Apply ---------------------------------------------------------------
# Strategy:
#   - For each orphan, try PATCH /fields/:collection/:field first (matches UI).
#   - If the collection has ZERO existing directus_fields rows, Directus's schema service
#     treats the collection as "unknown" and returns 403 on /fields. In that case we fall
#     back to direct INSERT into directus_fields via psql, then clear the schema cache.
#   - After SQL inserts we retry the PATCH path — this time the collection is known and
#     the few remaining can be promoted via the API if desired (we skip — SQL inserts are
#     schema-identical).

ok=0; fail=0; sql=0

has_fields() {
  PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -t -A -c \
    "SELECT COUNT(*) FROM directus_fields WHERE collection='$1';" 2>/dev/null
}

sql_insert() {
  # Args: collection field json_body
  # Parses body JSON → INSERT into directus_fields.
  local coll="$1" col="$2" body="$3"
  python3 - <<PY | PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 >/dev/null
import json, sys
b = json.loads('''$body''')
m = b.get("meta", {})
def sql_str(v):
    if v is None: return "NULL"
    return "'" + str(v).replace("'", "''") + "'"
def sql_bool(v):
    if v is None: return "NULL"
    return "true" if v else "false"
def sql_int(v):
    return str(v) if v is not None else "NULL"
special = m.get("special")
if isinstance(special, list):
    special = ",".join(special) if special else None
print(f"""INSERT INTO directus_fields
  (collection, field, special, interface, display, readonly, hidden, sort, width)
VALUES (
  {sql_str("$coll")}, {sql_str("$col")},
  {sql_str(special)},
  {sql_str(m.get("interface"))},
  {sql_str(m.get("display"))},
  {sql_bool(m.get("readonly", False))},
  {sql_bool(m.get("hidden", False))},
  {sql_int(m.get("sort"))},
  {sql_str(m.get("width", "full"))}
)
ON CONFLICT DO NOTHING;""")
PY
}

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  coll="$(printf '%s' "$line" | cut -f1)"
  col="$(printf '%s' "$line" | cut -f2)"
  body="$(printf '%s' "$line" | build_body)"

  # Fast path: if collection has existing directus_fields rows, API PATCH works.
  existing="$(has_fields "$coll")"
  if [[ "$existing" == "0" ]]; then
    # Fully-orphan collection — API returns 403. Use direct SQL INSERT.
    if sql_insert "$coll" "$col" "$body"; then
      sql=$((sql+1))
      echo "SQL    $coll.$col" | tee -a "$LOG"
    else
      fail=$((fail+1))
      echo "FAIL   $coll.$col [sql insert]" | tee -a "$LOG"
      exit 1
    fi
    continue
  fi

  # API path
  http_body="$(mktemp)"
  code="$(curl -s -o "$http_body" -w '%{http_code}' \
    -X PATCH "$CMS_URL/fields/$coll/$col" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' \
    -d "$body")"

  case "$code" in
    200|204)
      ok=$((ok+1))
      echo "OK     $coll.$col" | tee -a "$LOG" ;;
    403)
      # Rare race: the collection transitioned to fully-orphan between has_fields and PATCH.
      # Retry via SQL.
      if sql_insert "$coll" "$col" "$body"; then
        sql=$((sql+1))
        echo "SQL    $coll.$col (fallback from 403)" | tee -a "$LOG"
      else
        fail=$((fail+1))
        echo "FAIL   $coll.$col [sql fallback]" | tee -a "$LOG"
        rm -f "$http_body"
        exit 1
      fi
      ;;
    *)
      fail=$((fail+1))
      msg="$(jq -r '.errors[0].message // empty' "$http_body" 2>/dev/null | head -c 300)"
      echo "FAIL   $coll.$col [$code] ${msg:-$(head -c 300 "$http_body")}" | tee -a "$LOG"
      echo "       body sent: $body" | tee -a "$LOG"
      rm -f "$http_body"
      exit 1
      ;;
  esac
  rm -f "$http_body"
done <<< "$TSV"

# Clear Directus schema cache so newly-inserted rows are picked up by the running service.
if [[ $sql -gt 0 ]]; then
  echo "cache-clear: POST $CMS_URL/utils/cache/clear" | tee -a "$LOG"
  curl -s -o /dev/null -w '  HTTP %{http_code}\n' \
    -X POST -H "Authorization: Bearer $TOKEN" "$CMS_URL/utils/cache/clear" | tee -a "$LOG"
fi

echo "--- summary: api=$ok sql=$sql fail=$fail ---" | tee -a "$LOG"
