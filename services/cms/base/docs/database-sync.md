# Database Sync

Sync data from dev/live environments to your local development database.

## Quick Start

```bash
# 1. Set up credentials (one-time)
cp .db-credentials.example .db-credentials
# Edit .db-credentials with your connection details

# 2. Sync from dev
./scripts/db-sync.sh dev

# 3. Sync with sanitization (clears tokens/sessions)
./scripts/db-sync.sh dev --sanitize
```

## Setup

### 1. Create Credentials File

Copy the template and fill in your database connection details:

```bash
cp .db-credentials.example .db-credentials
```

Edit `.db-credentials`:

```bash
# Development environment
DEV_DB_HOST="your-dev-db-host.db.ondigitalocean.com"
DEV_DB_PORT="25060"
DEV_DB_NAME="directus"
DEV_DB_USER="directus"
DEV_DB_PASSWORD="your-dev-password"
DEV_DB_SSLMODE="require"

# Production (optional - use with caution)
LIVE_DB_HOST="your-live-db-host.db.ondigitalocean.com"
LIVE_DB_PORT="25060"
LIVE_DB_NAME="directus"
LIVE_DB_USER="directus"
LIVE_DB_PASSWORD="your-live-password"
LIVE_DB_SSLMODE="require"
```

Get connection details from Terraform output or DigitalOcean dashboard.

### 2. Install PostgreSQL Client

The script requires `pg_dump` locally:

```bash
# macOS
brew install postgresql@16

# Ubuntu/Debian
apt install postgresql-client
```

## Usage

### Basic Commands

| Command | Description |
|---------|-------------|
| `./scripts/db-sync.sh dev` | Full sync from dev |
| `./scripts/db-sync.sh dev --sanitize` | Sync + clear tokens/sessions |
| `./scripts/db-sync.sh dev --dump-only` | Only create backup file |
| `./scripts/db-sync.sh dev --keep-dump` | Keep backup after import |
| `./scripts/db-sync.sh live --confirm` | Sync from production |

### Options

| Option | Description |
|--------|-------------|
| `--dump-only` | Create dump without importing |
| `--import-only` | Import existing dump (use with `--file`) |
| `--file <path>` | Specify dump file path |
| `--sanitize` | Clear sensitive tokens after import |
| `--keep-dump` | Don't delete dump file after import |
| `--confirm` | Required for production sync |
| `--no-restart` | Don't restart Directus after import |

### Examples

```bash
# Standard dev sync
./scripts/db-sync.sh dev

# Sync and sanitize (recommended for dev work)
./scripts/db-sync.sh dev --sanitize

# Create backup only
./scripts/db-sync.sh dev --dump-only
# Output: backups/dev_20231201_120000.dump

# Import specific backup
./scripts/db-sync.sh dev --import-only --file backups/dev_20231201_120000.dump

# Production sync (requires confirmation)
./scripts/db-sync.sh live --confirm --sanitize
```

## What the Script Does

1. Dumps remote database using `pg_dump`
2. Stops Directus (to release connections)
3. Drops and recreates local database
4. Restores dump using `pg_restore`
5. Optionally sanitizes data (clears tokens/sessions)
6. Clears Redis cache
7. Restarts Directus

## Security

- **Never commit `.db-credentials`** - It's in `.gitignore`
- **Use read-only credentials** if possible
- **Always use `--sanitize`** when syncing from production
- **Production requires `--confirm`** as safety check

## Troubleshooting

### pg_dump not found

Install PostgreSQL client tools:
```bash
brew install postgresql@16  # macOS
```

### Connection refused

Check that:
- Database host is correct
- Your IP is allowed in database firewall
- SSL mode matches server requirements

### Permission denied

Verify database user has read permissions on all tables.

## See Also

- [Local Development](local-development.md) - Full development workflow
- [Troubleshooting](troubleshooting.md) - Common issues
