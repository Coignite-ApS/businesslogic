# 49. 🔴 P0: User role missing `PATCH /users/me` permission for metadata

**Status:** planned
**Severity:** P0 — HIGH — onboarding wizard re-nags forever for any non-admin user
**Source:** ux-tester 2026-04-20 (Sarah persona, full report: `docs/reports/ux-test-2026-04-20-sarah-billing.md`)
**Blocks:** cms/37 onboarding wizard works only for admin users; Sprint 3 deploy inherits this bug

## Problem

Sprint B's cms/37 onboarding wizard calls:

```ts
// services/cms/extensions/local/project-extension-account/src/composables/use-onboarding.ts
await api.patch('/users/me', { metadata: { onboarding_state: { ... } } });
```

For admin users: succeeds. For default "User" role users: **403 Forbidden**. The Directus permission set for the User role doesn't include `directus_users.update` on the `metadata` field (or doesn't grant it at all).

Effect: onboarding state `wizard_completed_at` never persists for normal users → auto-redirect fires on every `/admin/account` visit → infinite wizard loop.

This was invisible in the 2026-04-19 browser QA because QA ran as admin. ux-tester 2026-04-20 exposed it by creating a fresh User-role account.

## Fix

Grant the User role (or equivalent public-user-facing role) `update` permission on `directus_users` scoped to `self` (the user can only update their own row), with field-level permission for `metadata` column.

Via Directus admin UI:
1. Settings → Access Policies → Locate the default "User" policy (or whichever policy applies to new signups)
2. Permissions → `directus_users` → Update
3. Permissions rule: `{"id": {"_eq": "$CURRENT_USER"}}` (self-only)
4. Field permissions: allow `metadata`

Via migration (preferred for reproducibility):

```sql
-- migrations/cms/034_user_role_metadata_update_permission.sql
INSERT INTO public.directus_permissions (
  collection, action, permissions, fields, policy
) VALUES (
  'directus_users',
  'update',
  '{"id":{"_eq":"$CURRENT_USER"}}',
  'metadata',
  '<user-role-policy-id>'
);
```

Find the policy id via:
```sql
SELECT id, name FROM public.directus_policies;
```

Use db-admin for the migration (schema touch — Directus permissions are part of the Directus meta-schema).

## Alternative — server-side route

If per-role permission is too coarse, add a dedicated endpoint:

```
POST /account/onboarding/state
Body: { intent_captured?, first_module_activated_at?, wizard_completed_at? }
```

Handler validates + writes to `directus_users.metadata.onboarding_state` via an admin Directus service (bypasses user-role permission). Lives in `project-extension-account-api`.

This isolates the permission grant from the general User role.

## Acceptance

- [ ] Non-admin user completes onboarding wizard → `wizard_completed_at` persists
- [ ] Re-login → no auto-redirect to wizard
- [ ] Other user metadata fields still locked (user can't escalate privileges)
- [ ] Integration test: create user → PATCH /users/me with metadata → 200
- [ ] Integration test: create user → PATCH /users/me with `role` change → 403 (no privilege escalation)

## Estimate

30min–1h depending on approach (simple permission grant vs dedicated endpoint).

## Dependencies

- Task 48 should ship first so webhook-driven subscription creation works; otherwise the wizard can't fully complete anyway.
