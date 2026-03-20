#!/bin/bash
set -euo pipefail

# =============================================================================
# Database Sync Script
# Dumps remote database and imports to local Docker PostgreSQL
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
BACKUP_DIR="$PROJECT_DIR/backups"
CREDENTIALS_FILE="$PROJECT_DIR/.db-credentials"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
    echo -e "${BLUE}Database Sync Script${NC}"
    echo ""
    echo "Usage: $0 <environment> [options]"
    echo ""
    echo "Environments:"
    echo "  dev     Sync from development database"
    echo "  live    Sync from production database (requires --confirm)"
    echo ""
    echo "Options:"
    echo "  --dump-only      Only create dump, don't import"
    echo "  --import-only    Import existing dump (specify with --file)"
    echo "  --file <path>    Use specific dump file"
    echo "  --sanitize       Remove sensitive data after import"
    echo "  --confirm        Required for production sync"
    echo "  --keep-dump      Don't delete dump file after import"
    echo "  --no-restart     Don't restart Directus after import"
    echo ""
    echo "Examples:"
    echo "  $0 dev                     # Full sync from dev"
    echo "  $0 dev --sanitize          # Sync + sanitize passwords"
    echo "  $0 dev --dump-only         # Just create backup"
    echo "  $0 live --confirm          # Sync from production"
    exit 1
}

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# Find pg_dump (prefer newer versions)
find_pg_dump() {
    # Check for versioned installations first (macOS Homebrew)
    for ver in 17 16 15; do
        for path in "/usr/local/opt/postgresql@$ver/bin/pg_dump" "/opt/homebrew/opt/postgresql@$ver/bin/pg_dump"; do
            if [[ -x "$path" ]]; then
                echo "$path"
                return
            fi
        done
    done
    # Fall back to PATH
    if command -v pg_dump &> /dev/null; then
        command -v pg_dump
        return
    fi
    return 1
}

# Check dependencies
check_deps() {
    PG_DUMP=$(find_pg_dump) || error "pg_dump not found. Install PostgreSQL client tools:\n  macOS: brew install postgresql@15\n  Ubuntu: apt install postgresql-client-15"
    export PG_DUMP
    log "Using: $PG_DUMP ($($PG_DUMP --version | head -1))"

    if ! docker compose ps postgres 2>/dev/null | grep -qE "(running|Up)"; then
        error "Local PostgreSQL container not running. Start with: docker compose up -d postgres"
    fi
}

# Parse arguments
ENV=""
DUMP_ONLY=false
IMPORT_ONLY=false
DUMP_FILE=""
SANITIZE=false
CONFIRMED=false
KEEP_DUMP=false
NO_RESTART=false

while [[ $# -gt 0 ]]; do
    case $1 in
        dev|live) ENV="$1"; shift ;;
        --dump-only) DUMP_ONLY=true; shift ;;
        --import-only) IMPORT_ONLY=true; shift ;;
        --file) DUMP_FILE="$2"; shift 2 ;;
        --sanitize) SANITIZE=true; shift ;;
        --confirm) CONFIRMED=true; shift ;;
        --keep-dump) KEEP_DUMP=true; shift ;;
        --no-restart) NO_RESTART=true; shift ;;
        -h|--help) usage ;;
        *) error "Unknown option: $1" ;;
    esac
done

[[ -z "$ENV" ]] && usage

# Safety check for production
if [[ "$ENV" == "live" && "$CONFIRMED" != "true" ]]; then
    echo -e "${RED}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  WARNING: You are about to sync from PRODUCTION          ║${NC}"
    echo -e "${RED}║  This requires the --confirm flag                        ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════╝${NC}"
    error "Production sync requires --confirm flag"
fi

# Check dependencies
check_deps

# Load credentials
if [[ ! -f "$CREDENTIALS_FILE" ]]; then
    error "Credentials file not found: $CREDENTIALS_FILE\n\nCreate it from the template:\n  cp .db-credentials.example .db-credentials\n  # Then edit with your actual credentials\n\nSee docs/database-sync.md for setup instructions"
fi
source "$CREDENTIALS_FILE"

# Set connection vars based on environment
if [[ "$ENV" == "dev" ]]; then
    DB_HOST="${DEV_DB_HOST:-}"
    DB_PORT="${DEV_DB_PORT:-25060}"
    DB_NAME="${DEV_DB_NAME:-directus}"
    DB_USER="${DEV_DB_USER:-directus}"
    DB_PASSWORD="${DEV_DB_PASSWORD:-}"
    DB_SSLMODE="${DEV_DB_SSLMODE:-require}"
    DB_SSLCERT="${DEV_DB_SSLCERT:-}"
else
    DB_HOST="${LIVE_DB_HOST:-}"
    DB_PORT="${LIVE_DB_PORT:-25060}"
    DB_NAME="${LIVE_DB_NAME:-directus}"
    DB_USER="${LIVE_DB_USER:-directus}"
    DB_PASSWORD="${LIVE_DB_PASSWORD:-}"
    DB_SSLMODE="${LIVE_DB_SSLMODE:-require}"
    DB_SSLCERT="${LIVE_DB_SSLCERT:-}"
