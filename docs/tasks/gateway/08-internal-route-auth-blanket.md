# 08. Blanket InternalAuth for /internal/ Routes

**Status:** done
**Source:** CTO Review 2026-04-15 — F-009

---

## Goal

`/internal/` routes skip public auth at gateway but rely on per-route InternalAuth middleware. If any `/internal/` route is added without InternalAuth, it's fully unauthenticated. Apply InternalAuth as blanket middleware for all `/internal/` routes at the router level.

---

## Key Tasks

- [x] Move InternalAuth from per-route to router-level middleware for `/internal/` prefix
- [x] Audit all existing `/internal/` routes — verify no breakage
- [x] Add test: new `/internal/` route without explicit middleware still requires internal auth
- [x] Update `docs/service-auth.md` to document the blanket pattern

---

## Key Files

- `services/gateway/internal/middleware/auth.go:21`
- `services/gateway/internal/middleware/internal_auth.go`
- `services/gateway/internal/routes/router.go`

---

## Acceptance Criteria

- [x] All `/internal/` routes automatically require InternalAuth
- [x] No per-route opt-in needed (defense-in-depth)
- [x] Existing internal routes still work
- [x] Test proves unauthenticated internal requests are rejected

---

## Implementation Notes

Moved InternalAuth + InternalAudit from per-route wrapping to blanket application in `Router.ServeHTTP()`. Any request with `/internal/` prefix passes through auth before reaching the mux. Removed redundant per-route middleware from `setupInternalRoutes()` and `setupInternalServiceProxy()`. Added `TestInternalProxy_BlanketAuth_UnknownRoute` proving unknown `/internal/` paths still require auth.
