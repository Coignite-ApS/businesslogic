# 49. 🔴 P0: User role missing `PATCH /users/me` permission for metadata

**Status:** in-progress (automated tests pass; browser verification pending)
**Severity:** P0 — HIGH — onboarding wizard re-nags forever for any non-admin user
**Source:** ux-tester 2026-04-20 (Sarah persona, full report: `docs/reports/ux-test-2026-04-20-sarah-billing.md`)
**Blocks:** cms/37 onboarding wizard works only for admin users; Sprint 3 deploy inherits this bug

## Problem

Sprint B's cms/37 onboarding wizard calls (original):

```ts
// services/cms/extensions/local/project-extension-account/src/composables/use-onboarding.ts
await api.patch('/users/me', { metadata: { onboarding_state: { ... } } });
```

For admin users: succeeds. For default "User" role users: **403 Forbidden**. The Directus permission set for the User role doesn't include `directus_users.update` on the `metadata` field (or doesn't grant it at all).

Effect: onboarding state `wizard_completed_at` never persists for normal users → auto-redirect fires on every `/admin/account` visit → infinite wizard loop.

This was invisible in the 2026-04-19 browser QA because QA ran as admin. ux-tester 2026-04-20 exposed it by creating a fresh User-role account.

## Implementation (Path B — server-side endpoint)

Path (a) (SQL migration to directus_permissions) was skipped because it requires the db-admin gated workflow. Path (b) chosen for tighter scope and no permission-table changes.

### New endpoint

```
POST /account/onboarding/state
```

Lives in `services/cms/extensions/local/project-extension-account-api/src/index.ts`.

- Auth: requires `req.accountability.user` (401 if absent)
- Body: `{ intent_captured?, first_module_activated_at?, wizard_completed_at? }` — all optional
- Validation: rejects unknown keys with 400 (privilege-escalation guard)
- Behavior: reads current `directus_users.metadata` via knex (admin DB access), shallow-merges `onboarding_state`, writes back. Returns `{ ok: true, onboarding_state: { ...merged } }`
- Idempotent: repeat calls safe

### Wizard caller updated

`services/cms/extensions/local/project-extension-account/src/composables/use-onboarding.ts`:
- `_patchOnboardingState` now calls `api.post('/account/onboarding/state', patch)` instead of `api.patch('/users/me', { metadata: ... })`
- Read path (`fetchOnboardingState`) unchanged — still uses `GET /users/me?fields[]=metadata`

## Tests

New test file: `services/cms/extensions/local/project-extension-account-api/src/__tests__/onboarding-state.test.ts`

- [x] 401 when unauthenticated
- [x] 400 on unknown field (e.g. `role: 'administrator'`)
- [x] 400 when body mixes valid + unknown keys
- [x] 200 with `wizard_completed_at` — merges with null metadata
- [x] 200 idempotency — second call with same body returns 200, existing fields preserved
- [x] 200 with all three valid fields

All 9 tests pass (3 existing + 6 new).

## Acceptance

- [ ] Non-admin user completes onboarding wizard → `wizard_completed_at` persists (browser verification pending — pre-existing `_shared` manifest issue may block extension load in dev)
- [ ] Re-login → no auto-redirect to wizard (browser verification pending)
- [x] Other user metadata fields still locked — endpoint ONLY accepts `intent_captured`, `first_module_activated_at`, `wizard_completed_at`; unknown fields → 400. No changes to `directus_permissions` table — User role has no new broad `directus_users.update` grant
- [x] Integration test: POST /account/onboarding/state with valid body → 200
- [x] Integration test: POST /account/onboarding/state with `role` field → 400 (rejected at body validation)

Note: `PATCH /users/me` with `role` change was not tested here because that requires a standing Directus auth context; it is not in scope since we made no `directus_permissions` changes — the default restriction remains.

## Estimate

30min–1h depending on approach (simple permission grant vs dedicated endpoint).

## Dependencies

- Task 48 should ship first so webhook-driven subscription creation works; otherwise the wizard can't fully complete anyway. ✅ (already shipped)
