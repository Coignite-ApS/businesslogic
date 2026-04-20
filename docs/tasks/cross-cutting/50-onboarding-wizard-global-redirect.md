# 50. 🟠 P1: Onboarding auto-redirect only fires from Account module, not global

**Status:** planned
**Severity:** P1 — activation funnel broken — first-time users land on raw Directus content table instead of wizard
**Source:** ux-tester 2026-04-20 (Sarah persona, full report: `docs/reports/ux-test-2026-04-20-sarah-billing.md`)
**Blocks:** activation funnel Score(I) stays below 3/5 until fixed

## Problem

Sprint B's cms/37 places the auto-redirect logic in the Account module's `onMounted`:

```ts
// services/cms/extensions/local/project-extension-account/src/routes/module.vue
onMounted(() => {
  if (needsWizard.value) router.push('/admin/account/onboarding');
});
```

This only fires when the user navigates TO `/admin/account` or lands there. A fresh signup lands on Directus's default module (typically `/admin/content/calculators` or similar), NOT on account. So the redirect never triggers.

Sarah's observed experience:
1. Signed up
2. Auto-logged in to Directus admin
3. Landed on `/admin/content/calculators` — a raw Directus collection table (empty)
4. Confused — no welcome, no wizard, no guidance
5. Had to discover the Account module in the sidebar to trigger the redirect

Result: Accept Criterion #1 of subscription-activation flow FAILS by design for >90% of new users.

## Fix options

### Option A — Directus `auth.login` hook (preferred)

Create a hook in a cms-service extension that fires on successful login:

```ts
// services/cms/extensions/local/project-extension-account-api/src/hooks/onboarding-redirect.ts
export default ({ action }, { services }) => {
  action('auth.login', async ({ user, request, response }) => {
    const metadata = user?.metadata || {};
    if (!metadata.onboarding_state?.first_module_activated_at) {
      // Can the hook set a redirect header? Depends on Directus hook API.
      // Alternative: set a flag on the user that the frontend reads.
    }
  });
};
```

Caveat: Directus auth hooks may not be able to intercept the POST-login redirect destination. Test first; if not feasible, use Option B.

### Option B — Global Vue route guard in a custom module

Create a tiny extension whose sole job is to register a global Vue Router `beforeEach` guard that runs on every navigation and checks onboarding state.

```ts
// services/cms/extensions/local/project-extension-onboarding-redirect/src/index.ts
import { defineModule } from '@directus/extensions-sdk';

export default defineModule({
  id: 'onboarding-redirect',
  // ...no UI; just a router.beforeEach hook registered on module activation
  setup(router, userStore) {
    router.beforeEach((to, from, next) => {
      const user = userStore.currentUser;
      const state = user?.metadata?.onboarding_state;
      const needsWizard = !state?.first_module_activated_at && !state?.wizard_completed_at;
      if (needsWizard && to.path !== '/admin/account/onboarding' && !to.path.startsWith('/admin/auth')) {
        next('/admin/account/onboarding');
      } else {
        next();
      }
    });
  }
});
```

Module extensions have limited access to the Vue router. If not feasible, fall back to Option C.

### Option C — Move redirect to App-level module (simplest)

Some Directus extensions expose an app-level hook (`app.before`). The account extension may already have this — add the redirect logic there instead of `module.vue`'s `onMounted`.

### Option D — Accept current behavior, improve onboarding discoverability

If global redirect is not cleanly achievable in Directus 11, accept that the wizard is only reached via `/admin/account`, and improve discoverability:
- Add a persistent top-nav banner for users with unfinished onboarding: "Complete onboarding to activate your first module →"
- Add "Getting Started" as the first sidebar item for unfinished users
- Send a welcome email with a direct link to `/admin/account/onboarding`

## Acceptance

- [ ] Fresh signup + first login → redirect to `/admin/account/onboarding` happens regardless of default landing path
- [ ] Subsequent logins (post-activation) don't redirect
- [ ] Direct navigation to any URL during onboarding-needed state → redirect still fires

## Estimate

2-4h depending on which option works in Directus 11. Option A is cleanest if the hook API allows it; Option D is the reliable fallback.

## Dependencies

- Task 49 (user role metadata permission) — without it, state can't persist, so redirect would loop forever even if correct
- Task 48 (webhook pipeline) — without it, `first_module_activated_at` never fires after Checkout
