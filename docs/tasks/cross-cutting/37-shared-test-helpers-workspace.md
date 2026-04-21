# 37. Extract shared test helpers (pricing v2 realdb tests)

**Status:** completed 2026-04-21 — helpers live under `services/cms/extensions/local/_shared/test-helpers/` (not `packages/bl-test-helpers`; see "Landing location" below).
**Severity:** LOW — hygiene / maintainability
**Source:** Task 26 code review (commit `dd75873`) — issues I2, I3, I4

## Resolution (2026-04-21)

Shipped on `dm/task-37-shared-test-helpers`:
- Moved `_shared/__tests__/helpers/` → `_shared/test-helpers/` (promoted out of the per-suite `__tests__` dir so sibling extensions can import it).
- Added `lookupRoleIdByName()` and `lookupPolicyIdByName()` helpers. `createTestUser()` defaults to name-based lookup ("User"); callers can override.
- Added `getPgClient()` helper for tests that prefer raw `pg.Client` over knex (`refresh-quotas.integration.test.ts`).
- Refactored 4 stripe tests to import shared helpers, deleting duplicate knex/pg bootstraps and local `createTestAccount`:
  - `wallet-flow.realdb.test.ts`
  - `multi-module-subs.realdb.test.ts`
  - `auto-reload-consumer.realdb.test.ts` (bonus — task doc called out 2, but this one had the same pattern)
  - `refresh-quotas.integration.test.ts` (ported from raw `pg` import to `getPgClient()` helper)
- Refactored `webhook-http.realdb.test.ts` similarly.
- Replaced 2 hardcoded UUIDs in `account-isolation.e2e.test.ts` (Administrator role, User Access policy) with name lookups.
- Removed `knex` + `pg` from `project-extension-stripe/devDependencies` + regenerated `package-lock.json` (knex remains as transitive via `@directus/extensions-sdk`, which is expected).
- Added `_shared/test-helpers/README.md` documenting the pattern + env overrides.

Tests: 150/150 stripe (incl. 15 realdb live + 3 integration live) · 37/37 _shared · full calculator-api and ai-api/knowledge-api builds still clean.

### Landing location — why `_shared/test-helpers/` and not `packages/bl-test-helpers`

The repo has no root npm workspace; `packages/` is reserved for publishable libs (`@coignite/bl-events`, `@coignite/bl-sdk`, `@coignite/bl-widget`). Cross-extension code reuse inside the CMS is already done via `_shared/` with relative imports (`../../_shared/v2-subscription.js`). Test helpers follow that same pattern — dev-only, not published, imported by relative path. Fewer moving parts than a standalone package; zero bundler coupling to Rollup's Directus build.

---

## Original problem statement (preserved for reference)

## Problem

Task 26 added 3 new test files that hit real Postgres / Directus:
- `services/cms/extensions/local/_shared/__tests__/account-isolation.e2e.test.ts`
- `services/cms/extensions/local/project-extension-stripe/__tests__/wallet-flow.realdb.test.ts`
- `services/cms/extensions/local/project-extension-stripe/__tests__/multi-module-subs.realdb.test.ts`

The Stripe tests each duplicate `getDb()` / knex setup / `createTestAccount()` that already exist in `_shared/__tests__/helpers/db.ts`. Two separate `node_modules` trees install knex 3.x + pg. Divergence risk as tests are added.

Additionally, the isolation test has 3 hardcoded Directus role/policy UUIDs (User role, Administrator role, User Access policy) that differ across environments — failures in CI or a reset dev DB would produce cryptic FK errors.

## Required work

### 1. Promote helpers to a workspace package

Create `packages/bl-test-helpers/` (TypeScript) exposing:
- `getDb(): Knex` — project-wide test pg connection
- `createTestAccount(db, name): Promise<string>` — returns account UUID
- `createTestUser(db, { accountId, role }): Promise<{ userId, token }>` — with dynamic role lookup
- `cleanupAccounts(db, ids[]): Promise<void>` — CASCADE-aware cleanup, including `directus_users.active_account` FK
- `directusReachable(): Promise<boolean>`
- `http(url, opts): Promise<Response>` — fetch wrapper

Wire it as a workspace dep in the top-level `package.json` so all extensions can `import` from `@businesslogic/test-helpers`.

### 2. Role / policy lookup by name

Replace hardcoded UUIDs with at-startup lookups:

```ts
const userRole = await db('directus_roles').where('name', 'User').first();
if (!userRole) throw new Error('Expected "User" role not found — seed CMS first');
```

Makes failures self-describing and eliminates dev-vs-CI drift.

### 3. Update existing test files

- `account-isolation.e2e.test.ts`: use the shared helper; look up role/policy by name.
- `wallet-flow.realdb.test.ts`: delete duplicate knex config; import `getDb` + `createTestAccount`.
- `multi-module-subs.realdb.test.ts`: same.
- `project-extension-stripe/package.json`: remove `knex` + `pg` from devDeps (inherited via workspace).

### 4. Document the pattern

Short section in repo docs (or `CONTRIBUTING.md`) on "writing tests that hit real Postgres" using the shared helpers.

## Acceptance

- Three test files import from the same workspace package.
- No hardcoded role/policy UUIDs in test files.
- `knex` + `pg` installed once, not per-extension.
- All existing test counts preserved; no new flakes.

## Dependencies

- Task 26 shipped.
- Blocked by: nothing; can be done standalone.

## Use

Code refactor only — no schema, no CI changes. Safe to parallelize with other follow-ups.
