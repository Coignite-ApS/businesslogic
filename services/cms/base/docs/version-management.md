# Version Management

Keeping Directus and extensions up to date.

## Quick Reference

| Task | Command |
|------|---------|
| Check all updates | `./scripts/check-updates.sh` |
| Update extensions | `./scripts/update-extensions.sh` |
| Update Directus | `./scripts/update-directus.sh latest` |
| Rebuild after update | `docker compose up -d --build` |
| Bump project version | `./scripts/bump-version.sh` |

---

## Project Versioning

The project uses **CalVer** (Calendar Versioning): `YYYY.MM.DD`

### Format

- `YYYY.MM.DD` = release date (e.g., `2024.12.03`)
- CI run number auto-appended for unique tags

### VERSION File

Source of truth: `VERSION` file in project root.

```bash
# Check current version
cat VERSION

# Bump to today's date
./scripts/bump-version.sh

# Set explicit date
./scripts/bump-version.sh 2024.12.25

# Bump and commit
./scripts/bump-version.sh --commit
```

### Docker Tags

| Branch | Tags | Example |
|--------|------|---------|
| dev | `:dev`, `:{ver}.{run}-dev` | `:dev`, `:2024.12.03.35-dev` |
| main | `:latest`, `:{ver}.{run}` | `:latest`, `:2024.12.03.42` |

CI run number ensures uniqueness automatically.

### Release Workflow

```
1. Work on dev branch
2. When ready to release: ./scripts/bump-version.sh
3. Commit + push to dev
4. Create PR: dev -> main
5. CI verifies VERSION was bumped (fails if not)
6. Merge PR
7. CI builds :latest + creates GitHub Release
```

### When to Bump

- New release date (new day)
- Major changes going to production
- Directus version update

---

## External References

**IMPORTANT**: Always check these resources before updating:

| Resource | URL | Check For |
|----------|-----|-----------|
| **Release Notes** | https://github.com/directus/directus/releases | Breaking changes, migrations, deprecations |
| **Configuration Docs** | https://directus.io/docs/configuration/general | New/changed/removed config options |
| **Extension Docs** | https://directus.io/docs/guides/extensions/overview | API changes affecting extensions |

## Overview

The project has three main versioned components:

1. **Directus** - Base image version in Dockerfile
2. **NPM Extensions** - Dependencies in extensions/package.json
3. **Local Extensions** - Dependencies including @directus/extensions-sdk

These components are interdependent - updating one may require updating others.

## Checking for Updates

Run the comprehensive update checker:

```bash
./scripts/check-updates.sh
```

This displays:
- Current vs latest Directus version
- NPM extension updates available
- Local extension dependency updates
- @directus/extensions-sdk version status

### Sample Output

```
==========================================
  Comprehensive Update Check
==========================================

[1/3] Directus Base Image
─────────────────────────
  Current:  11.9.3
  Latest:   11.10.0
  Recent:   11.9.0 11.9.1 11.9.2 11.9.3 11.10.0

  ⚠ Update available: 11.9.3 → 11.10.0

[2/3] NPM Extensions (extensions/package.json)
───────────────────────────────────────────────
  @coignite/directus-extension-sentry  1.1.5  →  1.2.0
  ...

[3/3] Local Extensions (extensions/local/*)
─────────────────────────────────────────────
  project-extension-character-count-display:
    SDK: ^12.0.0 (latest: 12.1.0)
```

## Update Workflow

### Recommended Order

1. **Update @coignite extensions first** - Contact maintainers if new versions are needed
2. **Update other NPM extensions** - Public packages
3. **Update local extension dependencies** - Including SDK
4. **Update Directus last** - After confirming extension compatibility

### Step-by-Step Process

#### 1. Check Current State

```bash
./scripts/check-updates.sh
```

#### 2. Update Extensions

```bash
# Update all extensions interactively
./scripts/update-extensions.sh

# Or selectively
./scripts/update-extensions.sh --npm-only
./scripts/update-extensions.sh --local-only
```

#### 3. Rebuild and Test

```bash
docker compose up -d --build
docker compose logs -f directus
```

#### 4. Update Directus (if needed)

