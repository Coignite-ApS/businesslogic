# Extensions

Managing and developing Directus extensions.

## Naming Convention

| Type | Pattern | Example |
|------|---------|---------|
| Base (submodule) | `base-extension-*` | `base-extension-sentry` |
| Project-specific | `project-extension-*` | `project-extension-character-count` |

This convention:
- Distinguishes shared infrastructure from project-specific code
- Makes it clear where an extension originates
- Avoids confusion with npm packages (`directus-extension-*`)

## Quick Reference

| Task | Command |
|------|---------|
| Check for updates | `./scripts/check-updates.sh` |
| Update all extensions | `./scripts/update-extensions.sh` |
| Build local extension | `cd extensions/local/my-ext && npm run build` |
| Dev mode (watch) | `cd extensions/local/my-ext && npm run dev` |
| Scaffold new extension | `cd extensions/local && npx create-directus-extension@latest` |

## External References

**IMPORTANT**: Always check these resources before developing extensions:

| Resource | URL | Purpose |
|----------|-----|---------|
| **Extension Overview** | https://directus.io/docs/guides/extensions/overview | Extension types, architecture, best practices |
| **Extension SDK** | https://directus.io/docs/guides/extensions/extensions-sdk | SDK usage and API reference |
| **Extension CLI** | https://directus.io/docs/guides/extensions/extensions-sdk#directus-extension-cli | CLI commands for scaffolding and building |

**Always use the Directus Extension CLI** (`create-directus-extension` and `directus-extension`) for faster, standardized development.

## Extension Types

There are two types of extensions in this project:

### 1. NPM Extensions

Located in `extensions/package.json`, these are installed from npm:

- **@coignite extensions** - Private packages (require NPM_TOKEN)
- **@directus-labs extensions** - Official Directus community packages
- **Public extensions** - Third-party packages from npm

### 2. Local Extensions

Located in `extensions/local/`, these are custom extensions developed in-house:

- Built during Docker image creation
- Hot reload enabled in local development
- Use `@directus/extensions-sdk` for building

## Project Structure

```
extensions/
├── package.json          # NPM extension dependencies
├── .npmrc                # NPM authentication (uses NPM_TOKEN)
└── local/                # Local extension development
    └── my-extension/
        ├── package.json
        ├── src/
        │   └── index.ts
        └── dist/         # Built output (git ignored)
```

## Creating a Local Extension

### 1. Check Official Documentation First

Before creating an extension, review the official docs:
- https://directus.io/docs/guides/extensions/overview
- Check the specific extension type documentation (interface, hook, endpoint, etc.)

### 2. Scaffold with Directus Extension CLI

**Always use the official CLI** for scaffolding - it ensures correct structure and configuration:

```bash
cd extensions/local
npx create-directus-extension@latest
```

Follow the prompts to select extension type:
- **interface** - Custom field UI
- **display** - Custom field display
- **layout** - Collection view layout
- **module** - Admin panel section
- **panel** - Dashboard widget
- **hook** - Event listeners
- **endpoint** - Custom API routes
- **operation** - Flow operation
- **bundle** - Multiple extensions in one

### 3. Configure package.json

Example `package.json` for a local extension:

```json
{
  "name": "project-extension-my-feature",
  "version": "1.0.0",
  "description": "Custom extension for...",
  "type": "module",
  "directus:extension": {
    "type": "interface",
    "path": "dist/index.js",
    "source": "src/index.ts",
    "host": "^10.0.0 || ^11.0.0"
  },
  "scripts": {
    "build": "directus-extension build",
    "dev": "directus-extension build -w --no-minify"
  },
  "devDependencies": {
    "@directus/extensions-sdk": "^12.0.0",
    "typescript": "^5.0.0",
    "vue": "^3.4.0"
  }
}
```

### 4. Development Workflow

Use the **Directus Extension CLI** for development with hot reload:

```bash
# Start the development environment
./dev.sh

# In another terminal, watch for changes
cd extensions/local/my-extension
npm install
npm run dev  # Uses: directus-extension build -w --no-minify
```

