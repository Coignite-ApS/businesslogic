# 54. 🔴 P0: Shared-lib directories in /directus/extensions/ break entire hook layer

**Status:** planned
**Severity:** P0 — silently disables ALL 22 hook extensions in dev (and likely prod) CMS. Verified live 2026-04-20 while finishing tasks 48/49.
**Source:** Mid-session diagnostic during browser-verification of tasks 48 and 49 (2026-04-20)
**Blocks:** Browser-verification of any new endpoint/hook change in CMS extensions

## Problem

Directus's `ExtensionManager.load` in 11.16.x calls `resolveFsExtensions`, which iterates every directory under `/directus/extensions/` and **strict-fails** when ANY package.json lacks a valid `directus:extension` field. When that happens, `Couldn't load extensions` is logged and **none of the hook extensions register their endpoints**. The subsequent `INFO: Extensions loaded` line is misleading — the loader returned an empty result.

Two directories trigger this on the current dev CMS:
- `_shared/` (project-local shared library: v2-subscription helpers)
- `project-extension-feature-gate/` (project-local shared library: feature flag client)

Both are documented in `CLAUDE.md` as "Shared lib... not a Directus extension". The build script at `services/cms/base/docker/build-extensions.sh` correctly identifies them (no `directus:extension` field) and copies them in-place to `/directus/extensions/$name` so that the bundler can resolve relative imports like `'../../_shared/v2-subscription.js'` at build time. After build, the imports are inlined into each extension's `dist/index.js` — **the shared libs are not needed at runtime** (verified: grep of all dist files shows zero runtime imports of `_shared` or `feature-gate` modules; only CSS class names match).

## Reproduction

```bash
docker logs businesslogic-bl-cms-1 2>&1 | grep -A2 "Couldn't load extensions"
# WARN: Couldn't load extensions
# WARN: The manifest of the extension "_shared" (...) is invalid.
# (or "project-extension-feature-gate", whichever the loader hits first)

curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:18055/stripe/webhook
# 404  (route not registered → extension hook didn't load)

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:18055/wallet/balance
# 404
```

## Root cause (verified 2026-04-20)

Inside the running container:

1. `/directus/extensions/_shared/package.json` has no `directus:extension` field → fails Zod validation in `resolveFsExtensions` (`/node_modules/.pnpm/@directus+extensions@.../dist/node.js:227`).
2. `ExtensionManager.load` catches the error, logs `Couldn't load extensions`, and returns no extensions.
3. All hook extensions silently fail to register their Express routes.

After moving both directories out of `/directus/extensions/` and restarting:
- `/stripe/webhook` → 400 (signature error — handler IS reached)
- `/account/onboarding/state` → 401 (auth required — endpoint IS registered)
- `/wallet/balance` → 401 (extension loaded)

Confirmed: removing the two non-extension directories restores the entire hook layer.

## Why this wasn't caught earlier

- Unit tests run against mocks, not real Directus extension load.
- HTTP-level test in task 48 (`webhook-http.realdb.test.ts`) auto-skips when route registration check fails — silently passes when `_shared` blocks the load.
- Browser QA on 2026-04-19 ran as admin with cached sessions and didn't exercise hook endpoints that were 404'ing.
- ux-test 2026-04-20 surfaced this indirectly (Sarah's webhook never ran), but root cause was misdiagnosed as "webhook secret mismatch" until live diagnostic in this session.

## Fix options

### Option A — No-op `directus:extension` manifests (smallest, recommended)

Add a minimal manifest to both `_shared/package.json` and `project-extension-feature-gate/package.json` that Directus accepts but loads nothing. Likely shape (validate against Directus 11.16 Zod schema):

```json
"directus:extension": {
  "type": "bundle",
  "path": "dist/index.js",
  "entries": []
}
```

Plus a stub `dist/index.js` (single empty `export {};`). Build script and runtime both happy. No relative-import paths change.

### Option B — Move shared libs out of `/directus/extensions/`

Update `services/cms/base/docker/build-extensions.sh` to copy shared libs to `/directus/cms-shared/` instead. Update import paths in the project-extension-* code from `'../../_shared/v2-subscription.js'` to a path that works for the bundler.

Cost: requires submodule (`base/`) commit + import-path refactor across 6+ files.

### Option C — Cleanup step after build

Add a step (in `services/cms/base/docker/build-extensions.sh` or `entrypoint.sh`) that removes shared-lib directories from `/directus/extensions/` after the build loop completes. They were only needed during build.

Cost: requires submodule commit. Simpler than B but still touches base.

**Recommend Option A** — fully isolated to project files, two tiny package.json edits + two stub dist files, no submodule churn, no import-path refactor.

## Acceptance

- [ ] CMS startup logs no `Couldn't load extensions` warnings
- [ ] All 22 hook extensions register their routes (probe at least: `/stripe/webhook` → 400 sig error, `/account/onboarding/state` → 401, `/wallet/balance` → 401)
- [ ] HTTP-level test `webhook-http.realdb.test.ts` actually runs (no auto-skip) — verify by inspecting test output
- [ ] No regression in extension build pipeline (`make ext` succeeds)
- [ ] No regression in runtime imports (production CMS image still functional after rebuild)
- [ ] Document the convention so the next shared lib added doesn't reintroduce the bug

## Estimate

1-2h for Option A. Most time is in confirming the Zod-accepted no-op manifest shape, generating the stub dist, and verifying production image rebuild.

## Dependencies

- Blocks browser verification of tasks 48 and 49 (and any future hook-endpoint task)
- Touches: `services/cms/extensions/local/_shared/`, `services/cms/extensions/local/project-extension-feature-gate/`
- Workaround currently in effect on dev CMS: both directories manually `mv`'d out of `/directus/extensions/` inside the running container. Will revert on next `make cms-restart`.

## Notes

- Production image in `infrastructure/coolify/` likely has the same issue; verify on next deploy.
- See task 48's HTTP test auto-skip behavior — that test should be tightened post-fix to fail loudly if the route isn't registered (currently it silently skips when CMS is unreachable, but the same skip path also triggers when extensions load but routes aren't registered, masking this exact failure mode).
