# 01. Auth for Execute Endpoints

**Status:** in-progress
**Mirrors:** businesslogic-cms #04 (Formula API Security)

---

## Goal

Add `X-Auth-Token` requirement to `/execute`, `/execute/batch`, `/execute/sheet`. Per-formula tokens (same pattern as per-calculator tokens) gate access and resolve to an account for billing/stats.

---

## Decisions

| Decision | Choice |
|----------|--------|
| Token scope | Per-formula (like per-calculator — isolated, easy to rotate) |
| Call recording | Reuse `calculator_calls` with `type` + `account` fields |
| Calculator tokens | Keep per-calculator pattern (now encrypted at rest on Directus side) |
| Stats posting | Include `account` ID + `type` field on all calls (calculator + formula) |
| Token cache | Cached locally with periodic refresh (same as calculator configs) |

---

## Current State

### Existing auth:
- `X-Admin-Token` — single shared secret for CRUD. `safeTokenCompare()` in `src/utils/auth.js`.
- `X-Auth-Token` — per-calculator token for `/execute/calculator/:id`. Checked in `src/routes/calculators.js`.

### Open endpoints:
| Endpoint | File | Auth |
|----------|------|------|
| `POST /execute` | `src/routes/evaluate.js` | None |
| `POST /execute/batch` | `src/routes/evaluate.js` | None |
| `POST /execute/sheet` | `src/routes/evaluate.js` | None |

---

## Changes Required

### Auth middleware (`src/routes/evaluate.js`):
```
Request → X-Auth-Token header
  → Validate token (safeTokenCompare against known formula tokens)
  → Resolve token → account ID
  → Attach accountId to request context
  → 401 if missing/invalid
```

### Stats posting (`src/services/stats.js`):
Currently posts:
```json
{ "calculatorId": "...", "responseTimeMs": 123, "test": false, "error": false }
```

Needs to also post:
```json
{ "account": "account-uuid", "type": "formula" }
```

For calculator calls, also start posting `account` (looked up from calculator config).

### Token source:
- Formula tokens managed in Directus, synced to Formula API
- Options: (a) cached locally with periodic refresh, (b) validated per-request via Directus callback
- Recommend (a) — cache with TTL, same pattern as calculator configs

### Health endpoint:
- Strip internal metrics unless `X-Admin-Token` provided
- Return only `{status: "ok"}` for unauthenticated requests

---

## Key Tasks

- [ ] Add auth middleware to execute routes in `src/routes/evaluate.js`
- [ ] Token validation via `safeTokenCompare()` (reuse `src/utils/auth.js`)
- [ ] Token cache: fetch formula tokens from Directus, cache with TTL
- [ ] Update `src/services/stats.js` to include `account` + `type` in stats batch
- [ ] Update calculator execute to also post `account` in stats
- [ ] Strip `/health` internals unless admin token provided
- [ ] Per-token rate limiting
- [ ] Log failed auth attempts

---

## Key Files

- `src/routes/evaluate.js` — execute endpoints (add middleware here)
- `src/utils/auth.js` — `safeTokenCompare()`, reuse for validation
- `src/routes/calculators.js` — existing `X-Auth-Token` pattern to follow
- `src/services/stats.js` — stats buffering + posting (add account/type)
- `src/config.js` — `ADMIN_TOKEN`, `ADMIN_API_URL`, `ADMIN_API_KEY`
