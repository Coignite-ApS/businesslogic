# 37. Pricing v2 — Empty-trial onboarding wizard (post-signup module picker)

**Status:** planned
**Severity:** MEDIUM — empty trial may hurt activation if users don't know what to do first
**Source:** Locked decision in `/Users/kropsi/.claude/plans/schema-15-stripe-enumerated-hippo.md` ("Empty trial may hurt activation if users don't know to activate"); flagged as risk in task 14 plan §"Risks"

## Problem

Pricing v2 ships with an **empty trial** model: signup creates an account + €5 AI Wallet credit, **no subscriptions**. User must explicitly activate at least one module (Calculators, KB, or Flows) to do anything billable. Each module gets its own per-module 14-day trial when activated.

Without guidance, a fresh signup lands in the Directus admin and sees no obvious next step. Activation rates may suffer.

## Required UX

A post-signup wizard that introduces the user to the platform and helps them activate their first module:

### Step 1 — Welcome + intent capture
- "Welcome to BusinessLogic. What brings you here?"
- Tile-based picker:
  - "I have an Excel calculator I want to expose as an API" → routes to Calculators activation
  - "I want to build a Knowledge Base for AI Q&A" → routes to KB activation
  - "I want to automate workflows with AI" → routes to Flows activation
  - "I'm not sure yet — show me around" → routes to a tour mode

### Step 2 — Module-specific quick-start
For each module, show:
- What this module does (1 paragraph + screenshot)
- 14-day free trial (no card needed during trial)
- Pricing after trial (Starter tier price + what's included)
- "Activate Calculators Starter trial" button → opens Stripe Checkout with `trial_period_days: 14`
- Skip link → "Maybe later"

### Step 3 — Confirmation + first-task prompt
After successful activation:
- "🎉 Calculators is active for 14 days"
- Wallet status: "You have €5 AI Wallet credit"
- Next-step CTA per module:
  - Calculators: "Upload your first Excel" → calculator upload page
  - KB: "Create your first knowledge base" → KB create page
  - Flows: "Open the flow editor" → flow editor

### Persistent state
- Track in `directus_users.metadata.onboarding_state` (or a new `onboarding_progress` collection):
  - `intent_captured` (string: 'calculators'|'kb'|'flows'|'unsure')
  - `first_module_activated_at` (timestamp, NULL until first activation)
  - `wizard_completed_at` (timestamp)
- If user dismisses wizard, don't re-show automatically; allow re-entry from a "?" help menu

## Files

- `services/cms/extensions/local/project-extension-account/src/routes/onboarding.vue` (new)
- `services/cms/extensions/local/project-extension-account/src/components/welcome-wizard.vue` (new)
- `services/cms/extensions/local/project-extension-account/src/composables/use-onboarding.ts` (new)
- Hook into the post-login flow (Directus has `auth.login` hook in extensions): if user has no `first_module_activated_at`, redirect to `/admin/onboarding` instead of the default landing

## Acceptance

- [ ] New user signs up → on first login is shown the wizard
- [ ] Each tile correctly routes to module activation flow
- [ ] After successful checkout → wizard shows confirmation + next-step CTA
- [ ] Skipping wizard persists; user is not nagged
- [ ] User can re-enter wizard from a "?" help menu
- [ ] Account isolation: wizard state is per-user, doesn't leak across accounts
- [ ] Mobile-responsive (Directus admin works on tablets)

## Dependencies

- **Required:** task 14 (already shipped — has the activation endpoints + UI components)
- **Optional/related:** cms/03 (Calculator-specific wizard) — overlaps at "first calculator upload" step. Coordinate so they don't compete

## Estimate

1.5–2 days (Vue components + state management + Directus auth hook + design polish).

## Why MEDIUM not HIGH

Without this, users CAN still activate (subscription page is the existing path). It's an activation-rate optimization, not a launch blocker. But ships best in the same sprint as task 28 (production deployment) so the first real customer has a smooth experience.
