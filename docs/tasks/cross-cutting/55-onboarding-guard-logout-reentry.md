# 55. 🟡 P2: Onboarding guard stale-closure on logout → re-login in same tab

**Status:** completed
**Severity:** P2 — edge case, affects users who log out + log in as a different account in the same browser tab without refreshing
**Source:** code review on task 50 (2026-04-20)

## Problem

`registerOnboardingGuard(router, needsWizardRef)` in `services/cms/extensions/local/project-extension-account/src/composables/use-onboarding.ts` captures the `needsWizard` ref by reference. Each `useOnboarding(api)` call creates its own `state` ref + `needsWizard` computed.

Flow that breaks:
1. User A mounts `onboarding.vue` → guard captures A's `needsWizard` ref.
2. User A completes wizard → guard stops redirecting (correct).
3. User A logs out → still same tab, same router, same guard.
4. User B logs in → lands on default page; their `useOnboarding(api)` creates a NEW ref.
5. Guard still holds User A's (now-stale) ref → reads `false` → lets User B through without redirect even if B needs the wizard.

Task 54's Part A (server-side `filter('auth.login')`) covers criterion #1 for User B's fresh signup if their role is filter-triggered, but the client guard is permanently compromised in-tab.

## Fix options

### Option A — Stateless getter pattern
Change signature to accept a getter callback:
```ts
registerOnboardingGuard(router, () => needsWizardForCurrentUser());
```
Guard looks up live state each navigation. Caller owns the lookup path.

### Option B — Bind to current user-id
Guard checks `userStore.currentUser?.id` against the id captured at registration. If they diverge, `_removeGuard()` and skip.

### Option C — Explicit teardown on logout
Find/create a hook that fires on logout and call `_removeGuard()`. Directus 11 does not expose a public logout hook client-side; may need to patch into the user store.

## Acceptance

- [x] After logout → re-login as a different user, the guard correctly reflects the new user's `needsWizard` state
- [x] No stale-closure lingers across user switches in the same tab
- [x] Existing tests still pass; add regression test for cross-user guard behavior

## Implementation notes (2026-04-20)

- `registerOnboardingGuard` signature changed: `Ref<boolean>` → `() => boolean`
- Pure helper `needsOnboardingWizard(onboardingState)` extracted to `src/utils/onboarding-needed.ts`; used by `useOnboarding` computed and by both callers
- Both callers (`onboarding.vue`, `module.vue`) updated to pass `() => needsWizard.value`
- Tests: 65 passing (was 53). New tests: `needsOnboardingWizard` suite (4), user-switch regression, getter-evaluated-fresh regression

## Estimate

1-2h — most time is in simulating the cross-user flow in a test harness.

## Dependencies

- Task 50 (which introduced the guard)

## Notes

Reviewer verdict on task 50: "Merge-blockers: none" — this edge case was explicitly deferred. Safe to park until logout-driven QA surfaces it in practice.
