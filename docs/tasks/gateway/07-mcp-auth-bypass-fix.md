# Gateway 07 — Fix MCP Calculator Auth Bypass

- **Status:** completed
- **Priority:** P0 (critical security)
- **Service:** gateway
- **Branch:** dm/api-key-extraction
- **Source:** Codex adversarial review 2026-04-10

## Problem

Route rename from `/v1/mcp/calc/` to `/v1/mcp/calculator/` introduced an auth bypass.

`isMCPKeyPrefixPath()` in `auth.go:60-68` excludes `"calc/"` and `"ai/"` from key-prefix auth bypass. But `"calculator/"` does NOT match `"calc/"` prefix check, so `/v1/mcp/calculator/*` is now treated as a key-prefix MCP path — skipping X-API-Key validation entirely.

The formula-api MCP handler does not perform its own auth check, making this an unauthenticated execution surface.

## Fix

Update `isMCPKeyPrefixPath()` to exclude renamed routes:

```go
// Current (broken):
return rest != "" && !strings.HasPrefix(rest, "calc/") && !strings.HasPrefix(rest, "ai/")

// Fixed:
return rest != "" && !strings.HasPrefix(rest, "calculator/") && !strings.HasPrefix(rest, "formula/") && !strings.HasPrefix(rest, "ai/")
```

## Key Tasks

- [x] Update `isMCPKeyPrefixPath()` in `services/gateway/internal/middleware/auth.go`
- [x] Add regression test: `/v1/mcp/calculator/:id` returns 401 without X-API-Key
- [x] Add regression test: `/v1/mcp/formula/:id` returns 401 without X-API-Key
- [x] Verify key-prefix MCP paths (e.g. `/v1/mcp/{accountKeyPrefix}/`) still work
- [x] Run full gateway test suite

## Files

- `services/gateway/internal/middleware/auth.go` (lines 60-68)
- `services/gateway/tests/auth_test.go`
