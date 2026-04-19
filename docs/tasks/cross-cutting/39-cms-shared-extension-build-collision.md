# 39. CMS `_shared` extension package collision — blocks Docker rebuilds

**Status:** planned
**Severity:** HIGH — blocks full CMS rebuild + browser verification of all Sprint B UI work (tasks 36, 37) and any future CMS extension ship
**Source:** Surfaced while verifying Sprint B tasks 36 + 37 (impl-37 report 2026-04-19)
**Blocks:** browser-QA of Sprint B, Sprint 3 production deploy (task 28)

## Problem

Full CMS Docker rebuild (`make cms-build` or `make cms-restart` cold) fails during extension install with a package name collision: `services/cms/extensions/local/_shared` defines a package named `directus-extension` — the same name as the placeholder package npm publishes at that exact name. npm's installer refuses to resolve the local path over the registry placeholder in the container build context.

Manifestation: the implementer for task 37 could not do browser verification of the onboarding wizard — Docker build did not complete, dev CMS was running on pre-Sprint-B image. Same for task 36's wallet dialog + banner.

## Diagnostic steps

1. `cat services/cms/extensions/local/_shared/package.json | jq .name` — confirm the package name field
2. `make cms-build` — reproduce the failure, capture the exact npm error
3. Check `services/cms/Dockerfile` + `services/cms/base/Dockerfile` — find where the `npm ci` / `npm install` for local extensions runs
4. Check `services/cms/extensions/package.json` — how are the 18 local extensions installed?

## Likely fixes (in order of preference)

1. **Rename the `_shared` package** from `directus-extension` to `@coignite/bl-cms-shared` or `project-shared-ui` (matches naming of sibling extensions). Update every importer inside `services/cms/extensions/local/*/package.json` that references `directus-extension` as a dep.
2. **Pin local path in lockfile** — force npm to resolve the local path, not the registry name. Usually achieved via `file:../_shared` in dependent package.json `dependencies` blocks.
3. **Move `_shared` out of `local/`** — if it's not a Directus extension but a shared helper package, relocate to `services/cms/extensions/shared/` (where `project-shared-ui` lives) and fix imports.

Likely option (1) is correct — it's a naming foot-gun inherited from legacy code.

## Acceptance

- `make cms-build` succeeds from a clean Docker state
- `make cms-restart` cold (not warm) completes and CMS becomes healthy
- All 18+ local extensions still build via `make ext`
- Existing Vitest suites across the affected extensions still pass
- Browser verification of Sprint B tasks 36 + 37 completes successfully

## Estimate

1–2 hours (name change + dependent import updates + rebuild verify).

## Follow-ups after fix

- Resume browser verification of cms/36 (wallet-settings-dialog, low-balance-banner) and cms/37 (onboarding wizard)
- Unblock Sprint 3 (production deploy) which requires a working CMS build pipeline
