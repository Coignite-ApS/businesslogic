# Browser QA Report — 2026-04-07 — Formulas Key Bar

## Summary
- **Total**: 1 test case
- **Passed**: 1
- **Failed**: 0
- **Blocked**: 0

## Environment
- CMS: localhost:18055
- Branch: dm/api-key-extraction
- Last commit: d1b8b03 chore(infra): mount account-api extension in docker-compose.dev
- Extensions: rebuilt before test

## Results

### TC-01: Formulas Integration — full key display + copy — PASS

**Steps & Findings:**

1. **Navigate to /admin/formulas** — redirected to `/admin/formulas/integration` (last visited page). Integration view loaded.
2. **Left navigation** — "Test" and "Integrate" tabs visible and functional.
3. **Page loaded successfully** — feature gate passed, API keys fetched via `GET /account/api-keys` (304), formula API URL fetched via `GET /calc/formula-api-url` (304).
4. **Key bar** — present with:
   - Dropdown selector: `Full Key Test (live) — bl_C***zP6d`
   - Full key displayed: `bl_CX0NzP6dSg1f2TDHu9KGoJMtP9ZgMHrwDhKiDNBwBPNkhi1hG3z7dFkY1Rmy9-K9`
   - Copy icon (content_copy button) next to full key
5. **Code snippets** — curl snippet shows masked key in X-API-Key header: `bl_C***********************************************************9-K9`. The key bar shows the full unmasked key for easy copying; the snippet uses a masked placeholder. This is intentional — the copy button on the key bar is the primary way to get the full key.
6. **No "Copy this key — it won't be shown again" warning** — confirmed absent. Correct behavior since keys are retrievable from the account API.

**Console errors**: None
**Network failures**: None (all 200/304)

**Screenshots**:
- `docs/reports/screenshots/browser-qa-2026-04-07-formulas-key-bar-TC01-integration.png` — viewport
- `docs/reports/screenshots/browser-qa-2026-04-07-formulas-key-bar-TC01-fullpage.png` — full page

## Console Errors
None.

## Network Failures
None.

## Recommendations
- The code snippet uses a masked key while the key bar shows the full key. This is consistent UX — users copy from the key bar, snippets show structure. No action needed.
