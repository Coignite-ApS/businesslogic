# Directus Marketplace — Publishing Best Practices

Reusable guideline for publishing any Directus extension to npm + Directus Marketplace.

## How Discovery Works

- Extensions published on npm with keyword `directus-extension` are auto-indexed by the Directus Extensions Registry
- Registry mirrors npm every few hours — only the **latest version** is listed
- Marketplace UI in Directus Data Studio shows all indexed extensions
- For removal or issues: marketplace@directus.io

## package.json — Required Fields

```jsonc
{
  "name": "directus-extension-your-name",
  "version": "1.0.0",
  "keywords": ["directus-extension"],
  "directus:extension": {
    "type": "bundle",          // or "hook", "interface", "endpoint", "operation", etc.
    "path": "dist/index.js",
    "source": "src/index.ts",
    "host": "^11.0.0"         // minimum Directus version (semver)
  }
}
```

All five are **mandatory** for Marketplace listing: `name`, `version`, `keywords`, `directus:extension.type`, `directus:extension.host`.

## package.json — Recommended Fields

```jsonc
{
  "icon": "calculate",         // Material Icons name (https://fonts.google.com/icons)
  "description": "Calculate field values when collection data changes",
  "license": "MIT",
  "author": "Your Name <email@example.com>"
}
```

### Description Rules

- Start with a **verb + noun** (e.g., "Calculate field values...")
- Do NOT start with "An extension to..." or "A Directus extension that..."
- Do NOT include adjectives like "quickly", "simply", "easily"
- Do NOT specify the extension type — it's shown separately in the listing
- Keep it under 120 characters

### Author Profile

If your **npm email** matches your **GitHub email** (public), the registry auto-populates your GitHub profile image, name, location, and bio.

## The Sandbox Constraint

### What Can Be Installed from Marketplace

| Extension Type | Marketplace Install | Requires |
|---------------|-------------------|----------|
| App extensions (interface, display, layout, module, panel, theme) | Always | Nothing extra |
| Sandboxed API extensions (hook, endpoint, operation) | Yes | Default `MARKETPLACE_TRUST=sandbox` |
| Non-sandboxed API extensions | Only with config | `MARKETPLACE_TRUST=all` |

### Sandbox SDK — The Full API Surface

Sandboxed extensions run in `isolated-vm`. They **cannot** import any npm packages. The entire SDK is 3 functions:

```typescript
import { request, sleep, log } from 'directus:api';
```

| Function | Purpose | Declared Scope |
|----------|---------|---------------|
| `request(url, options)` | HTTP calls to external URLs | `"request": { "methods": [...], "urls": [...] }` |
| `sleep(ms)` | Async delay | `"sleep": {}` |
| `log(message)` | Write to Directus logger | `"log": {}` |

**No access to:** database, environment variables, Directus services, filesystem, `process`, `require()`, `console`, `setTimeout`.

### Sandbox Permission Declaration

```jsonc
{
  "directus:extension": {
    "type": "hook",
    "path": "dist/index.js",
    "source": "src/index.ts",
    "host": "^11.0.0",
    "sandbox": {
      "enabled": true,
      "requestedScopes": {
        "log": {},
        "sleep": {},
        "request": {
          "methods": ["GET", "POST", "PATCH"],
          "urls": ["https://api.businesslogic.online/*"]
        }
      }
    }
  }
}
```

URL patterns support wildcards: `"https://*"` allows all HTTPS URLs.

### Sandboxed Hook Limitations

| Feature | Non-sandboxed | Sandboxed |
|---------|--------------|-----------|
| Hook types | `init`, `action`, `filter`, `schedule`, `embed` | `action`, `filter` only |
| Callback args | `{ payload, key, collection, schema, accountability, database }` | `payload` only (opaque) |
| Database access | Direct (Knex) + ItemsService | None |
| Environment variables | `env` object | None |
| Directus services | Full (`services` object) | None |
| Third-party imports | Any npm package | None |
| Custom routes | Via `init('routes.custom.before')` | None (use endpoint type) |

### Decision Matrix: Sandboxed vs Non-sandboxed

