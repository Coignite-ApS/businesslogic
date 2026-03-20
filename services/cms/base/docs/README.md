# Documentation

Quick reference for Coignite Cockpit Directus documentation.

## Quick Links

| I want to... | Go to |
|--------------|-------|
| Set up for the first time | [Getting Started](getting-started.md) |
| Run locally and develop | [Local Development](local-development.md) |
| Sync database from dev/live | [Database Sync](database-sync.md) |
| Work with extensions | [Extensions](extensions.md) |
| Update Directus or extensions | [Version Management](version-management.md) |
| Deploy to App Platform | [Deployment](deployment.md) |
| Fix an issue | [Troubleshooting](troubleshooting.md) |

## Common Commands

```bash
./dev.sh                              # Start local environment
./scripts/db-sync.sh dev              # Sync database from dev
./scripts/check-updates.sh            # Check for updates
docker compose logs -f directus       # View logs
docker compose down -v && ./dev.sh    # Fresh start
```

## External Resources

| Resource | URL |
|----------|-----|
| Directus Docs | https://directus.io/docs |
| Directus Releases | https://github.com/directus/directus/releases |
| Extension Guide | https://directus.io/docs/guides/extensions/overview |
