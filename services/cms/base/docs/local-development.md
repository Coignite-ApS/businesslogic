# Local Development

Daily development workflow for Coignite Cockpit Directus.

## Quick Reference

| Task | Command |
|------|---------|
| Start environment | `./dev.sh` |
| Stop (keep data) | `docker compose down` |
| Stop (reset data) | `docker compose down -v` |
| View logs | `docker compose logs -f directus` |
| Rebuild | `docker compose up -d --build directus` |
| Sync database | `./scripts/db-sync.sh dev` |
| Reset cache | `./scripts/reset-cache.sh local` |

## Architecture

The local development environment uses Docker Compose to run:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Local Development Stack                       │
├─────────────────────────────────────────────────────────────────┤
│  Directus (port 8056)                                           │
│  ├── PostgreSQL (internal)                                      │
│  ├── Redis (internal)                                           │
│  └── Extensions (hot reload enabled)                            │
│                                                                 │
│  MailDev (port 1080) - Email testing                            │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

### Environment Variables

The `.env` file contains sensitive values:

```bash
# Required
NPM_TOKEN=your_npm_token_here

# Optional overrides
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123
KEY=local-dev-key-minimum-32-characters
SECRET=local-dev-secret-minimum-32-chars
```

### Configuration Files

| File | Purpose |
|------|---------|
| `config.local.yaml` | All Directus settings for local development |
| `docker-compose.yml` | Service definitions and volume mounts |

The `CONFIG_PATH` environment variable points Directus to the appropriate config file. This approach mirrors how App Platform deployments work.

## Services

### Directus

- **URL**: http://localhost:8056
- **Login**: `admin@example.com` / `admin123`
- **Hot Reload**: Enabled for extensions in `extensions/local/`

### PostgreSQL

- **Host**: `postgres` (internal Docker network)
- **Database**: `directus`
- **User/Password**: `directus` / `directus`
- **Data**: Persisted in `pgdata` Docker volume

### Redis

- **Host**: `redis` (internal Docker network)
- **Port**: 6379
- **Data**: Persisted in `redisdata` Docker volume

### MailDev

- **Web UI**: http://localhost:1080
- **SMTP**: `maildev:1025` (internal)

All emails sent by Directus are captured here for testing.

## Common Tasks

### Starting the Environment

```bash
# Quick start (builds and shows logs)
./dev.sh

# Or manually
docker compose up -d --build
docker compose logs -f directus
```

### Stopping the Environment

```bash
# Stop services (keep data)
docker compose down

# Stop and remove all data
docker compose down -v
```

### Viewing Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f directus
docker compose logs -f postgres
docker compose logs -f redis
```

### Accessing Containers

```bash
# Directus shell
docker compose exec directus sh

# PostgreSQL CLI
docker compose exec postgres psql -U directus -d directus

# Redis CLI
docker compose exec redis redis-cli
```

### Rebuilding

```bash
# After changing extensions/package.json
docker compose up -d --build directus

# Full rebuild (fresh image)
docker compose build --no-cache directus
docker compose up -d
```

## Database Management

### Export Schema

```bash
./snapshots/export-schema.sh
# Creates: snapshots/snapshot_YYYYMMDD_HHMMSS.yaml
```

### Apply Schema

```bash
./snapshots/apply-schema.sh snapshots/snapshot_20240101_120000.yaml
```

### Compare Schemas

```bash
./snapshots/diff-schema.sh snapshots/old.yaml snapshots/new.yaml
```

## Email Testing

All emails are captured by MailDev:

1. Trigger an email action in Directus (password reset, notifications, etc.)
2. Open http://localhost:1080
3. View the captured email

## Volume Management

Docker volumes persist data between restarts:

| Volume | Purpose |
|--------|---------|
| `pgdata` | PostgreSQL database |
| `redisdata` | Redis cache |
| `directus_uploads` | Uploaded files |

### Reset Everything

```bash
# Stop and remove volumes
docker compose down -v

# Start fresh
./dev.sh
```

### Backup Database

```bash
docker compose exec postgres pg_dump -U directus directus > backup.sql
```

### Restore Database

```bash
cat backup.sql | docker compose exec -T postgres psql -U directus directus
```

## Syncing from Dev/Live

To work with real data from dev or production environments:

```bash
# One-time setup
cp .db-credentials.example .db-credentials
# Edit with your database connection details

# Sync from dev (recommended)
./scripts/db-sync.sh dev --sanitize

# Sync from production (requires confirmation)
./scripts/db-sync.sh live --confirm --sanitize
```

See [Database Sync](database-sync.md) for full documentation.

## Debugging

### Check Service Health

```bash
docker compose ps
```

### Directus Health Endpoint

```bash
curl http://localhost:8056/server/health
```

### Redis Cache Issues

If Directus gets stuck on schema cache:

```bash
./scripts/reset-cache.sh local
```

### Extension Not Loading

1. Check logs: `docker compose logs -f directus`
2. Verify extension is built: `ls extensions/local/my-extension/dist/`
3. Rebuild: `docker compose up -d --build directus`

### Extension Changes Not Appearing

**Important**: `EXTENSIONS_AUTO_RELOAD` has known limitations (see [directus/directus#11321](https://github.com/directus/directus/issues/11321)):

- **API extensions** (hooks, endpoints, operations): Auto-reload uses Node's `require()` which has internal caching issues. After errors or certain changes, you must restart Directus.
- **App extensions** (interfaces, displays, layouts, panels, modules): These are bundled at startup into `/extensions/sources/index.js`. Auto-reload does NOT re-bundle them - **you must restart Directus**.

**Recommended workflow for local extension development**:

```bash
# Terminal 1: Watch and rebuild extension
cd extensions/local/your-extension
npm run dev

# Terminal 2: After changes, restart Directus to pick up new bundle
docker compose restart directus

# Then hard refresh browser (Cmd+Shift+R or Ctrl+Shift+R)
```

**Docker volume mount requirement**: The Dockerfile builds local extensions into `/directus/extensions/` at image build time. To develop extensions without rebuilding the Docker image, you must mount each local extension directly over the baked-in version in `docker-compose.yml`:

```yaml
volumes:
  # For each local extension, add a mount that overrides the baked-in version:
  - ./extensions/local/directus-extension-my-extension:/directus/extensions/directus-extension-my-extension
```

**Important**: The mount path must match the extension folder name used in the Dockerfile build. Check `/directus/extensions/` inside the container to see the exact names:

```bash
docker compose exec directus ls /directus/extensions/
```

**Wrong approach** (extension changes won't be picked up):
```yaml
# This creates a separate path - Directus still loads the baked-in version!
- ./extensions/local:/directus/extensions/local
```

**Adding a new local extension for development**:

1. Create the extension in `extensions/local/my-new-extension/`
2. Build the Docker image once: `docker compose up -d --build`
3. Add volume mount to `docker-compose.yml`:
   ```yaml
   - ./extensions/local/my-new-extension:/directus/extensions/my-new-extension
   ```
4. Restart: `docker compose up -d`
5. Now you can edit, rebuild (`npm run dev`), and restart Directus without rebuilding the image

## Performance Tips

1. **Allocate more RAM to Docker** - Directus with extensions can use 2GB+
2. **Use SSD storage** - PostgreSQL benefits greatly
3. **Don't run too many containers** - Stop unused projects

## See Also

- [Database Sync](database-sync.md) - Import data from dev/live
- [Extensions](extensions.md) - Creating and managing extensions
- [Version Management](version-management.md) - Updating dependencies
- [Troubleshooting](troubleshooting.md) - Common issues