fi

# Validate credentials
[[ -z "$DB_HOST" ]] && error "DB_HOST not set for $ENV environment. Check .db-credentials"
[[ -z "$DB_PASSWORD" ]] && error "DB_PASSWORD not set for $ENV environment. Check .db-credentials"

# Resolve relative certificate path to absolute
if [[ -n "$DB_SSLCERT" && ! "$DB_SSLCERT" = /* ]]; then
    DB_SSLCERT="$PROJECT_DIR/$DB_SSLCERT"
fi
[[ -n "$DB_SSLCERT" && ! -f "$DB_SSLCERT" ]] && error "SSL certificate not found: $DB_SSLCERT"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Generate dump filename
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
[[ -z "$DUMP_FILE" ]] && DUMP_FILE="$BACKUP_DIR/${ENV}_${TIMESTAMP}.dump"

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Database Sync: $ENV → local${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# -----------------------------------------------------------------------------
# DUMP
# -----------------------------------------------------------------------------
if [[ "$IMPORT_ONLY" != "true" ]]; then
    step "Dumping $ENV database from $DB_HOST..."

    # Build SSL connection string
    PG_SSL_OPTS="sslmode=$DB_SSLMODE"
    [[ -n "$DB_SSLCERT" ]] && PG_SSL_OPTS="$PG_SSL_OPTS sslrootcert=$DB_SSLCERT"

    PGPASSWORD="$DB_PASSWORD" PGSSLMODE="$DB_SSLMODE" PGSSLROOTCERT="${DB_SSLCERT:-}" "$PG_DUMP" \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -Fc \
        --no-owner \
        --no-privileges \
        -f "$DUMP_FILE"

    DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
    log "Dump created: $DUMP_FILE ($DUMP_SIZE)"

    if [[ "$DUMP_ONLY" == "true" ]]; then
        echo ""
        log "Dump-only mode. Import later with:"
        echo "  $0 $ENV --import-only --file $DUMP_FILE"
        exit 0
    fi
fi

# -----------------------------------------------------------------------------
# IMPORT
# -----------------------------------------------------------------------------
[[ ! -f "$DUMP_FILE" ]] && error "Dump file not found: $DUMP_FILE"

step "Stopping Directus to release database connections..."
docker compose stop directus 2>/dev/null || true

step "Dropping and recreating local database..."
docker compose exec -T postgres psql -U directus -d postgres -c "
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'directus' AND pid <> pg_backend_pid();
" >/dev/null 2>&1 || true
docker compose exec -T postgres psql -U directus -d postgres -c "DROP DATABASE IF EXISTS directus;" >/dev/null
docker compose exec -T postgres psql -U directus -d postgres -c "CREATE DATABASE directus OWNER directus;" >/dev/null

step "Restoring dump to local database..."
docker compose exec -T postgres pg_restore \
    -U directus \
    -d directus \
    --no-owner \
    --no-privileges \
    --if-exists \
    --clean \
    < "$DUMP_FILE" 2>&1 | grep -v "already exists" || true

log "Database restored successfully!"

# -----------------------------------------------------------------------------
# SANITIZE (optional)
# -----------------------------------------------------------------------------
if [[ "$SANITIZE" == "true" ]]; then
    step "Sanitizing sensitive data..."
    docker compose exec -T postgres psql -U directus -d directus <<'EOSQL'
        -- Clear sensitive tokens and sessions
        UPDATE directus_users SET token = NULL WHERE token IS NOT NULL;
        DELETE FROM directus_sessions;

        -- Note: Password hashes are kept as-is since they're already hashed
        -- If you need to reset passwords, uncomment below and use a valid argon2 hash

        -- Optional: anonymize emails (uncomment if needed)
        -- UPDATE directus_users SET email = 'user' || id::text || '@local.dev' WHERE email NOT LIKE '%@local.dev';
EOSQL
    log "Sanitization complete (tokens cleared, sessions removed)"
fi

# -----------------------------------------------------------------------------
# CLEANUP
# -----------------------------------------------------------------------------
if [[ "$KEEP_DUMP" != "true" && "$IMPORT_ONLY" != "true" ]]; then
    rm -f "$DUMP_FILE"
    log "Dump file removed"
else
    log "Dump file kept: $DUMP_FILE"
fi

# Clear Redis cache
step "Clearing Redis cache..."
docker compose exec -T redis redis-cli FLUSHALL >/dev/null 2>&1 || true

# Restart Directus
if [[ "$NO_RESTART" != "true" ]]; then
    step "Starting Directus..."
    docker compose up -d directus
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Sync complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
log "Directus URL: http://localhost:8056"
[[ "$SANITIZE" == "true" ]] && warn "Sessions cleared - you'll need to log in again"
echo ""
