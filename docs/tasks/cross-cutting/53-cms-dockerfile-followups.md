# 53. CMS Dockerfile follow-ups (task 44 code review leftovers)

**Status:** planned
**Severity:** LOW — latent foot-guns + hygiene; no current breakage
**Source:** Task 44 code quality review 2026-04-20 (items I2, I3, M6)
**Depends on:** task 44 (shipped `d90082b`+`13fae8e`)

## Three separate items bundled for cheap parallel fixes

### I2 — `_shared` / shared-lib double-copy foot-gun

`services/cms/base/Dockerfile:99-105` (pre-seed loop) and `services/cms/base/docker/build-extensions.sh:35-39` BOTH run `cp -r "$d" "/directus/extensions/$name"` for shared libs. Second `cp -r` into an existing dir-tree succeeds silently — no `-n` / clobber guard. Works today (content is identical), but latent: if either path ever modifies shared-lib files mid-build, the second copy wins without warning.

**Fix options:**
- (A) Make pre-seed skip if `/directus/extensions/$name` already exists: `[ -d "/directus/extensions/$name" ] || cp -r ...`
- (B) Make `build-extensions.sh` skip the shared-lib copy when the dir is already populated.

Pick A (Dockerfile-side) — keeps the shell script generic.

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

- [ ] I2: `[ -d "/directus/extensions/$name" ] || cp -r ...` guard in Dockerfile pre-seed loop
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
