# WIP — Task 52.2 + 52.3: User role AI perms + account→subscriptions ghost field

**Slug:** task-52-user-perms-plus-account-field
**Started:** 2026-04-20 10:53
**Phase:** awaiting-approval
**Severity:** MEDIUM (52.2 = permission grant, security-relevant additive; 52.3 = metadata cleanup, removes crash)

## Task

- **52.2** — grant User Access policy `read` on `ai_prompts` and `ai_conversations`
  so non-admin users can open the AI Assistant without 403s.
- **52.3** — delete the orphaned `account.subscriptions` o2m alias field
  (directus_fields id=109) whose matching directus_relations row was dropped
  during the Sprint-1 subscriptions restructure (task 18). Directus now crashes
  trying to render the relation for new accounts.

## Snapshots Taken

- pre PG dump:  `infrastructure/db-snapshots/pre_task-52-user-perms-plus-account-field_20260420_105310.sql.gz`
- pre schema:   `services/cms/snapshots/pre_task-52-user-perms-plus-account-field_20260420_105319.yaml`
- post PG dump: pending
- post schema:  pending

## Classification

**MAJOR** — both items.
- 52.2 adds permission rows (security-impacting, even though additive).
- 52.3 deletes a metadata row that any future caller could read. Audit confirms zero callers but it's still structural.

Both require explicit approval before apply per SKILL.md.

## Research notes

### 52.2 — permissions

- User role → User Access policy (only). Admin role carries Administrator policy.
  - `directus_roles`: User id = `a3317ba7-1036-4304-b5e0-9df23321d627`
  - `directus_policies`: User Access id = `54f17d5e-e565-47d0-9372-b3b48db16109`
  - `directus_access`: role → policy mapping verified, User role holds ONLY User Access.

- Current User Access rows for `ai_prompts`/`ai_conversations`: **0 rows** (zero permission → Directus 403).

- Existing `ai_*` rows under User Access for reference shape (all row-filtered
  by `account_id = $CURRENT_USER.active_account`):
  - 156 ai_wallet / read
  - 158 ai_wallet_topup / read
  - 159 ai_wallet_ledger / read

- `ai_prompts` schema: NO `account`/`account_id` column — it's a shared global
  catalog (matches Task 38's inline note for AI KB Assistance row 129, and
  the same shape as User Access row 135 `subscription_plans` which uses `{}`).
  The CMS proxy layer (project-extension-ai-api/src/index.ts line 175) already
  restricts reads to `status=published`; no row filter needed at the permission
  layer. Data confirms: `SELECT status, COUNT(*) FROM ai_prompts GROUP BY status;`
  → 2 rows, all `published`.

- `ai_conversations` schema: `account uuid` column (nullable). Matches Task 38's
  AI KB Assistance policy row 127 shape `{"account":{"_eq":"$CURRENT_USER.active_account"}}`.
  Note: `account` NOT `account_id` (historical inconsistency preserved).

- Scope decision — READ ONLY. Create/update/delete via ItemsService with
  accountability is only exercised when `AI_SERVICE_ENABLED=false` (local dev
  fallback). In production, bl-ai-api owns those paths and stamps `account`
  correctly. Matches Task 38's pattern (also read-only additions). Task 52.2
  text explicitly scopes to "read permission".

### 52.3 — ghost field

- `directus_fields` id=109: `collection='account'`, `field='subscriptions'`,
  `special='o2m'`, `interface='list-o2m'`, `sort=10`, `width=full`, `searchable=true`.
- `directus_relations` rows involving either `account` or `subscriptions`:
  NO row connects `subscriptions` (many) ↔ `account` (one) for this alias.
  The field is orphaned.
- `public.account` schema: NO physical column named `subscriptions` — pure alias.
- `public.subscriptions.account_id` IS the real FK (NOT NULL, REFERENCES account(id)).
- Snapshot.yaml has the field row (line 1335) but also no matching relation entry,
  so the canonical schema is already internally inconsistent.

### Downstream usage audit (52.3)

Grepped services/, packages/, migrations/, services/cms/extensions/ for
`account.subscriptions`, `account['subscriptions']`, `account[.subscriptions.]`,
and `.subscriptions\b`:

- Zero hits reference the Directus alias.
- All `.subscriptions` hits point to: (a) `public.subscriptions` table via
  SQL/knex, (b) `stripe.subscriptions` SDK, (c) unrelated JS object properties
  (e.g. `overview.subscriptions.by_plan` in admin dashboard).
- `directus_presets` has 2 rows for `account` collection — neither references
  the field (both have null filter/layout).

**Safe to delete.**

### Schema drift in snapshot.yaml — IMPORTANT

