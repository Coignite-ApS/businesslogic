# 13. Startup Secret Validation (Fail-Fast)

**Status:** done
**Source:** CTO Review 2026-04-15 — F-008

---

## Goal

Security tokens fall back to empty string if env vars missing. A misconfigured deploy silently skips HMAC gateway signing. Services must fail fast on startup when critical secrets are empty.

---

## Key Tasks

- [x] ai-api: Add startup check — abort if `GATEWAY_SHARED_SECRET` or `AI_API_ADMIN_TOKEN` empty
- [x] formula-api: Add startup check — abort if `GATEWAY_SHARED_SECRET` or `FORMULA_API_ADMIN_TOKEN` empty
- [x] gateway: Add startup check — abort if `GATEWAY_SHARED_SECRET` empty
- [x] flow: Add startup check — abort if critical auth tokens empty
- [x] Allow opt-out via `SKIP_SECRET_VALIDATION=true` for local dev without secrets
- [x] Add tests verifying startup fails with missing secrets

---

## Key Files

- `services/ai-api/src/config.js` — `validateSecrets()` function
- `services/ai-api/src/server.js` — calls `validateSecrets()` in `start()`
- `services/formula-api/src/config.js` — `validateSecrets()` function
- `services/formula-api/src/server.js` — calls `validateSecrets()` in `start()`
- `services/gateway/internal/config/config.go` — `Validate()` method on Config
- `services/gateway/main.go` — calls `cfg.Validate()` after `Load()`
- `services/flow/crates/flow-trigger/src/main.rs` — inline validation after env parse

---

## Implementation

Each service validates critical secrets during startup:

| Service | Secrets checked | Validation location |
|---------|----------------|-------------------|
| ai-api | `GATEWAY_SHARED_SECRET`, `AI_API_ADMIN_TOKEN` | `config.js:validateSecrets()` called in `server.js:start()` |
| formula-api | `GATEWAY_SHARED_SECRET`, `FORMULA_API_ADMIN_TOKEN` | `config.js:validateSecrets()` called in `server.js:start()` |
| gateway | `GATEWAY_SHARED_SECRET` | `config.go:Validate()` called in `main.go` |
| flow | `ADMIN_TOKEN` | Inline check in `main.rs` after env parse |

All services support `SKIP_SECRET_VALIDATION=true` for local dev. `test-all.sh` exports this automatically.

## Tests

- `services/ai-api/test/secret-validation.test.js` — 5 tests (missing each secret, both, all present, skip mode)
- `services/formula-api/test/secret-validation.test.js` — 5 tests (same pattern)
- `services/gateway/internal/config/config_test.go` — 3 tests (missing, present, skip)

---

## Acceptance Criteria

- [x] Services refuse to start with empty security tokens in production mode
- [x] Clear error message on startup failure
- [x] Local dev still works (opt-out mechanism)
- [x] Tests cover the validation
