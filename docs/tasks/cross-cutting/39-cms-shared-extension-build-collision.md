# 39. CMS Docker image rebuild broken — `_shared` extension + Sprint B extensions

**Status:** in-progress (partial fix shipped `d3f9e8c`; rebuild still broken on `ai-assistant`)
**Severity:** HIGH — blocks full CMS rebuild + browser verification of all Sprint B UI work (cms/36, cms/37) and any future CMS image ship
**Source:** Surfaced while verifying Sprint B tasks 36 + 37 (impl-37 report 2026-04-19); expanded scope during task-39 investigation 2026-04-19
**Blocks:** browser-QA of Sprint B, Sprint 3 production deploy (task 28)

## Problem — revised scope

Original diagnosis (impl-37 report): "`_shared` package name collision with placeholder npm package."

**Reality after investigation:** multiple layered issues. The placeholder-package error (`directus-extension@1.0.0`) is the symptom, not the cause. Root cause: `services/cms/base/docker/build-extensions.sh` walks every directory under `extensions/local/` and tries `npx directus-extension build` on each — including `_shared` which is a **shared library** (no `directus:extension` manifest, no build script). When the local binary isn't found, npm falls back to the registry and hits the dependency-confusion placeholder.

Additional Sprint B extensions surfaced their own issues once the first one was cleared:

1. **`_shared` build failure** (symptom: `directus-extension` placeholder package) — **FIXED** in `d3f9e8c`: script now skips dirs without `directus:extension` manifest but still copies them in-place so relative imports like `import '../../_shared/v2-subscription.js'` resolve.
2. **`project-extension-stripe` missing runtime `ioredis`** (Task 22 sync-import fix didn't add the dep) — **FIXED** in `d3f9e8c`.
3. **Compose missing bind mounts for `usage-consumer` + `ai-observatory`** (Sprint B tasks added the extensions but didn't update compose) — **FIXED** in `d3f9e8c`.
4. **`project-extension-feature-gate` invalid manifest** — it's a shared library with no `directus:extension` meta; was erroring at Directus load time. Mount removed in `d3f9e8c`.
5. **`project-extension-ai-assistant` npm install failure** (`npm error Cannot read properties of undefined (reading 'extraneous')`) — **OPEN**, blocking full rebuild.

## Current state

- CMS container running + healthy using the pre-Sprint-B image (retagged `docker-bl-cms:latest` → `businesslogic-bl-cms:latest`)
- Live bind mounts serve the Sprint B extensions (usage-consumer, ai-observatory) via volumes — works for dev
- Docker **image rebuild still fails** at `ai-assistant` stage
- Local `make ext` builds all 20 extensions cleanly on host (Sprint B dev workflow works)

## Remaining open issue — ai-assistant npm install

Error during `build-extensions.sh` on `project-extension-ai-assistant`:

```
npm error Cannot read properties of undefined (reading 'extraneous')
npm error A complete log of this run can be found in: /home/node/.npm/_logs/...
```

This is npm 10+ behavior — typically triggered by:
- Lockfile inconsistency (lockfile references packages that don't exist in package.json)
- Workspace misconfig (this isn't a workspace, so unlikely)
- Phantom dep in `node_modules` that wasn't in lockfile
- Mixed npm version lockfile (v1 vs v3)

Diagnostic steps for next session:
1. `cd services/cms/extensions/local/project-extension-ai-assistant && npm install --include=dev` on host — reproduces inside container?
2. Inspect `package-lock.json` vs `package.json` for drift
3. Check if `node_modules/` contains extraneous packages not in lockfile: `npm ls --depth=0 2>&1 | grep extraneous`
4. Try `npm ci --include=dev` instead of `npm install` — strict lockfile mode, may surface root cause
5. Rebuild lockfile: `rm -rf node_modules package-lock.json && npm install --include=dev`
6. Compare to other Sprint B-modified extensions (ai-assistant was touched by Task 36.2 low-balance banner + task 20 emitter wiring)

## Acceptance

- `docker compose -f infrastructure/docker/docker-compose.dev.yml build --no-cache bl-cms` succeeds
- Container brought up from the new image is healthy
- All extensions loaded (check `Loaded extensions:` line in `docker logs`) — should be 20 project + 3 base
- Browser verification of Sprint B tasks 36 + 37 completes successfully via the rebuilt image
- `make cms-restart` cold (not warm) completes and CMS becomes healthy

## Partial fix shipped — `d3f9e8c`

**Files changed:**
- `services/cms/base/docker/build-extensions.sh` — skip dirs without `directus:extension` manifest; still `cp -r` them in-place so relative imports (e.g. `../../_shared/`) resolve from built extensions
- `services/cms/extensions/local/project-extension-stripe/package.json` — add `ioredis: ^5.10.1` runtime dep (was missing since Task 22 sync-import change)
- `infrastructure/docker/docker-compose.dev.yml` — add bind mounts for `project-extension-usage-consumer` and `project-extension-ai-observatory` (Sprint B added these extensions but didn't update compose)

## Estimate (revised)

Original: 1-2h.
Actual so far: ~1h for investigation + partial fix.
Remaining: 30min–2h depending on ai-assistant npm error root cause.

## Follow-ups after full fix

- Resume browser verification of cms/36 (wallet-settings-dialog, low-balance-banner) and cms/37 (onboarding wizard)
- Unblock Sprint 3 (production deploy) which requires a working CMS build pipeline
- Consider adding a pre-commit hook or CI step that runs `docker build` to catch image-breaking changes before they land on main (Sprint B shipped 5+ extensions that broke the image build path without being caught)
- File separate task if `feature-gate` needs to become a proper Directus extension or stay as a library (currently in a gray zone)
