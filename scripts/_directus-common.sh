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