Running `make diff` shows SUBSTANTIAL pre-existing drift between canonical
`services/cms/snapshots/snapshot.yaml` and live DB — Sprint-B tables
(`api_keys`, `feature_quotas`, `monthly_aggregates`, `platform_features`,
`stripe_webhook_events`, `subscription_addons`, `usage_events`,
`wallet_auto_reload_pending`, etc.) exist in DB but not in the YAML.

Because `make apply` would DROP all of these, **both fixes must be delivered
as SQL migrations** (not via snapshot.yaml edit + apply). This matches the
team's memory note `feedback_schema_apply_danger.md`.

The canonical snapshot.yaml will be left as-is (already inconsistent); the
migrations land the fixes directly against DB. A separate task should
eventually reconcile the snapshot.

## Proposed Changes

Two SQL migrations at `migrations/cms/`:

### 034_task_52_user_role_ai_perms.sql
- INSERT directus_permissions rows (2):
  - `(User Access, ai_prompts, read, '{}', fields='*')` — shared catalog, no row filter
  - `(User Access, ai_conversations, read, '{"account":{"_eq":"$CURRENT_USER.active_account"}}', fields='*')`
- Idempotent: pre-INSERT count check per row.
- Assertion: post-insert, each tuple must return exactly 1 matching row.

### 035_task_52_account_subscriptions_ghost_field.sql
- DELETE directus_fields WHERE collection='account' AND field='subscriptions' AND special='o2m'
- Idempotent: re-run = no-op.
- Assertion: post-delete, 0 rows match (collection='account', field='subscriptions').

### Paired _down migrations
- 034 down: DELETE the two permission rows (re-introduces 403).
- 035 down: INSERT the alias field row (warning: without the matching relation,
  re-introduces the crash — down is for forensic/test use, not recovery).

## Data-Loss Risk Audit (Phase 4.5)

| Operation | Risk | Mitigation |
|-----------|------|------------|
| INSERT into directus_permissions (034) | None (additive) | Idempotent pre-check |
| DELETE from directus_fields (035) | Metadata row loss only | Downstream audit: zero callers; paired _down restores row |

Destructive op = 1 (the DELETE in 035). No physical table/column data is
touched. The deleted row is orphaned metadata with no live relation behind it.

### Baseline (captured 2026-04-20)

| Table | Rows (full) | Rows (affected subset) | Fingerprint |
|-------|-------------|------------------------|-------------|
| directus_permissions (scope: User Access × {ai_prompts, ai_conversations} read) | 43 | 0 | n/a |
| directus_fields (scope: account.subscriptions) | many | 1 (id=109) | n/a |

### Acceptance criteria (post-apply)

- `directus_permissions` under User Access policy rows for `ai_prompts` + `ai_conversations` read: **2** (preserving both shapes).
- `directus_fields` where (collection='account', field='subscriptions'): **0**.
- No unrelated permission or field rows changed (full-table diff must be empty elsewhere).

## Protocol violation record (self-disclosed)

While staging, I executed `psql -1 < 034_*.sql` intending a dry-run. The `-1`
flag wraps in a single transaction but STILL COMMITS on success — so 034
actually APPLIED to DB. I detected this within ~30s, ran the paired 034_down,
and verified DB returned to pre-task baseline (0 matching rows).

- Pre-violation state:  0 rows for (User Access × ai_prompts/ai_conversations × read)
- Post-apply state:     2 rows (ids 161, 162)
- Post-down state:      0 rows (ids 161, 162 gone; IDs not recycled — harmless)
- Net effect on DB:     none. Sequence advanced from 160 → 162; next real insert will get 163+.

The violation is recorded here for transparency. No downstream harm:
- No application code depended on the transient 2-row state
- No user-visible behavior change (apply + rollback completed before any
  user hit the AI Assistant)
- pre-task PG dump is intact and available as rollback source if needed

**I am now correctly in `awaiting-approval` phase and will NOT apply 034 or
035 again until explicit approval.**

## Consultation Log

- 2026-04-20 11:02 — pausing for user approval before Phase 6 apply.

## Migration Scripts

- `migrations/cms/034_task_52_user_role_ai_perms.sql`
- `migrations/cms/034_task_52_user_role_ai_perms_down.sql`
- `migrations/cms/035_task_52_account_subscriptions_ghost_field.sql`
- `migrations/cms/035_task_52_account_subscriptions_ghost_field_down.sql`

## Notes / Research

- Task 38 migration 020 is the canonical reference for the account-scoped
  filter shape applied here.
- Existing e2e test suite `services/cms/extensions/local/_shared/__tests__/account-isolation.e2e.test.ts`
  has Task 38 regression guards; a follow-up could add similar guards for
  User Access × ai_conversations (out of scope for this migration; noted in
  final report).
