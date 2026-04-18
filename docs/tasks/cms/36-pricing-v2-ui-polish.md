# 36. Pricing v2 — UI polish (wallet auto-reload, low-balance banner, PlanCards rewrite)

**Status:** planned
**Severity:** LOW — quality-of-life improvements; v2 is functional without these
**Source:** Phase 5 sub-agent flagged these in `docs/reports/session-2026-04-18-pricing-v2.md` §9

## Problem

Phase 5 of task 14 shipped the core UI for v2 pricing but left three items as deliberate cuts to keep scope manageable. Each is small individually; bundling them so they ship together.

## Items

### 36.1 — Wallet auto-reload settings dialog

The `POST /stripe/wallet-config` endpoint exists (Phase 3) and accepts `monthly_cap_eur`, `auto_reload_enabled`, `auto_reload_threshold_eur`, `auto_reload_amount_eur`. No UI to set them.

Add a settings dialog accessible from the AI Wallet card on `/admin/account/subscription`:
- Toggle: "Auto top-up"
- Number input: "When balance drops below €X" (threshold)
- Number input: "Top up by €X" (amount; suggest €20/€50/€200)
- Number input (optional): "Monthly spending cap €X" (with helper text "blocks new charges if monthly debits exceed this")
- Save button → `POST /stripe/wallet-config`

Validation: if auto-reload is enabled, both threshold and amount must be > 0.

Files: `services/cms/extensions/local/project-extension-account/src/components/wallet-settings-dialog.vue` (new), invoked from `subscription-info.vue`.

### 36.2 — AI Assistant inline low-balance banner

Currently the low-balance warning only appears in the AI Assistant's upgrade dialog. Users using the assistant inline don't see it until they open the dialog.

Add a slim banner above the conversation area in the AI Assistant module that shows when `wallet.balance_eur < 1.00`:
- Yellow/amber color
- Text: "AI Wallet low: €0.42 — Top up to keep using AI"
- Button: "Top up" (calls existing `startWalletTopup`)

Files: `services/cms/extensions/local/project-extension-ai-assistant/src/components/conversation-nav.vue` or wherever the conversation chrome lives.

### 36.3 — PlanCards shared component v2 rewrite

The `project-shared-ui/plan-cards.vue` component is currently called from the calculator config-card with v1-shape data (mapped from v2 inside the fetch handler). Long-term, the component should accept v2 module-aware props natively:

```ts
// new props shape
{ module: 'calculators' | 'kb' | 'flows', tiers: ModulePlan[] }
```

Each tier card renders module-specific allowances:
- Calculators: slot count + always-on + requests
- KB: storage + embed tokens
- Flows: executions + concurrent runs

Files: `services/cms/extensions/local/project-shared-ui/src/components/plan-cards.vue`. Update both consumers (calculator config-card + account routes/subscription.vue) to pass v2 props.

## Acceptance

- [ ] 36.1: Settings dialog opens, persists changes, validates auto-reload requires both fields
- [ ] 36.2: Banner appears below €1 balance, hidden above; top-up button works
- [ ] 36.3: PlanCards accepts v2 props natively; both consumers updated; no v1→v2 mapping inside config-card
- [ ] All 18 extensions still build cleanly
- [ ] Account-extension Vitest still passes 15/15

## Dependencies

- **Required:** task 14 (already shipped)
- **Optional:** task 18 (auto-reload doesn't fire without the debit hook anyway, but the config UI works independently)
