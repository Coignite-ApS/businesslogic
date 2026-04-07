# API Key System Cleanup — Design Spec

**Date:** 2026-04-07
**Scope:** Clean up inconsistencies, remove dead code, consolidate duplicated logic, fix DB defaults
**Approach:** Surgical cleanup + consolidate key creation logic (no architectural changes)

---

## Problem

The API key system works but has accumulated inconsistencies:

1. Key generation logic (random bytes → base64 → SHA256 → prefix) duplicated in 3 handler methods
2. `AutoProvision` reimplements `Create` with hardcoded SQL instead of sharing logic
3. DB column default still uses old flat format `{"ai":true,"calc":true,"flow":false}` while code uses v3 `{services:{...}}`
4. `AccountData` struct uses non-pointer types for nullable DB columns, requiring intermediate pointer variables as a workaround
5. Cache invalidation scans all `gw:key:*` keys on every mutation instead of targeting specific entries
6. Dead composable `use-formula-token.ts` still exists

## Changes

### 1. Delete dead code

**File:** `services/cms/extensions/local/project-extension-formulas/src/composables/use-formula-token.ts`

Delete. Zero imports across the codebase (verified via grep). Fully replaced by `use-api-keys.ts`.

### 2. Extract `GenerateKey()` into service layer

**File:** `services/gateway/internal/service/keys.go`

Add:

```go
type GeneratedKey struct {
    RawKey    string // "bl_<base64>" — returned to caller once, never stored
    KeyHash   string // SHA256 hex of RawKey — stored in api_keys.key_hash
    KeyPrefix string // first 11 chars of RawKey — stored in api_keys.key_prefix
}

func GenerateKey() (*GeneratedKey, error) {
    rawBytes := make([]byte, 48)
    if _, err := rand.Read(rawBytes); err != nil {
        return nil, err
    }
    rawKey := "bl_" + base64.RawURLEncoding.EncodeToString(rawBytes)
    hash := sha256.Sum256([]byte(rawKey))
    return &GeneratedKey{
        RawKey:    rawKey,
        KeyHash:   hex.EncodeToString(hash[:]),
        KeyPrefix: rawKey[:11],
    }, nil
}
```

Remove `hashKey()` from `keys.go` — it stays for `Validate()` (hashes the incoming API key for lookup). `GenerateKey()` is only for creation.

### 3. Extract shared `insertKey` in handler

**File:** `services/gateway/internal/handler/apikeys.go`

Extract the INSERT query + scan into a private method:

