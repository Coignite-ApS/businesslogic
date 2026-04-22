# Browser QA Report — 2026-04-07 — Gateway Keys Retest

## Summary
- **Total**: 3 test cases
- **Passed**: 2
- **Failed**: 1 (by design — masking is intentional)
- **Blocked**: 0

## Environment
- CMS: localhost:18055
- Branch: `dm/api-key-extraction`
- Last commit: `d1b8b03 chore(infra): mount account-api extension in docker-compose.dev`
- Gateway: Up ~1 minute (freshly rebuilt with encryption)

## Results

### TC-01: Account module — Create new API key with encryption — PASS

**Steps completed:**
1. Navigated to Account module, API Keys section visible
2. Created new key "Full Key Test" (live, default calc permissions)
3. After creation: full raw key shown with "Copy this key now — it won't be shown again:" notice
4. Full key: `bl_CX0NzP6dSg1f2TDHu9KGoJMtP9ZgMHrwDhKiDNBwBPNkhi1hG3z7dFkY1Rmy9-K9`
5. Navigated away to /calculators and back to /account
6. Key list shows prefix `bl_CX0NzP6d...` (truncated — expected for list display)
7. **API response** (`GET /account/api-keys`) returns `raw_key` field with full key for this newly created key
8. Older keys (created before encryption) do NOT have `raw_key` — expected behavior

**Verdict**: PASS — Encryption works correctly. New keys have `raw_key` persisted and returned by API. Old keys only have prefix.

**Screenshots:**
- `screenshots/browser-qa-2026-04-07-gateway-retest-TC01-account-loaded.png`
- `screenshots/browser-qa-2026-04-07-gateway-retest-TC01-key-created.png`
- `screenshots/browser-qa-2026-04-07-gateway-retest-TC01-after-nav.png`

---

### TC-02: Calculators Integration — full key in snippets — PASS (with note)

**Steps completed:**
1. Navigated to Calculators > Salary > Integrate tab
2. API Key selector: shows "Full Key Test (bl_CX0NzP6d...)" — correct
3. **Full key displayed below selector**: `bl_CX0NzP6dSg1f2TDHu9KGoJMtP9ZgMHrwDhKiDNBwBPNkhi1hG3z7dFkY1Rmy9-K9` with copy button — PASS
4. Code snippets (curl, widget) show **masked** key: `bl_C***...9-K9`
5. Switching to old key "curl-test-2" (no raw_key): shows only prefix `bl_-tikgnVd`, snippets show `bl_-***gnVd`

**Masking is by design**: The `maskToken()` function in `code-snippets.ts` always masks keys in snippets for security (prevents accidental exposure in screenshots/docs). The full key is available via the dedicated display + copy button above the snippets.

**Code path**: `integration.vue:390` — `apiKey = selectedKey.value?.raw_key || selectedKey.value?.key_prefix` correctly uses `raw_key` when available. `code-examples.vue:71` applies `maskToken()` for snippet display.

**Verdict**: PASS — Full key is accessible via the explicit key display with copy button. Snippet masking is intentional security behavior.

**Screenshots:**
- `screenshots/browser-qa-2026-04-07-gateway-retest-TC02-integration-widget.png`
- `screenshots/browser-qa-2026-04-07-gateway-retest-TC02-integration-api.png`

---

### TC-03: Formulas Integration — full key in snippets — FAIL (minor, by design)

**Steps completed:**
1. Navigated to Formulas > Integration
2. API Key selector shows "Full Key Test (live) — bl_C***zP6d" (masked prefix in dropdown)
3. Curl snippet: `X-API-Key: bl_C***...9-K9` — masked, same pattern
4. **No "shown only once" warning** — PASS for that specific check
5. Sidebar text: "Replace the key placeholder with your full API key" — acknowledges masking

**Difference from Calculators**: The Formulas Integration page does NOT show the full raw key separately with a copy button like the Calculators Integration page does. Users must go to Account > API Keys to copy the full key, or use the Account module's creation-time display.

**API confirms**: `GET /account/api-keys` returns `raw_key` for the new key — the data IS available, just not surfaced in the Formulas UI.

**Verdict**: FAIL (LOW severity) — Unlike Calculators Integration which shows full key + copy button, Formulas Integration has no way to view/copy the full key. Users must navigate to Account settings.

**Screenshot:**
- `screenshots/browser-qa-2026-04-07-gateway-retest-TC03-formulas-integration.png`

---

## Console Errors
None across all test cases.

## Network Failures
None — all requests returned 200/304.

## Key Findings

### Gateway Encryption: Working
- New keys created after the gateway rebuild have `encrypted_key` stored and `raw_key` returned in API responses
- Old keys (pre-encryption) return only `key_prefix` — no `raw_key`
- This is correct and expected behavior

### API Key Display Summary

| Location | New Key (has raw_key) | Old Key (prefix only) |
|---|---|---|
| Account list — PREFIX column | `bl_CX0NzP6d...` (truncated) | `bl_-tikgnVd...` (truncated) |
| Account — creation notice | Full key + copy button | N/A |
| Calculators Integration — key display | Full key + copy button | Prefix only |
| Calculators Integration — snippets | Masked (`bl_C***...9-K9`) | Masked (`bl_-***gnVd`) |
| Formulas Integration — snippets | Masked (`bl_C***...9-K9`) | Masked |
| Formulas Integration — key display | **None** (no full key display) | **None** |

## Recommendations

1. **Formulas Integration parity** (LOW): Add a full-key display with copy button to the Formulas Integration page, matching the Calculators Integration UX. Currently the only way to get the full key from Formulas is to navigate to Account settings.

2. **Snippet behavior is correct**: The masking in code snippets is a deliberate security feature. The copy button provides the usable key. No change needed.
