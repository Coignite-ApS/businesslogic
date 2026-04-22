# `_shared/test-helpers`

Shared helpers for CMS-extension tests that hit the real dev Postgres / Directus stack.

## When to use

Import from here whenever your test needs:
- A knex or pg client for the dev Postgres (auto-skipping when the DB is unreachable).
- To create/cleanup throwaway accounts and test users (role/policy lookups by **name**, not hardcoded UUIDs).
- To call Directus over HTTP with a static bearer token.

Do **not** duplicate knex bootstrapping or copy these helpers into your extension — the whole point is a single source of truth for cross-environment test plumbing.

## Quick usage

```ts
import {
  getDb,
  getPgClient,
  createTestAccount,
  cleanupAccounts,
  createTestUser,
  lookupRoleIdByName,
} from '../../_shared/test-helpers/db.js';

import { getItems, directusReachable } from '../../_shared/test-helpers/directus.js';

const testAccountIds: string[] = [];
let db: any;

beforeAll(async () => {
  db = getDb(); // knex-style client
});

afterAll(async () => {
  await cleanupAccounts(db, testAccountIds);
  await db.destroy();
});

it('does something with real data', async () => {
  const accountId = await createTestAccount(db, `suite-name-${Date.now()}`);
  testAccountIds.push(accountId);
  // …exercise production code against accountId…
});
```

For raw `pg.Client` semantics (e.g. LISTEN/NOTIFY), swap `getDb()` for `getPgClient()` and `connect()` / `end()` yourself.

## Environment

Defaults target the local dev stack:
- Host `127.0.0.1`, port `15432`, DB/user/password `directus`
- Override via `TEST_DB_HOST` / `TEST_DB_PORT` / `TEST_DB_USER` / `TEST_DB_PASSWORD` / `TEST_DB_NAME`
- `DATABASE_URL` takes precedence over component vars when set
- Directus base URL via `TEST_DIRECTUS_URL` (default `http://localhost:18055`)
- Set `TEST_ALLOW_SKIP=1` to soft-skip when the DB is unreachable (useful locally; CI leaves it unset so unreachable DB fails loud).

## Why role/policy lookups are by name

UUIDs for `directus_roles` and `directus_policies` differ across CI, dev, and fresh-reset environments. Hardcoding them gives cryptic FK errors when they drift. Use `lookupRoleIdByName(db, 'Administrator')` instead.
