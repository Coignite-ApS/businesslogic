# 01. Fine-Grained Resource Permissions

**Service:** gateway
**Status:** completed
**Depends on:** none

---

## Goal

Extend the gateway's flat boolean permission model to support resource-level grants — per-calculator, per-KB, per-action. Deny by default; empty resources = no access.

---

## Permissions JSONB Format

```json
{
  "services": {
    "formula-api": {
      "resources": {
        "calculator:uuid-1": ["execute", "describe"],
        "calculator:uuid-2": ["execute"]
      }
    },
    "ai-api": {
      "resources": {
        "kb:uuid-1": ["search", "ask"],
        "kb:uuid-2": ["search"]
      }
    }
  }
}
```

- `resources: {}` or missing service = no access to that service
- `actions` array per resource — only listed actions allowed
- Wildcard `"*"` for all resources within a service (power users)

---

## Key Tasks

- [ ] Define `ResourcePermissions` struct in Go
- [ ] `CheckResourceAccess(apiKey, service, resource, action)` middleware
- [ ] Migrate `permissions` column from flat booleans to JSONB
- [ ] Backward compat: convert old boolean format on read
- [ ] Deny-by-default enforcement — no permission entry = deny
- [ ] Test/live environment separation in permission checks
- [ ] Unit tests for permission parsing, matching, deny-default
- [ ] Integration test: request with insufficient perms returns 403

---

## Key Files

- `services/gateway/internal/auth/permissions.go` (new)
- `services/gateway/internal/middleware/resource_access.go` (new)
- `migrations/gateway/` (schema migration)
