# 37. Extract shared test helpers (pricing v2 realdb tests)

**Status:** planned
**Severity:** LOW — hygiene / maintainability
**Source:** Task 26 code review (commit `dd75873`) — issues I2, I3, I4

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