```go
func (h *APIKeyHandler) insertKey(ctx context.Context, gk *service.GeneratedKey, req createKeyRequest) (*keyResponse, error) {
    var permJSON []byte
    if req.Permissions != nil {
        permJSON, _ = json.Marshal(req.Permissions)
    }
    if req.AllowedIPs == nil {
        req.AllowedIPs = []string{}
    }
    if req.AllowedOrigins == nil {
        req.AllowedOrigins = []string{}
    }

    var resp keyResponse
    err := h.db.QueryRow(ctx, `
        INSERT INTO api_keys (key_hash, key_prefix, account_id, environment, name,
            permissions, allowed_ips, allowed_origins, rate_limit_rps, monthly_quota, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, key_prefix, account_id, name, environment, permissions,
            allowed_ips, allowed_origins, rate_limit_rps, monthly_quota,
            expires_at, last_used_at, created_at
    `, gk.KeyHash, gk.KeyPrefix, req.AccountID, req.Environment, req.Name,
        permJSON, req.AllowedIPs, req.AllowedOrigins, req.RateLimitRPS, req.MonthlyQuota, req.ExpiresAt,
    ).Scan(
        &resp.ID, &resp.KeyPrefix, &resp.AccountID, &resp.Name, &resp.Environment,
        &permJSON, &resp.AllowedIPs, &resp.AllowedOrigins, &resp.RateLimitRPS, &resp.MonthlyQuota,
        &resp.ExpiresAt, &resp.LastUsedAt, &resp.CreatedAt,
    )
    if err != nil {
        return nil, err
    }

    parsed := service.ParsePermissions(permJSON)
    resp.Permissions = &parsed
    resp.RawKey = gk.RawKey
    return &resp, nil
}
```

Then `Create`, `Rotate`, and `AutoProvision` all use:

```go
gk, err := service.GenerateKey()
resp, err := h.insertKey(ctx, gk, req)
```

`AutoProvision` builds a `createKeyRequest` with its defaults instead of hardcoding SQL values:

```go
req := createKeyRequest{
    AccountID:   body.AccountID,
    Name:        "Default",
    Environment: "live",
    Permissions: &service.DefaultPermissions,
}
```

### 4. Define `DefaultPermissions` constant

**File:** `services/gateway/internal/service/permissions.go`

Add:

```go
var DefaultPermissions = ResourcePermissions{
    Services: map[string]ServicePermission{
        "calc": {Enabled: true, Resources: strSlicePtr([]string{"*"}), Actions: strSlicePtr([]string{"execute", "describe"})},
        "kb":   {Enabled: true, Resources: strSlicePtr([]string{"*"}), Actions: strSlicePtr([]string{"search", "ask"})},
        "flow": {Enabled: true, Resources: strSlicePtr([]string{"*"}), Actions: strSlicePtr([]string{"trigger"})},
    },
}

func strSlicePtr(s []string) *[]string { return &s }
```

Single source of truth for what auto-provisioned keys get. Used by handler's `AutoProvision` and testable.

### 5. Fix DB column default (migration 005)

**File:** `migrations/gateway/005_fix_permissions_default.sql`

```sql
-- Fix permissions column default from old flat format to v3
ALTER TABLE api_keys ALTER COLUMN permissions
SET DEFAULT '{"services":{"calc":{"enabled":true,"resources":["*"],"actions":["execute","describe"]},"kb":{"enabled":true,"resources":["*"],"actions":["search","ask"]},"flow":{"enabled":true,"resources":["*"],"actions":["trigger"]}}}';
```

This only affects new rows that don't specify permissions explicitly. All existing rows were already migrated by 002→004.

### 6. Fix `AccountData` struct

**File:** `services/gateway/internal/service/keys.go`

Change:

```go
type AccountData struct {
    AccountID      string              `json:"account_id"`
    KeyID          string              `json:"key_id"`
    Environment    string              `json:"environment"`
    Permissions    ResourcePermissions `json:"permissions"`
    AllowedOrigins []string            `json:"allowed_origins,omitempty"`
    AllowedIPs     []string            `json:"allowed_ips,omitempty"`
    RateLimitRPS   *int                `json:"rate_limit_rps,omitempty"`
    MonthlyQuota   *int                `json:"monthly_quota,omitempty"`
}
```

- `RateLimitRPS` and `MonthlyQuota` → `*int` (nil = no limit, 0 = deny all — semantically different)
- `AllowedOrigins` and `AllowedIPs` stay `[]string` (nil and empty both mean "no restrictions")
- Intermediate pointer variables in `lookupDB`/`lookupDBByPrefix` simplified — scan directly into struct for pointer fields, keep intermediate for slice fields (DB NULL → nil slice is fine)

**Downstream impact:** `CheckRateLimit` caller in `middleware/auth.go` must check `acct.RateLimitRPS != nil` before using the value.

### 7. Targeted cache invalidation

**File:** `services/gateway/internal/handler/apikeys.go`

Replace `invalidateAccountCache` (SCAN-all) with `invalidateKeyCache`:

```go
func (h *APIKeyHandler) invalidateKeyCache(ctx context.Context, keyHash, keyPrefix string) {
    if h.redis == nil {
        return
    }
    h.redis.Del(ctx, "gw:key:"+keyHash)
    if keyPrefix != "" {
        h.redis.Del(ctx, "gw:prefix:"+keyPrefix)
    }
}
```

For operations that know the hash (Create returns it, Rotate has old+new):
- `Create`: invalidate new hash (defensive — shouldn't be cached yet, but handles collision edge)
- `Rotate`: invalidate old hash + old prefix, new hash + new prefix
- `Revoke`: RETURNING clause already returns key data; add `key_hash, key_prefix` to get them
- `Update`: add `key_hash, key_prefix` to RETURNING clause

For prefix-based cache: keys validated via `LookupByPrefix` are cached under `gw:prefix:<prefix>`. Invalidate on revoke/update.

### 8. Update tests

**Gateway tests:**
- `auto_provision_test.go`: adjust mock expectations for shared `insertKey` path (same INSERT query, same args)
- `permissions_test.go`: add test for `DefaultPermissions`
- Add `keys_test.go`: test `GenerateKey()` — format, length, prefix, uniqueness

**CMS tests:**
- No changes needed — code-snippets and account tests already passing

## Files to modify

| File | Change |
|------|--------|
| `services/gateway/internal/service/keys.go` | Add `GenerateKey()`, fix `AccountData` pointer types, simplify lookupDB |
| `services/gateway/internal/service/permissions.go` | Add `DefaultPermissions`, `strSlicePtr` |
| `services/gateway/internal/handler/apikeys.go` | Extract `insertKey`, refactor Create/Rotate/AutoProvision, targeted cache invalidation |
| `services/gateway/internal/middleware/auth.go` | Handle `*int` for RateLimitRPS |
| `services/gateway/tests/auto_provision_test.go` | Adjust for unified insert path |
| `services/gateway/tests/permissions_test.go` | Test DefaultPermissions |
| `migrations/gateway/005_fix_permissions_default.sql` | Fix column default to v3 |
| `services/cms/.../composables/use-formula-token.ts` | Delete |

## Not in scope

- Moving key management out of calculator-api extension (structural, not cleanup)
- Audit logging for key operations (new feature)
- Monthly quota enforcement (new feature)
- Restructuring CMS proxy layer

## Verification

1. `make snapshot` + DB dump before any changes
2. `go test ./...` in gateway — all pass
3. `npm test` in formulas extension — all pass
4. Verify auto-provision still works: `curl POST /internal/api-keys/auto-provision`
5. Verify key validation still works: create key → use it to call `/v1/calc/execute`
6. Verify cache invalidation: create key → validate (cached) → revoke → validate again (rejected)
