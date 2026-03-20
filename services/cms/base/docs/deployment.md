# Deployment

CI/CD pipeline and DigitalOcean App Platform deployment.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Deployment Pipeline                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   GitHub                   DOCR                    App Platform          │
│  ┌────────┐             ┌────────┐              ┌─────────────┐         │
│  │  dev   │────build───▶│ :dev   │────deploy───▶│ Development │         │
│  │ branch │             │  tag   │              │   App       │         │
│  └────────┘             └────────┘              └─────────────┘         │
│                                                                          │
│  ┌────────┐             ┌────────┐              ┌─────────────┐         │
│  │  main  │────build───▶│:latest │────deploy───▶│ Production  │         │
│  │ branch │             │  tag   │              │   App       │         │
│  └────────┘             └────────┘              └─────────────┘         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## GitHub Actions Workflow

The workflow is defined in `.github/workflows/build-and-deploy.yml`.

### Triggers

- **Push to `dev`** - Builds and pushes `:dev` tag
- **Push to `main`** - Builds and pushes `:latest` tag
- **Pull requests** - Build only (no push)
- **Manual trigger** - Via workflow_dispatch

### Required Secrets

Configure these in GitHub repository settings:

| Secret | Purpose |
|--------|---------|
| `NPM_TOKEN` | Access to private @coignite packages |
| `DIGITALOCEAN_ACCESS_TOKEN` | DOCR read/write access |
| `DIRECTUS_SUBMODULE_SSH_KEY` | SSH deploy key for base submodule (org secret) |

### Submodule Access (SSH Deploy Key)

The base submodule is a private repo. GitHub Actions needs an SSH deploy key to clone it.

**Setup (one-time per organization):**

1. Generate SSH key pair:
   ```bash
   ssh-keygen -t ed25519 -C "directus-submodule-ci" -f deploy_key -N ""
   ```

2. Add **public key** to `coignite-directus-base` repo:
   - Settings → Deploy keys → Add deploy key
   - Paste contents of `deploy_key.pub`
   - Leave "Allow write access" **unchecked** (read-only)

3. Add **private key** as org secret:
   - Org Settings → Secrets → Actions → New secret
   - Name: `DIRECTUS_SUBMODULE_SSH_KEY`
   - Value: contents of `deploy_key` (private key)

4. Delete local key files:
   ```bash
   rm deploy_key deploy_key.pub
   ```

**Workflow configuration:**

```yaml
steps:
  - name: Setup SSH for submodules
    uses: webfactory/ssh-agent@v0.9.0
    with:
      ssh-private-key: ${{ secrets.DIRECTUS_SUBMODULE_SSH_KEY }}

  - name: Checkout code
    uses: actions/checkout@v4

  - name: Fetch submodules
    run: |
      git submodule sync --recursive
      git submodule update --init --recursive
```

**Note:** `.gitmodules` must use SSH URL:
```
[submodule "base"]
    path = base
    url = git@github.com:Coignite-ApS/coignite-directus-base.git
```

### Image Tags

The workflow generates multiple tags:

| Tag | When | Purpose |
|-----|------|---------|
| `dev` | Push to dev branch | Development environment |
| `latest` | Push to main branch | Production environment |
| `<sha>` | Every build | Specific commit reference |
| `<branch>` | Every push | Branch reference |

### Docker Image

Image location:
```
registry.digitalocean.com/coignite-dockers/cockpit-directus
```

## Configuration Files

### Environment-Specific Configs

| File | Environment | Used When |
|------|-------------|-----------|
| `config.local.yaml` | Local | Docker Compose development |
| `config.dev.yaml` | Development | App Platform dev environment |
| `config.live.yaml` | Production | App Platform production |

### CONFIG_PATH

The `CONFIG_PATH` environment variable points to the appropriate config file:

- Local: `CONFIG_PATH=/directus/config.local.yaml`
- Dev: `CONFIG_PATH=/directus/config.dev.yaml`
- Live: `CONFIG_PATH=/directus/config.live.yaml`

### Sensitive Values

Sensitive values are NOT in config files. They are set via:
- Terraform (for App Platform)
- Environment variables in App Platform settings
- `.env` file (local development only)

Includes:
- `KEY`, `SECRET` - Directus secrets
- `DB_*` - Database credentials
- `REDIS` - Redis connection string
- `STORAGE_DIGITALOCEAN_*` - S3 credentials
- `EMAIL_MAILGUN_API_KEY` - Email credentials

## DigitalOcean App Platform

### App Structure

Each environment (dev/live) runs:
- **Directus service** - Main application
- **PostgreSQL database** - Managed database
- **Redis** - Managed Redis for caching

### Instance Requirements

The entrypoint automatically calculates required RAM based on installed extensions:

```
Formula: (200 + extensions × 12) × 1.5 MB
Example: 42 extensions → (200 + 504) × 1.5 = 1056MB (~1GB)
```

