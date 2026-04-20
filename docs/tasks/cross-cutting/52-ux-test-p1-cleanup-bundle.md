# 52. 🟡 P1 bundle: Post-Sprint-B UX cleanup (from ux-tester 2026-04-20)

**Status:** planned
**Severity:** P1 (bundled polish) — each item LOW individually, but together they degrade Sprint B's perceived quality
**Source:** ux-tester 2026-04-20 (Sarah persona, full report: `docs/reports/ux-test-2026-04-20-sarah-billing.md`)

## Bundle rationale

Individual P1 items found during the Sprint B ux test. Bundled because each is small (<1h) and they share the same test setup. Fix together for efficiency.

## Items

### 52.1 — Top-up entry-point inconsistency

- **From:** AI Assistant low-balance banner → "Top up" button → dialog with €20/€50/€200 quick-amounts
- **From:** Subscription page AI Wallet card → "Top up" button → **immediately goes to Stripe Checkout for €20** (no amount selection)

Users landing from the subscription-page path get €20 regardless of intent. Different entry → different UX.

**Fix:** make the subscription-page "Top up" button open the same top-up dialog with quick-amounts. Shared composable / dialog component already exists — just wire it.

File: `services/cms/extensions/local/project-extension-account/src/routes/subscription.vue` → wallet card button handler.

### 52.2 — User role missing AI collections permissions

Non-admin users get 500s from AI Assistant backend because their role lacks read permission on:
- `ai_prompts`
- `ai_conversations`

The AI Assistant loads these on module open. Without permissions, requests 500, and the UI shows raw "Request failed with status code 403".

**Fix:** grant User role `read` on `ai_prompts` + `ai_conversations` filtered by `account_id = $CURRENT_USER.active_account` (standard account-scoped pattern, same as task 38's KB fixes).

Migration via db-admin following task 38's pattern.

### 52.3 — `account` collection ghost `subscriptions` field crashes reads

The `account` Directus collection has a relational field pointing to `subscriptions`, but when `subscriptions` was restructured in Sprint 1 (task 18), the FK column name diverged. Directus's account list view now crashes trying to render the relation for new accounts.

**Fix:** inspect `directus_fields` for the `account` collection's subscriptions relation:
```sql
SELECT * FROM directus_fields WHERE collection = 'account' AND field LIKE '%subscription%';
```
Either fix the schema definition or remove the field if it's no longer used.

Migration via db-admin.

### 52.4 — Raw 403 error copy

When permissions fail, the frontend shows strings like `Request failed with status code 403` as-is. User has no idea what happened.

**Fix:** global error handler in Directus extensions that translates 4xx axios errors to human copy:
- 403 → "You don't have permission to view this. Contact your account admin."
- 401 → "Your session expired. Please log in again."
- 404 → "Not found — this page or data may have been removed."
- 500 → "Something broke on our side. The team has been notified."

Likely a shared utility or a pinia action wrapper. Look at `services/cms/extensions/local/_shared/` for existing error-handling helpers before creating new ones.

## Acceptance

- [ ] 52.1: Both entry points lead to quick-amount dialog; dialog → Checkout with selected amount
- [ ] 52.2: Non-admin user can open AI Assistant without 500s (permissions granted)
- [ ] 52.3: account list view loads for a new account with no subscriptions (no crash)
- [ ] 52.4: 403/401/404/500 errors show human-readable messages in 3+ places tested
- [ ] All changes verified live via `/ux-tester` re-run after fixes

## Estimate

3-4h total (bundled). Split:
- 52.1: 30min (UI wiring)
- 52.2: 1h (db-admin migration + permission grants)
- 52.3: 1h (inspect + fix Directus field definition)
- 52.4: 1-1.5h (error handler utility + 3-4 integration points)

## Dependencies

- **Run after:** tasks 48 (webhook), 49 (metadata perm), 50 (redirect), 51 (return URLs) — those are P0s; this is polish on top
