# 04. Formula API Security — Auth for Execute Endpoints

**Status:** completed
**Phase:** 1 — Security & Widget Foundation

---

## Goal

Add `X-Auth-Token` requirement to the open `/execute`, `/execute/batch`, `/execute/sheet` endpoints. Per-formula tokens (same pattern as per-calculator tokens) gate access and tie usage to an account for billing. Existing per-calculator tokens remain unchanged — they're scoped to specific calculators and may be given to different external entities.

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Token scope | **Per-formula tokens** (like per-calculator) | If key compromised, only that token revoked — no blast radius to other keys |
| Token storage | **Encrypted at rest, decrypted on read** | Tokens need to be retrievable (shown in UI, sent to Formula API), but safe in DB |
| Call recording | **Reuse `calculator_calls`** with `type` + `account` fields | Single collection for billing; `type` field distinguishes calculator vs formula calls |
| Per-calculator tokens | **Keep + encrypt** | Different entities get different tokens; apply same encryption as formula tokens |
| Token management UI | **Account settings page** | Keep token management centralized per account |
| Formula API token cache | **Cached locally, periodic refresh** | Same pattern as calculator configs — no per-request Directus callback |
| Encryption key rotation | **Deferred** | Support later via multi-key decryption (old+new keys); no code change needed |

---

## Current Auth Architecture

### Two token types exist:
1. **`X-Admin-Token`** — single shared secret, gates CRUD operations. Timing-safe SHA-256 via `safeTokenCompare()`.
2. **`X-Auth-Token`** — per-calculator token in `calculator_configs.api_key`. Stored plaintext. Optional.

### What is NOT secured:
| Endpoint | Risk | Severity |
|----------|------|----------|
| `POST /execute` | Arbitrary formula evaluation, no auth | **Critical** |
| `POST /execute/batch` | Up to 1000 formulas per request, no auth | **Critical** |
| `POST /execute/sheet` | Multi-sheet formula evaluation, no auth | **Critical** |
| `GET /health` | Exposes internal stats (calculator count, memory, queue size) | Medium |

---

## Architecture

### Token flow:
```
Client → POST /execute (X-Auth-Token: <formula-token>)
  → Formula API validates token → resolves account ID
  → Executes formula
  → Posts stats to Directus (type: 'formula', account: accountId)
  → Call counted toward account's calls_per_month
```

### Schema changes (Directus):

**`calculator_calls` — add fields:**
- `type` (string, default `'calculator'`) — `'calculator'` or `'formula'`
- `account` (M2O → accounts) — direct FK, avoids join through `calculators.account`

Backfill existing records: set `account` from `calculators.account` join, set `type = 'calculator'`.

**Formula tokens** — either new collection or extend existing:
- Token generated per-formula-key (like calculator tokens — `crypto.randomUUID()`)
- Encrypted at rest (AES-256-GCM or similar), decrypted when sent to Formula API or shown in UI
- Scoped to account

### Formula API changes:
- Auth middleware on `/execute`, `/execute/batch`, `/execute/sheet`
- Token validation via `safeTokenCompare()` (existing)
- Stats posting includes `account` ID + `type: 'formula'`
- Calculator stats also start including `account` ID (new)

### Token encryption:
- Encrypt with server-side key (env var `TOKEN_ENCRYPTION_KEY`)
- Store ciphertext in DB
- Decrypt on read (UI display, Formula API sync)
- Same approach should eventually apply to calculator tokens too

---

## Key Tasks

### Phase A: Schema & Token Management (Directus) ✅
- [x] Token encryption utility (AES-256-GCM, `TOKEN_ENCRYPTION_KEY` env var) — `crypto.ts`
- [x] Encrypt existing calculator tokens (`calculator_configs.api_key`) — migration on startup
- [x] Update calculator token read/write to use encrypt/decrypt
- [x] Add `type` field to `calculator_calls` (default `'calculator'`)
- [x] Add `account` FK to `calculator_calls`
- [x] Backfill `account` from `calculators.account` for existing records
- [x] Create formula token management (generate, encrypt, store, revoke)
- [x] UI for managing formula tokens in account settings page

### Phase B: Auth on Execute Endpoints (Formula API) ✅
- [x] Add auth middleware to `/execute`, `/execute/batch`, `/execute/sheet`
- [x] Token lookup: validate `X-Auth-Token`, resolve to account ID
- [x] Return 401 for missing/invalid token
- [x] Update stats posting to include `account` ID + `type` field
- [x] Calculator stats also start posting `account` ID

### Phase B+: Formulas Test UI (Directus Module) ✅
- [x] New `project-extension-formulas` module for testing formula execution
- [x] Proxy routes: `/calc/formula/execute`, `/calc/formula/execute-batch`, `/calc/formula/execute-sheet`
- [x] Three modes: Single, Batch, Sheet — with locale support (16 locales)
- [x] Auto-creation of default API key on account creation (UX: zero-friction first use)

### Phase C: Health & Hardening
- [ ] Strip internal metrics from `/health` unless `X-Admin-Token` provided
- [ ] Remove or restrict `GET /calc/formula-api-url` endpoint
- [ ] Add rate limiting middleware per-token

### Phase D: Monitoring
- [ ] Log failed auth attempts
- [ ] Alert on rate limit hits

---

## Acceptance Criteria

- [x] `/execute`, `/execute/batch`, `/execute/sheet` require `X-Auth-Token`
- [x] Formula calls recorded in `calculator_calls` with `type = 'formula'`
- [x] All calls have direct `account` FK (no join needed for stats)
- [x] Tokens encrypted at rest, decrypted on read
- [x] Invalid/missing token → 401
- [ ] `/health` without `X-Admin-Token` → `{status: "ok"}` only (Phase C)
- [ ] Rate limits enforced per-token (Phase C)
- [ ] Failed auth logged (Phase D)
- [x] Per-calculator tokens unchanged, still work as before

---

## Dependencies

- Formula API codebase (`/Volumes/Data/Code/excel-formula-api/`)
- Directus calculator-api extension (stats recording, token management)
- Schema migration for `calculator_calls` (add `type`, `account`)
- `TOKEN_ENCRYPTION_KEY` env var in deployment

## Risk

**Must complete before any public-facing features.** Open execute endpoints = free unlimited compute.