On startup, you'll see:
```
==========================================
  Directus Startup Assessment
==========================================

Extensions:      42 (41 npm + 1 local)
Required RAM:   1056MB (~1.0GB)
System RAM:     2048MB (~2.0GB)

✓ Memory OK (992MB headroom)

==========================================
  Clearing Redis Cache Lock...
==========================================
  Lock cleared: not present

==========================================
  Starting Directus...
==========================================
```

**Recommended instance size:** At least the "Required RAM" value shown at startup.

### Environment Variables

Set in App Platform (via Terraform or UI):

```yaml
# General
ENV: production
PUBLIC_URL: https://your-app.ondigitalocean.app
KEY: <32+ char string>
SECRET: <32+ char string>
CONFIG_PATH: /directus/config.live.yaml

# Database
DATABASE_URL: ${database.DATABASE_URL}

# Redis (required for cache lock clearing)
REDIS: ${redis.REDIS_URL}
REDIS_DB_NR: 0  # Optional: Redis database number (default: 0)

# Storage
STORAGE_DIGITALOCEAN_KEY: <spaces key>
STORAGE_DIGITALOCEAN_SECRET: <spaces secret>
STORAGE_DIGITALOCEAN_BUCKET: <bucket name>

# Email
EMAIL_FROM: noreply@yourdomain.com
EMAIL_MAILGUN_DOMAIN: yourdomain.com
EMAIL_MAILGUN_API_KEY: <api key>
```

**Note:** `NODE_OPTIONS` is no longer required - the entrypoint handles memory configuration automatically.

### Deployment Process

1. **Code Push** - Push to dev or main branch
2. **GitHub Action** - Builds Docker image
3. **DOCR Push** - Image pushed to registry
4. **App Platform** - Detects new image, deploys

### Manual Deployment

Trigger rebuild from App Platform dashboard or:

```bash
# Force new deployment (GitHub Actions)
git commit --allow-empty -m "Trigger deployment"
git push origin main
```

## Health Checks

### Dockerfile Health Check

```dockerfile
HEALTHCHECK --interval=15s --timeout=10s --start-period=60s --retries=30 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8055/server/health || exit 1
```

### App Platform Health Check

Configure in app spec:
- Path: `/server/health`
- Port: 8055
- Initial delay: 60s (for migrations)

## Schema Management

### Export Schema Before Deployment

```bash
./snapshots/export-schema.sh
```

### Apply Schema to Production

Directus automatically applies schema changes on startup.

For manual control:
```bash
# SSH into container (if available)
npx directus schema apply ./snapshots/snapshot.yaml
```

### Compare Schemas

```bash
./snapshots/diff-schema.sh snapshots/local.yaml snapshots/production.yaml
```

## Monitoring

### Sentry Integration

Error tracking is configured via `@coignite/directus-extension-sentry`:

```yaml
# config.dev.yaml
DE_SENTRY_DSN: 'https://...'
DE_SENTRY_TRACES_SAMPLE_RATE: 0.5
DE_SENTRY_PROFILING_ENABLED: true
DE_SENTRY_PROFILES_SAMPLE_RATE: 0.5

# config.live.yaml (lower rates for production)
DE_SENTRY_TRACES_SAMPLE_RATE: 0.2
DE_SENTRY_PROFILES_SAMPLE_RATE: 0.1
```

### Logs

View logs in App Platform dashboard or:

```bash
doctl apps logs <app-id> --type=run
```

## Troubleshooting Deployments

### Build Failures

1. Check GitHub Actions logs
2. Verify NPM_TOKEN is valid
3. Check for Dockerfile syntax errors

### Deployment Failures

1. Check App Platform deployment logs
2. Verify environment variables are set
3. Check health check endpoint

### Schema Cache Issues

If Directus gets stuck on schema cache:

```bash
# SSH into container or use console
./scripts/reset-cache.sh
```

Or set `REDIS` environment variable and run:
```bash
redis-cli -u "$REDIS" KEYS "schemaCache*" | xargs -r redis-cli -u "$REDIS" DEL
```

### Extension Not Loading

1. Check deployment logs for extension errors
2. Verify extension is compatible with Directus version
3. Check `EXTENSIONS_MUST_LOAD: true` setting

## Rollback

### Quick Rollback

Redeploy previous image tag:

```bash
# Get available tags
doctl registry repository list-tags cockpit-directus

# Update App Platform to use specific tag
# (via Terraform or App Platform UI)
```

### Git Rollback

```bash
git revert HEAD
git push origin main
```

## Best Practices

### Pre-Deployment Checklist

- [ ] Test locally with `./dev.sh`
- [ ] Run `./scripts/check-updates.sh`
- [ ] Export schema snapshot
- [ ] Review changes in PR
- [ ] Merge to dev first, test
- [ ] Then merge to main

### Zero-Downtime Deployment

App Platform handles rolling deployments automatically:
- New container starts
- Health check passes
- Traffic switches to new container
- Old container terminates

### Database Migrations

- Schema changes apply automatically on startup
- Test migrations in dev environment first
- Keep migrations backwards-compatible when possible

## See Also

- [Local Development](local-development.md) - Development workflow
- [Version Management](version-management.md) - Updating versions
- [Troubleshooting](troubleshooting.md) - Common issues