Choose **sandboxed** when:
- Extension only needs external HTTP calls (via `request()`)
- No database reads/writes beyond what the hook payload provides
- No environment variable configuration needed
- You want maximum Marketplace reach (default install)

Choose **non-sandboxed** when:
- Extension needs to read/write Directus items
- Extension needs environment variables for secrets/config
- Extension needs `init`, `schedule`, or `embed` hooks
- Extension needs third-party libraries
- Extension needs full hook context (accountability, schema)

**Note:** App extensions (interface, display, panel, module) are ALWAYS installable regardless of sandbox mode. Only API extensions (hook, endpoint, operation) are affected.

### Hybrid Strategy for Bundles

A **bundle** can contain both sandboxed and non-sandboxed entries. Best approach:

```jsonc
{
  "directus:extension": {
    "type": "bundle",
    "partial": true,
    "entries": [
      {
        "name": "my-interface",
        "type": "interface"
        // App extensions: always installable
      },
      {
        "name": "my-hook",
        "type": "hook"
        // Non-sandboxed: requires MARKETPLACE_TRUST=all
      },
      {
        "name": "my-operation",
        "type": "operation",
        "sandbox": {
          "enabled": true,
          "requestedScopes": { "request": { "methods": ["POST"], "urls": ["https://*"] } }
        }
        // Sandboxed: always installable
      }
    ]
  }
}
```

With `"partial": true`, users can enable/disable individual bundle entries. App extension entries work immediately; non-sandboxed API entries require `MARKETPLACE_TRUST=all`.

## Bundle Extension Structure

```jsonc
{
  "directus:extension": {
    "type": "bundle",
    "partial": true,        // users can toggle individual entries
    "path": {
      "app": "dist/app.js",
      "api": "dist/api.js"
    },
    "entries": [
      { "name": "my-interface", "type": "interface" },
      { "name": "my-hook", "type": "hook" },
      { "name": "my-operation", "type": "operation" }
    ]
  }
}
```

Build produces two files: `dist/app.js` (all app entries) and `dist/api.js` (all API entries).

## README Best Practices

- Include **screenshots** — hosted on GitHub (`raw.githubusercontent.com` only, Marketplace blocks other image hosts)
- Show configuration steps with annotated screenshots
- Include a "Quick Start" section (install → configure → verify)
- Document required environment variables clearly
- If non-sandboxed: prominently mention `MARKETPLACE_TRUST=all` requirement
- Add a "Compatibility" section with tested Directus versions

## Pre-Publish Checklist

```bash
# 1. Build
npx directus-extension build

# 2. Validate (all checks)
npx create-directus-extension@latest validate

# 3. Validate individual checks
npx create-directus-extension@latest validate -c built-code       # dist/ exists and valid
npx create-directus-extension@latest validate -c directus-config   # package.json config
npx create-directus-extension@latest validate -c license           # license field/file
npx create-directus-extension@latest validate -c readme            # README exists

# 4. Verify dist/ is in published package
npm pack --dry-run   # check file list

# 5. Publish
npm publish
```

## Post-Publish

- Registry syncs every few hours — check https://registry.directus.io after ~4h
- Search for your extension in Directus Data Studio → Settings → Extensions → Marketplace
- Verify listing: icon, description, screenshots render correctly
- Test install on a clean Directus instance

## Common Pitfalls

| Issue | Fix |
|-------|-----|
| Extension not appearing in Marketplace | Ensure `"directus-extension"` keyword in `package.json` |
| Screenshots not loading | Use `raw.githubusercontent.com` URLs only |
| "Unsupported extension" on install | Check `directus:extension.host` matches user's Directus version |
| Hook not running after Marketplace install | Non-sandboxed hook — user needs `MARKETPLACE_TRUST=all` |
| Bundle entries can't be individually installed | Expected — only the whole bundle installs, entries can be toggled |
| Validation fails on `built-code` | Run `npx directus-extension build` first, ensure `dist/` included in npm package |

## Version Compatibility

- Sandbox SDK available since Directus **10.7.0** (replaced vm2 with isolated-vm)
- Bundle support available since Directus **10.0.0**
- Set `host` to the minimum version you've tested against
- Use semver range: `"^11.0.0"` means 11.x.x
