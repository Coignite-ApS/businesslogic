# Browser QA Report — Sprint B (cms/36 + cms/37) — 2026-04-19

## Summary

- **Total sub-items verified**: 4 (36.1, 36.2, 36.3, 37)
- **Passed**: 2
- **Failed**: 2 (with critical data-persistence bug + broken toggle widget)
- **Blocked**: 0

## Environment

- CMS: `http://localhost:18055` (Docker dev, healthy)
- Extensions built: `/Users/kropsi/Documents/Claude/businesslogic/services/cms/extensions/local/project-extension-account/dist/index.js` mtime 2026-04-19 22:35
- Branch: `dev`
- Last commit: `cde0da9 fix(cms): snapshot Makefile targets work with bl-cms service`
- Login: `admin@example.com` / `admin123` (from `infrastructure/docker/.env`)
- User id: `3e4f090f-95a7-4749-82d7-e92d9c7a0981`
- Account id: `4622826c-648b-4e53-b2f2-fae842e4ab8e`
- Wallet balance during test: **€0.00** (ideal for low-balance banner coverage)

---

## Results

### TC-36.1 — Wallet auto-reload settings dialog — **FAIL**

**Evidence:**
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-subscription-overview.png`
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-36.1-dialog-initial.png`
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-36.1-toggle-bug.png`
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-36.1-after-save.png`

