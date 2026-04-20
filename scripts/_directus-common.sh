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

# Guard against accidental prod-DB execution. Whitelist: localhost, 127.0.0.1,
# host.docker.internal, and any value of $PG_HOST_ALLOWLIST (space-separated).
# Override with ALLOW_NON_LOCAL=1 when you really mean it.
confirm_target_db() {
  local allowlist="localhost 127.0.0.1 host.docker.internal ${PG_HOST_ALLOWLIST:-}"
  echo "target: PG_HOST=$PG_HOST PG_DB=$PG_DB PG_USER=$PG_USER CMS_URL=$CMS_URL" >&2
  if [[ "${ALLOW_NON_LOCAL:-0}" == "1" ]]; then return 0; fi
  for h in $allowlist; do
    [[ "$PG_HOST" == "$h" ]] && return 0
  done
  echo "ABORT: non-local PG_HOST ($PG_HOST) — set ALLOW_NON_LOCAL=1 if intended" >&2
  return 1
}

# Assert a PG column exists. Use in preflight.
preflight_column_exists() {
  local table="$1" col="$2"
  local n
  n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='$table' AND column_name='$col';")
  if [[ "$n" != "1" ]]; then
    echo "ABORT: public.$table.$col does not exist" >&2
    return 1
  fi
}

# Assert every $CURRENT_USER.<field> reference in a Directus filter JSON
# points at an actual directus_users column. Does NOT cover $CURRENT_ROLE or
# bare $CURRENT_USER — those are always valid per Directus contract.
preflight_filter_var() {
  local filter_json="$1"
  local vars
  vars=$(printf '%s' "$filter_json" | grep -oE '\$CURRENT_USER\.[a-zA-Z_]+' | sed 's/^\$CURRENT_USER\.//' | sort -u)
  for v in $vars; do
    local n
    n=$(psql_cmd -t -A -c "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='directus_users' AND column_name='$v';")
    if [[ "$n" != "1" ]]; then
      echo "ABORT: \$CURRENT_USER.$v — directus_users.$v does not exist" >&2
      return 1
    fi
  done
}
