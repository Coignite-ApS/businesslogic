# Project Extensions

## Adding NPM Extensions

1. Add to `package.json`
2. Rebuild: `docker compose up -d --build directus`

## Creating Local Extensions

```bash
cd extensions/local
npx create-directus-extension@latest
# Follow prompts, prefix name with: project-extension-
```

**Naming Convention:** `project-extension-*`

## Local Extensions

| Extension | Type | Purpose |
|---|---|---|
| `project-extension-calculators` | module | Calculator management UI (configure, test, deploy, integrate) |
| `project-extension-calculator-api` | hook | Formula API proxy, token CRUD, stats, lifecycle hooks |
| `project-extension-formulas` | module | Formula execution test UI (single, batch, sheet modes) |
| `project-extension-account` | module | Account selector, subscription management |
| `project-extension-stripe` | hook | Registration, Stripe billing, trial auto-creation |
| `project-extension-admin` | module | Admin dashboard (accounts, calculators, infrastructure) |

## Building Extensions

```bash
# Build all extensions
make ext-build-all

# Build specific extension
cd extensions/local/project-extension-example
npm run build

# Watch mode for development
cd extensions/local/project-extension-example
npm run dev
```

See [Extension Documentation](../base/docs/extensions.md) for details.