Changes are hot-reloaded in local development (no rebuild needed).

### 5. Build for Production

Use the **Directus Extension CLI** for building:

```bash
cd extensions/local/my-extension
npm run build  # Uses: directus-extension build
```

The Dockerfile automatically builds local extensions during image creation using `npx directus-extension build`.

## Managing NPM Extensions

### Adding a New Extension

```bash
cd extensions
npm install @coignite/directus-extension-new-feature
```

Or for public packages:

```bash
npm install directus-extension-some-feature
```

### Removing an Extension

```bash
cd extensions
npm uninstall @coignite/directus-extension-old-feature
```

### Checking for Updates

```bash
./scripts/check-updates.sh
```

This shows:
- Available Directus updates
- NPM extension updates
- Local extension dependency updates

### Updating Extensions

```bash
# Update everything
./scripts/update-extensions.sh

# Only NPM extensions
./scripts/update-extensions.sh --npm-only

# Only local extensions
./scripts/update-extensions.sh --local-only

# Interactive selection
./scripts/update-extensions.sh -i
```

## @coignite Extensions

Private extensions published to npm under the `@coignite` scope.

### Available Extensions

| Extension | Purpose |
|-----------|---------|
| `@coignite/directus-extension-control-panel` | Admin control panel |
| `@coignite/directus-extension-flows-manager` | Flow management UI |
| `@coignite/directus-extension-sentry` | Sentry error tracking |
| `@coignite/directus-extension-migrations` | Database migrations |
| `@coignite/directus-extension-custom-api` | Custom API endpoints |
| `@coignite/directus-extension-openai` | OpenAI integration |
| ... | See `extensions/package.json` for full list |

### Authentication

NPM_TOKEN is required to install @coignite packages:

1. Get the token from your npm account or team lead
2. Add to `.env`: `NPM_TOKEN=your_token_here`
3. The `.npmrc` file uses this token for authentication

## Version Compatibility

Extensions must be compatible with the Directus version in use.

### Important Notes

1. **@directus/extensions-sdk** version should match or be compatible with Directus
2. **@coignite extensions** are tested against specific Directus versions
3. Always check compatibility before updating Directus

### Update Order

When updating, follow this order:

1. Check what updates are available: `./scripts/check-updates.sh`
2. Update @coignite extensions (contact maintainers if needed)
3. Update local extension dependencies
4. Update Directus version last (after confirming compatibility)

## Debugging Extensions

### Check if Extension Loaded

```bash
docker compose logs -f directus | grep -i extension
```

### Verify Extension Files

```bash
# NPM extensions
docker compose exec directus ls /directus/extensions/node_modules/@coignite

# Local extensions
docker compose exec directus ls /directus/extensions/
```

### Common Issues

**Extension not appearing:**
1. Check if built: `ls extensions/local/my-extension/dist/`
2. Check logs: `docker compose logs -f directus`
3. Rebuild: `docker compose up -d --build directus`

**Build errors:**
1. Check SDK version matches Directus
2. Clear node_modules: `rm -rf node_modules && npm install`
3. Rebuild: `npm run build`

**Hot reload not working:**
1. Ensure `EXTENSIONS_AUTO_RELOAD=true` in config
2. Check file permissions
3. Restart container: `docker compose restart directus`

## Best Practices

### Development

- Use TypeScript for type safety
- Follow Directus extension patterns and conventions
- Test against the target Directus version
- Keep extensions focused (single responsibility)

### Versioning

- Local extensions: Increment version in package.json
- NPM extensions: Follow semantic versioning
- Document breaking changes

### Git

- Commit `package.json` changes (extensions/package.json)
- Don't commit `node_modules/` or `dist/`
- Include meaningful commit messages for extension updates

## See Also

- [Version Management](version-management.md) - Updating Directus and extensions
- [Local Development](local-development.md) - Development workflow
- [Troubleshooting](troubleshooting.md) - Common issues
