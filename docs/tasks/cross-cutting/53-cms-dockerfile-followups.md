# 53. CMS Dockerfile follow-ups (task 44 code review leftovers)

**Status:** planned (I2 **superseded by task 54**; I3 + M6 still open)
**Severity:** LOW — latent foot-guns + hygiene; no current breakage
**Source:** Task 44 code quality review 2026-04-20 (items I2, I3, M6)
**Depends on:** task 44 (shipped `d90082b`+`13fae8e`)

## Three separate items bundled for cheap parallel fixes

### I2 — `_shared` / shared-lib double-copy foot-gun — **SUPERSEDED by task 54**

Original concern: pre-seed loop and `build-extensions.sh` both `cp -r` shared libs into `/directus/extensions/`, silently double-copying.

**Status:** moot. Task 54 is a P0 fix for a much worse symptom of the same underlying structural issue — Directus 11.16 strict-fails when ANY `/directus/extensions/*` dir lacks `directus:extension` manifest, silently disabling ALL hook extensions. Task 54's recommended Option A (add no-op `directus:extension` manifests to `_shared` + `feature-gate`) converts both dirs to real Directus extensions, which makes the double-copy concern irrelevant (they'd no longer be special-cased).

If task 54 ships with Option B/C (moving shared libs out of `/directus/extensions/` entirely, or post-build cleanup), I2 also becomes moot because the pre-seed loop would be removed or refactored.

→ Close I2 when task 54 ships. No independent work needed.

### I3 — Hardcoded `bl-widget`; other `file:packages/*` deps silently fail

`services/cms/base/Dockerfile:78-81` copies ONLY `bl-widget` from the `packages` build context. Any future extension that adds `"@businesslogic/<other>": "file:../../../../../packages/<other>"` will hit the same npm arborist error that task 44 fixed — with no guard or clear error message.

**Fix options:**
- (A) Broaden: `COPY --from=packages --chown=node:node . /packages` with a `.dockerignore` inside `packages/` excluding `*/node_modules` and `*/src` and `*/test`.
- (B) Add a CI/Makefile smoke that greps extension package.json files for `file:../../../../../packages/` and fails if any dep references a package not copied in the Dockerfile.
- (C) Document convention in `CLAUDE.md`: "any new `file:packages/X` dep requires a matching `COPY --from=packages X/package.json + X/dist` in base/Dockerfile."

Pick B for low-risk enforcement + C for docs. A increases image size.

### M6 — No smoke test for CMS image rebuild

The image build has no automated verification. Regression (another `file:` escape, a removed extension, a broken `build-extensions.sh` path) only surfaces on the next manual rebuild.

**Fix:** add a Makefile target `make verify-cms-image` that:
```makefile
verify-cms-image:
    docker compose -f infrastructure/docker/docker-compose.dev.yml build --no-cache bl-cms
    docker run --rm --entrypoint sh businesslogic-bl-cms:latest -c 'ls /directus/extensions | wc -l' | awk '{ if ($$1 < 20) { print "ERROR: fewer than 20 extensions"; exit 1 } else { print "OK: " $$1 " extensions" } }'
```

Wire into CI (Buddy pipeline from task 35) so image breakage surfaces on PR, not on deploy day.

## Key Tasks

- [x] ~~I2: `[ -d "/directus/extensions/$name" ] || cp -r ...` guard~~ — superseded by task 54
- [ ] I3: Makefile/CI grep for `file:../../../../../packages/` in extension package.json, cross-check against Dockerfile COPY list
- [ ] I3: Add convention doc paragraph in `CLAUDE.md` under "Directus CMS Structure"
- [ ] M6: `make verify-cms-image` + wire into Buddy CI

## Acceptance

- I2: pre-seed skip guard in place; rebuild verified
- I3: CI fails if a new `file:packages/X` dep lacks matching Dockerfile COPY
- M6: `make verify-cms-image` returns 0 on current main, would return non-zero if an extension were deleted or build broken

## Estimate

2-3 hours total (I2: 15min · I3: 1h · M6: 1h).

## Notes

Task 44 shipped with I1 (image bloat) fixed. I2/I3/M6 are hygiene, not blockers for Sprint 3.
