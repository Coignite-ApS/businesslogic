# 45. `/wallet/balance` response should echo auto_reload fields

**Status:** planned
**Severity:** LOW — data persists server-side; UI reopen shows empty inputs
**Source:** Browser QA retest of cms/36.1 (2026-04-20, `docs/reports/browser-qa-2026-04-19-sprint-b-cms-36-37.md`)
**Depends on:** task cms/36.1 (shipped in Sprint B)

## Problem

After a user saves auto-reload settings via the wallet-settings-dialog:
- `POST /stripe/wallet-config` persists `auto_reload_enabled`, `auto_reload_threshold_eur`, `auto_reload_amount_eur`, `monthly_cap_eur`
- On dialog reopen, `GET /wallet/balance` provides the hydration data
- **But:** `/wallet/balance` response only returns `balance_eur` + `auto_reload_enabled` flag — NOT the threshold/amount values

Result: user sees their saved auto-reload enabled badge + checkbox ticked, but the two number inputs render empty. Confusing ("did it save?"). Data IS persisted (verified via direct DB query) — it's just a response shape gap.

## Required behavior

`GET /wallet/balance` response should include:

```json
{
  "balance_eur": 5.00,
  "auto_reload_enabled": true,
  "auto_reload_threshold_eur": 5,
  "auto_reload_amount_eur": 20,
  "monthly_cap_eur": null
}
```

## Files

- `services/cms/extensions/local/project-extension-stripe/src/wallet-handlers.ts` — likely where the balance endpoint is defined. Add the 3 extra fields to the SELECT + response shape.
- Or wherever `GET /wallet/balance` is registered (check `src/index.ts` for the route).

## Acceptance

- `curl /wallet/balance` returns the 3 extra fields when set
- `wallet-settings-dialog.vue` reopens with threshold/amount pre-filled from the response
- Existing tests still pass; add a test that verifies the new fields are in the response

## Estimate

30min — trivial response-shape extension.
