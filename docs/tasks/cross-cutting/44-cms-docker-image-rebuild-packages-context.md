# 44. CMS Docker image rebuild — fix `packages/bl-widget` outside build context

**Status:** completed 2026-04-20 — Option A applied (additional_contexts + Dockerfile COPY --from=packages). Local build verified at commit `d90082b` on `dev`.
**Severity:** HIGH (required before Sprint 3 production deploy; dev unaffected)
**Source:** Split from [cross-cutting/39](./39-cms-shared-extension-build-collision.md) investigation 2026-04-19
**Blocks:** Sprint 3 (production deploy)

## Problem

`services/cms/extensions/local/project-extension-ai-assistant/package.json` depends on:

```json
"@businesslogic/widget": "file:../../../../../packages/bl-widget"
```

The relative path escapes the Dockerfile build context (which is `services/cms/`). When `build-extensions.sh` runs `npm install` in the container, it can't resolve the `file:` path → npm fails with `Cannot read properties of undefined (reading 'extraneous')`.

Dev works fine because host bind mounts expose the full repo tree. Production image rebuild (and CI image builds) fail.

This pre-dates Sprint B. Task 39's partial fix got past `_shared` but hit this next.

## Required behavior

`docker compose -f infrastructure/docker/docker-compose.dev.yml build --no-cache bl-cms` must succeed and produce a container that boots healthy with all 21 extensions loaded.

## Fix options (pick one)

### Option A — Docker Compose `additional_contexts` (recommended)

Docker Compose 2.17+ supports named additional build contexts. Update:

```yaml
# infrastructure/docker/docker-compose.dev.yml
bl-cms:
  build:
    context: ../../services/cms
    additional_contexts:
      packages: ../../packages
    dockerfile: base/Dockerfile
```

Then in `services/cms/base/Dockerfile`:

```dockerfile
# Copy bl-widget from the named packages context
COPY --from=packages --chown=node:node bl-widget /packages/bl-widget
```

And adjust `build-extensions.sh` to symlink or copy `/packages` into each extension's ancestor chain before `npm install`. Or better: rewrite the `file:` dep resolution by pre-creating the expected relative path.

Simplest: after `COPY --from=packages`, create `/directus/extensions/packages` symlink so the `../../../../../packages/bl-widget` path from `/directus/extensions/$name/` resolves correctly: up 5 = `/` — need `/packages/bl-widget` to be findable. `COPY --from=packages bl-widget /packages/bl-widget` achieves exactly that.

Pros: minimal change; preserves current Dockerfile structure.
Cons: requires Docker Compose 2.17+ (check local + CI).

### Option B — Change build context to repo root

Update docker-compose.dev.yml: `context: ../../` and adjust every COPY in Dockerfile by prefixing with `services/cms/`. Larger blast radius.

### Option C — Publish `@businesslogic/widget` to npm

Publish to public or private registry. Change extension dep from `file:...` → semver range. Cleanest long-term for the widget package (already has a public GPL-3.0-only license).

Requires: npm publishing pipeline setup, version management, release workflow. Larger scope.

### Option D — Vendor `bl-widget/dist` into the extension

Copy `packages/bl-widget/dist/` into `services/cms/extensions/local/project-extension-ai-assistant/vendor/bl-widget/` and change imports to use the vendored path. No `file:` dep; no external context needed.

Technical-debt: duplicates the built artifact. But unblocks immediately. Good interim if Option A's Compose version check fails.

## Recommendation

**Option A first.** If Compose 2.17+ is available (check `docker compose version` locally + in CI runner), use it. Minimal, surgical, preserves architecture.

If not: **Option D** as interim + file a cleanup task to move to Option A or C later.

## Implementation (Option A)

1. Bump Docker Compose requirement if needed (document in CONTRIBUTING.md)
2. Add `additional_contexts: { packages: ../../packages }` to bl-cms build
3. Add `COPY --from=packages --chown=node:node bl-widget /packages/bl-widget` in Dockerfile BEFORE the `RUN /directus/docker/build-extensions.sh /tmp/project-extensions` step
4. Add a final cleanup `RUN rm -rf /packages` after all extensions built (optional — it's tiny)
5. Test: `docker compose -f infrastructure/docker/docker-compose.dev.yml build --no-cache bl-cms`
6. Verify: container boots healthy, 21 extensions loaded, curl /server/ping returns 200

## Acceptance

- `docker compose build --no-cache bl-cms` succeeds
- Rebuilt image boots healthy
- All 21 extensions loaded (check `Loaded extensions:` log line)
- Sprint B dev functionality unchanged
- Browser QA of cms/36 + cms/37 completes against the rebuilt image
- Sprint 3 production deploy path unblocked

## Estimate

2-4 hours (mostly testing + verifying Compose version compatibility).

## Dependencies

- None — purely a Docker build-context fix.

## Notes

- `packages/bl-widget/dist/` is checked into git (built artifact), so the COPY has something to find. If this changes later, the Dockerfile should build bl-widget first.
- Only `project-extension-ai-assistant` uses `file:packages/`. If other extensions add similar deps later, the pattern extends naturally.