```bash
# Check current vs latest
./scripts/update-directus.sh

# Update to specific version
./scripts/update-directus.sh 11.10.0

# Or update to latest
./scripts/update-directus.sh latest
```

#### 5. Final Rebuild and Test

```bash
docker compose down
docker compose up -d --build
```

## Updating Directus

### Check Available Versions

```bash
./scripts/update-directus.sh
```

Shows:
- Current version (from Dockerfile)
- Latest version (from npm)
- Recent releases

### Update to Specific Version

```bash
./scripts/update-directus.sh 11.10.0
```

### Update to Latest

```bash
./scripts/update-directus.sh latest
```

### Important Considerations

**Before updating Directus, you MUST:**

1. **Review Release Notes** - https://github.com/directus/directus/releases
   - Look for breaking changes and migration guides
   - Check deprecation warnings
   - Note any database schema changes

2. **Check Configuration Changes** - https://directus.io/docs/configuration/general
   - Compare with our `config.*.yaml` files
   - Update any new/changed/deprecated options
   - Test config changes locally first

3. **Verify Extension Compatibility**
   - Check if @coignite extensions support the new version
   - Review extension API changes in release notes
   - Update @directus/extensions-sdk in local extensions

4. **Test Thoroughly**
   - Run in local environment first
   - Verify all extensions load correctly
   - Test critical functionality

## Updating Extensions

### Update All Extensions

```bash
./scripts/update-extensions.sh
```

This script:
1. Shows available updates
2. Prompts for confirmation
3. Updates package.json files
4. Runs npm install
5. Rebuilds local extensions

### Update NPM Extensions Only

```bash
./scripts/update-extensions.sh --npm-only
```

### Update Local Extensions Only

```bash
./scripts/update-extensions.sh --local-only
```

### Interactive Mode

```bash
./scripts/update-extensions.sh -i
```

Lets you select individual packages to update.

## SDK Version Management

The `@directus/extensions-sdk` version in local extensions should be compatible with Directus.

### Check SDK Version

```bash
# In each local extension
cat extensions/local/*/package.json | grep extensions-sdk
```

### Update SDK

The SDK is updated automatically when running:

```bash
./scripts/update-extensions.sh --local-only
```

Or manually:

```bash
cd extensions/local/my-extension
npm install @directus/extensions-sdk@latest
npm run build
```

## Compatibility Matrix

| Directus Version | SDK Version | Notes |
|-----------------|-------------|-------|
| 11.x | 12.x | Current |
| 10.x | 11.x | Previous major |

### @coignite Extensions

@coignite extensions are tested against specific Directus versions. When updating Directus:

1. Check if @coignite extensions support the new version
2. Contact the extension maintainers if updates are needed
3. Wait for compatible versions before updating Directus

## Best Practices

### Regular Updates

- Check for updates weekly: `./scripts/check-updates.sh`
- Apply security updates promptly
- Keep a changelog of updates in git commits

### Testing After Updates

1. Start local environment: `./dev.sh`
2. Test critical functionality
3. Check extension loading in logs
4. Verify no deprecation warnings

### Git Workflow

```bash
# After updating extensions
git add extensions/
git commit -m "Update extensions to latest versions"

# After updating Directus
git add Dockerfile
git commit -m "Update Directus to 11.10.0"
```

### Rollback

If issues occur after update:

```bash
# Revert changes
git checkout HEAD~1 -- Dockerfile extensions/

# Rebuild
docker compose down
docker compose up -d --build
```

## Troubleshooting Updates

### Extension Not Compatible

If an extension doesn't work after Directus update:

1. Check extension release notes
2. Pin to previous version in package.json
3. Report issue to extension maintainer

### Build Failures

After SDK update:

```bash
# Clear cache and rebuild
cd extensions/local/my-extension
rm -rf node_modules dist
npm install
npm run build
```

### Schema Changes

Major Directus updates may include schema changes:

```bash
# Export current schema before updating
./snapshots/export-schema.sh

# After update, check for differences
./snapshots/diff-schema.sh snapshots/old.yaml snapshots/new.yaml
```

## See Also

- [Extensions](extensions.md) - Managing extensions
- [Deployment](deployment.md) - CI/CD pipeline
- [Troubleshooting](troubleshooting.md) - Common issues