**What works:**
- "Settings" button on AI Wallet card (`subscription-info.vue`) opens the dialog
- Dialog title "Wallet Auto-Reload Settings" renders
- Monthly-spending-cap number input (`€`-prefixed, "No cap" placeholder) renders & accepts input
- Save button fires `POST /stripe/wallet-config` → **200 OK**
- Dialog closes after save, and reopens via Settings button (persistence of cap not independently verified because toggle can't be turned on)
- Cancel closes dialog
- Zero console errors

**CRITICAL BUG — broken toggle widget:**
- The "Auto top-up" toggle is rendered as a raw `<v-toggle>` custom element that Directus **does not register** (Directus only registers `VCheckbox`, `VRadio`, etc. — verified against `vueApp._context.components` map, 208 components total, zero named `*Toggle` / `*Switch`).
- DOM: `<v-toggle data-v-2d0395bf="" modelvalue="false"></v-toggle>` — zero-size (0×0), no children, `customElements.get('v-toggle') === undefined`.
- Result: user sees the text label "Auto top-up" but nothing visually clickable to its right. Clicking / hovering / focusing the row does nothing. `modelvalue` stays `false` forever.
- Threshold and amount number inputs are conditionally rendered inside `v-if="localEnabled"` — since `localEnabled` can never become `true` via UI, **these inputs are never reachable**.
- **User cannot enable auto top-up via the UI, period.** Only monthly-cap works.
- Validation (the "if auto-reload ON then threshold/amount must both be > 0" rule) cannot be exercised because the state that triggers it is unreachable.

**Source confirmation:** `services/cms/extensions/local/project-extension-account/src/components/wallet-settings-dialog.vue:9` — `<v-toggle v-model="localEnabled" />`. Needs to be replaced with a registered Directus component. Closest equivalents available: `<v-checkbox block>` or an inline HTML `<input type="checkbox">`.

**Console errors:** none (Vue silently treats unknown elements as native HTML custom elements).
**Network failures:** none — the Save POST even went through with the toggle stuck OFF.

**Severity:** HIGH — the entire point of this sub-task (auto-reload settings UI for the already-deployed `/stripe/wallet-config` endpoint) is non-functional in the UI layer.

---

### TC-36.2 — AI Assistant inline low-balance banner — **PASS**

**Evidence:**
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-36.2-banner.png`
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-36.2-topup-dialog.png`

**What works:**
- With wallet at €0.00, banner renders above the conversation area with:
  - Amber/yellow background
  - Wallet icon
  - Text: "AI Wallet low: €0.00 — Top up to keep using AI"
  - "Top up" button on the right
- Clicking "Top up" opens the existing AI Wallet top-up dialog with €20 / €50 / €200 quick-select buttons
- Banner does not flicker or shift layout
- Zero console errors, zero network failures

**Not directly tested** (would require non-destructive balance mutation): the ≥€1.00 hidden state. Source review (`low-balance-banner.vue` + `module.vue` fetching `/wallet/balance`) shows the v-if gate, so this is expected to work.

**Severity:** PASS.

---

### TC-36.3 — PlanCards v2 (module-aware props) — **PASS (indirect)**

**Evidence:**
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-36.3-activate-plans.png` (Calculators)
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-36.3-kb-plans.png` (Knowledge Base)
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-36.3-flows-plans.png` (Flows)
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-36.3-configure-page.png` (calculator configure)

**Note on scope:** The shared `plan-cards.vue` (v2) is invoked from `config-card.vue`'s `upgradeVisible` dialog, which only appears when a user with an existing calculators subscription hits a slot/AO limit. No such subscription exists on the test account, so the shared component itself was not rendered in this session. The `/admin/account/subscription` page uses its own inline tier grid (documented in task doc as intentional). That inline grid was exercised for all three modules and validates the end-user-visible behavior required by the task (module-specific allowances, EUR prices, no v1→v2 artifacts).

**Subscription-page Activate dialogs (inline tier grid):**
- Calculators: Starter €19.00/mo (10 slots · 2 always-on · 10,000 req/mo), Growth €79.00/mo (50/10/100,000), Scale €299.00/mo (250/50/1,000,000)
- Knowledge Base: Starter €15.00/mo (200 MB storage · 1M embed tokens), Growth €49.00/mo (2,000 MB · 10M), Scale €199.00/mo (20,000 MB · 100M)
- Flows: Starter €19.00/mo (1,000 executions/mo · 20 max steps), Growth €59.00/mo (10,000 · 50), Scale €249.00/mo (100,000 · 200)

All module-specific allowances render correctly. All prices are EUR (no €1900 or €2999 cents artifacts). Both Monthly and "Annual (17% off)" CTAs render per tier.

**Shared `plan-cards.vue` indirect verification:** `services/cms/extensions/local/project-extension-calculators/src/components/config-card.vue:176-185` shows the new v2 call-site `module="calculators" :tiers="plans"` with no v1→v2 mapping in the fetch handler — matches task spec §36.3. The typed `ModulePlan` import confirms the new shape. Per task doc: 14 vitest tests (`plan-cards-v2.test.ts`) pass on host build.

**Console errors:** none. **Network failures:** none on `/items/subscription_plans` (200).

**Severity:** PASS (data-layer and call-site verified; live render of the shared component requires a subscribed user which is out of scope for this QA pass).

---

### TC-37 — Empty-trial onboarding wizard — **FAIL (persistence broken)**

**Evidence:**
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-37-step1.png` — step 1 tiles
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-37-step2-calculators.png` — step 2 quick-start
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-37-step3-confirm.png` — step 3 confirmation (`?success=true&module=calculators`)
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-19-cms-36-37-37-maybe-later.png` — state after "Maybe later" (re-shows step 1)

**What works (UI layer):**
- `/admin/account/onboarding` renders step 1 with all 4 tiles: calculators, KB, flows, unsure, each with an icon + description
- Continue button correctly disabled until a tile is picked
- Clicking a tile + Continue advances to step 2 (module quick-start) with module-specific title/description, 14-day free trial messaging, after-trial price ("€19.00/mo · 10 slots · 10,000 req/mo" for calculators), and three buttons: Back / Maybe later / Activate <module> trial
- `?mode=retry` URL renders step 1 (re-entry works)
- `?success=true&module=calculators` URL renders step 3 confirmation: "Calculators is active for 14 days!", €5 AI Wallet credit mention, "Upload your first Excel" CTA, "Go to dashboard" button
- Nav sidebar "Getting Started" link (`help_outline`) exists and correctly points at `/admin/account/onboarding?mode=retry`
- Zero console errors, zero network failures
- Mobile-responsive not tested (viewport not resized)

**CRITICAL BUG — wizard state never persists:**
- The onboarding composable writes to `directus_users.metadata.onboarding_state` (see `services/cms/extensions/local/project-extension-account/src/composables/use-onboarding.ts:29-70`).
- **The `metadata` column does not exist on `directus_users` in the running Postgres.** Verified via `\d directus_users` — columns are: id, first_name, last_name, email, password, location, title, description, tags, avatar, language, tfa_secret, status, role, token, last_access, last_page, provider, external_identifier, auth_data, email_notifications, appearance, theme_dark, theme_light, theme_light_overrides, theme_dark_overrides, active_account, text_direction. **No `metadata`.**
- Also verified via `GET /users/me?fields[]=metadata` → response returns only `{id}` with no `metadata` key at all.
- Directus silently drops the unknown field on PATCH. Observed sequence during "Maybe later" click: `GET /users/me?fields[]=metadata` → 200 (empty), `PATCH /users/me` → 200 (no-op). The "mark completed" timestamp goes into the void.
- **Consequence 1 — nag loop:** Every time the user navigates to `/admin/account`, `needsWizard` reads `false && false = true` (because both `first_module_activated_at` and `wizard_completed_at` are always null on fetch), and the redirect to `/admin/account/onboarding` fires again. Confirmed in session: after clicking "Maybe later" then navigating to `/admin/account`, URL rewrites to `/admin/account/onboarding` and step 1 renders again. Acceptance criterion "Skipping wizard persists; user is not nagged" — FAILS.
- **Consequence 2 — `first_module_activated_at` never set:** Even if a user completes Stripe checkout and returns via `?success=true`, `markActivated()` patches `metadata` which is discarded. Real activation state relies on the subscriptions table being the source of truth, but the task's stated contract (metadata-backed state) is broken.

**Fix options (for reference, not for this QA):**
1. Add `metadata` JSONB column to `directus_users` via Directus schema snapshot + migration, register as a hidden/admin-editable field — but modifying `directus_users` itself is usually discouraged.
2. Move state to an existing JSON-capable user field: `tags` (json), `theme_light_overrides` / `theme_dark_overrides` (json), or `auth_data` (json). None are semantically correct.
3. Create a new `onboarding_progress` collection keyed by user — matches the task doc's alternative: "(or a new `onboarding_progress` collection)".
4. Store in `localStorage` / account-scoped Directus setting — less ideal for multi-device.

**Console errors:** none.
**Network failures:** none — the silent drop is the problem.

**Severity:** HIGH — UI is fully built, but the activation-rate optimization this task aims for is defeated because the user gets force-redirected to the wizard on every account visit. First impression: nag.

---

## Cross-cutting observations

### Accessibility
Preserved issues across the session (non-blocking):
- "No label associated with a form field" (2 occurrences)
- "A form field element should have an id or name attribute" (3 occurrences)

Likely unrelated to Sprint B work. Worth a follow-up polish pass.

### Extensions that failed to register components
Only `<v-toggle>` observed. The account dialog would benefit from a code-review pass checking all other custom component usages against Directus's registered set (see §36.1 finding).

### Wallet auto-reload endpoint is happy
`POST /stripe/wallet-config` accepted the save with no error, even with toggle-forced OFF + no cap. Backend side of the feature looks ready; only the UI is broken.

---

## Overall verdict

**OK to merge to dev? — NO.**

**Blocking issues:**
1. **cms/36.1** — wallet auto-reload toggle uses unregistered `<v-toggle>` component; user cannot enable auto top-up via UI. Entire feature non-functional. Task doc marks 36.1 "completed" but browser QA (blocked at task-doc time by cross-cutting/39) now shows it doesn't work.
2. **cms/37** — state persistence is broken because `directus_users.metadata` doesn't exist in the schema. Wizard re-shows on every `/account` visit. Activation-rate optimization defeated; the wizard nags instead of guiding.

**Non-blocking (follow-up tasks):**
- Minor a11y issues (labels, id/name) — not introduced by Sprint B but worth tracking.
- Shared `plan-cards.vue` v2 render not exercised live (needs a subscribed test account to trigger `upgradeVisible` from `config-card.vue`).
- 36.2 low-balance-banner hidden state (≥€1.00) not tested live; only the <€1.00 visible state was validated.
- After login, the post-auth redirect took admin to `/admin/calculators` which threw "Page Not Found" briefly before settling — possibly unrelated (Directus telemetry consent banner fires on same request). Retested navigation works fine afterward.

**Recommendation:**
- Do NOT merge cms/36 + cms/37 in current state. Fix the two blockers, retest.
- For cms/36.1: replace `<v-toggle>` with a registered Directus component (`<v-checkbox>` with label, or an HTML `<input type="checkbox">` with CSS to style as a switch). Re-run the dialog flow, verify threshold/amount inputs appear when toggle is ON, verify validation blocks save when threshold=0 or amount=0.
- For cms/37: either (a) switch state to a new `onboarding_progress` collection, or (b) add `metadata JSONB` to `directus_users` via db-admin (schema + migration). Re-test: full wizard flow + "Maybe later" + navigate-to-`/account` (no redirect) + nav "Getting Started" re-entry.
- Once fixed, re-run this QA pass.

---

## Re-test 2026-04-20 (after fixes 9d7d6de + b13e040)

**Environment**
- CMS: `http://localhost:18055` (healthy, 200 on `/server/health`)
- Branch: `dm/sprint-b-pricing-v2`
- Fix commits: `9d7d6de fix(account): swap v-toggle → v-checkbox in wallet-settings-dialog`, `b13e040 fix(db): add directus_users.metadata jsonb column for onboarding state`
- Extension rebuilt: `services/cms/extensions/local/project-extension-account/dist/index.js` mtime 2026-04-19 23:53
- DB: `\d directus_users` confirms `metadata | jsonb | not null | '{}'::jsonb` column now present
- Login: same admin user `3e4f090f-95a7-4749-82d7-e92d9c7a0981`, starting `metadata = {}`

---

### cms/36.1 retest — wallet auto-reload toggle — PASS

**Evidence**
- `docs/reports/screenshots/browser-qa-2026-04-20-cms-36-37-retest-36.1-dialog-initial.png` — dialog open, checkbox unchecked, threshold/amount hidden (as expected, `v-if="localEnabled"` false)
- `docs/reports/screenshots/browser-qa-2026-04-20-cms-36-37-retest-36.1-checkbox-on.png` — checkbox now `check_box`, threshold + amount fields revealed, Save disabled (threshold/amount both 0)
- `docs/reports/screenshots/browser-qa-2026-04-20-cms-36-37-retest-36.1-filled-save-enabled.png` — threshold=5, amount=20, Save enabled
- `docs/reports/screenshots/browser-qa-2026-04-20-cms-36-37-retest-36.1-reopen-persisted.png` — reopened dialog: checkbox `checked`, wallet card shows "Auto-reload on" badge

**Observations**
- `<v-toggle>` → `<v-checkbox>` swap confirmed in rendered DOM: `toggle-row` children are `[LABEL.field-label, BUTTON.v-checkbox(24×24)]`, `hasOldVToggle: false, hasVCheckbox: true`. No more 0×0 zombie element.
- Clicking the checkbox flips `localEnabled`, and `v-if="localEnabled"` correctly reveals "When balance drops below" + "Top up by" inputs.
- Validation works as spec: checkbox ON + threshold=0 + amount=0 → Save disabled; threshold=5 + amount=20 → Save enabled.
- **POST /stripe/wallet-config payload (reqid 619):** `{"auto_reload_enabled":true,"auto_reload_threshold_eur":5,"auto_reload_amount_eur":20,"monthly_cap_eur":null}` → **200 OK**. Response: `{"balance_eur":"0.0000","monthly_cap_eur":null,"auto_reload_enabled":true,"auto_reload_threshold_eur":"5.00","auto_reload_amount_eur":"20.00"}`. Dialog closes after save.
- On reopen: checkbox persists (`checked`), "Auto-reload on" indicator shows on the AI Wallet card above.
- Zero console errors across the entire flow.
- Core blocker resolved. Feature is now fully functional through the UI.

**Minor follow-up (non-blocking, MEDIUM)**
- `GET /wallet/balance` response exposes `auto_reload_enabled` and `monthly_cap_eur` but **not** `auto_reload_threshold_eur` or `auto_reload_amount_eur`. The dialog receives `initialConfig` from `subscription-info.vue:156-159` which reads these two fields off `props.wallet` — and they're `null` because the GET doesn't return them. So on reopen the checkbox shows as "on" (correct) but the threshold/amount number inputs show empty placeholders instead of "5" / "20" (server has them persisted; the UI can't display what it was never given). Not a regression — backend DTO contract gap. Suggest adding those two fields to `/wallet/balance` response (or bringing them in through a separate `/wallet/config` GET). Not a Sprint B blocker since the feature saves + functions correctly; only the visual echo on reopen is missing.

---

### cms/37 retest — onboarding state persistence — PASS

**Evidence**
- `docs/reports/screenshots/browser-qa-2026-04-20-cms-36-37-retest-37-step1-redirect.png` — `/admin/account` auto-redirected to `/admin/account/onboarding` on first visit (wizard still fires for genuinely-new users, as it should)
- `docs/reports/screenshots/browser-qa-2026-04-20-cms-36-37-retest-37-step2.png` — step 2 (Calculators module) with Back / Maybe later / Activate buttons
- `docs/reports/screenshots/browser-qa-2026-04-20-cms-36-37-retest-37-after-maybe-later.png` — landed at `/admin/account` after clicking "Maybe later" (not onboarding)
- `docs/reports/screenshots/browser-qa-2026-04-20-cms-36-37-retest-37-no-renag.png` — critical test: after navigating away (`/admin/account/subscription`, then `/admin/account`), URL stays at `/admin/account` — **no re-redirect to onboarding**

**Observations**
- Pre-test DB state: `GET /users/me?fields[]=metadata` → `{"metadata":{}, "id":"..."}`. Column exists, starting empty.
- Initial `/admin/account` visit → wizard redirect (correct, `needsWizard === true`).
- Step 1 → picked "Expose a calculator as an API" → Continue → step 2 rendered for Calculators.
- **Intent capture PATCH (reqid 679):** `{"metadata":{"onboarding_state":{"intent_captured":"calculators"}}}` → **200 OK**. Response echoes the persisted `metadata` — field is now writable end-to-end.
- **"Maybe later" PATCH (reqid 682):** `{"metadata":{"onboarding_state":{"intent_captured":"calculators","wizard_completed_at":"2026-04-19T22:02:14.001Z"}}}` → **200 OK**. Response confirms `metadata.onboarding_state.wizard_completed_at` persisted.
- After "Maybe later": URL = `/admin/account` (Account page: Usage / API Keys / Settings visible). No redirect to onboarding.
- **Critical re-nag test:** navigated `/admin/account` → `/admin/calculators` → `/admin/account/subscription` → `/admin/account`. **URL remained `/admin/account`** on the final visit. Wizard does NOT re-fire. Verified via fresh `GET /users/me?fields[]=metadata` → `{"onboarding_state":{"intent_captured":"calculators","wizard_completed_at":"2026-04-19T22:02:14.001Z"}}`.
- "Getting Started" nav link still present in sidebar (`/admin/account/onboarding?mode=retry`) — users can re-enter the wizard intentionally.
- Zero console errors across the entire flow.

**Specifically: does the wizard stop re-nagging after "Maybe later"? — YES.**

---

### Overall verdict — OK to merge `dm/sprint-b-pricing-v2` → `dev`? **YES.**

Both HIGH-severity blockers from the 2026-04-19 report are fully resolved. UI is functional, data persists, the nag loop is gone, no console errors, no network failures. Acceptance criteria met for both cms/36.1 and cms/37.

**Known non-blocking items (file as follow-up tasks, not sprint blockers):**
1. `/wallet/balance` response should also include `auto_reload_threshold_eur` and `auto_reload_amount_eur` so the settings dialog can echo saved values on reopen. Today the checkbox persists but threshold/amount number inputs show empty on reopen. Data is safe on the server; just not displayed.
2. (Carried from 2026-04-19 run, unchanged) minor a11y issues — form-field labels and id/name attributes — not introduced by Sprint B.
3. (Carried) Shared `plan-cards.vue` v2 render still not exercised live; requires a subscribed user — out of scope for the retest.
