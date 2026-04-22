# API Key System Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up API key inconsistencies — consolidate duplicated key generation, fix DB defaults, honest nullable types, targeted cache invalidation, remove dead code.

**Architecture:** No structural changes. Extract shared logic from handler into service layer. Fix types to match DB nullability. Replace broad cache invalidation with targeted deletes.

**Tech Stack:** Go (gateway), TypeScript/Vue (CMS extensions), PostgreSQL migrations

**Spec:** `docs/superpowers/specs/2026-04-07-api-key-cleanup-design.md`

---

### Task 0: Database snapshot

**Files:** None (infrastructure)

- [ ] **Step 1: Take database snapshot**

```bash
cd /Users/kropsi/Documents/Claude/businesslogic/services/cms && make snapshot
```

- [ ] **Step 2: Take database dump**

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  pg_dump -U directus -d directus --clean --if-exists | gzip > \
  infrastructure/db-snapshots/snapshot_$(date +%Y%m%d_%H%M%S).sql.gz
```

---

### Task 1: Add `GenerateKey()` to service layer

**Files:**
- Modify: `services/gateway/internal/service/keys.go`
- Create: `services/gateway/tests/keys_generate_test.go`

- [ ] **Step 1: Write the failing test**

Create `services/gateway/tests/keys_generate_test.go`:

```go
package tests

import (
	"strings"
	"testing"

	"github.com/coignite-aps/bl-gateway/internal/service"
)

func TestGenerateKey_Format(t *testing.T) {
	gk, err := service.GenerateKey()
	if err != nil {
		t.Fatal("GenerateKey failed:", err)
	}

	if !strings.HasPrefix(gk.RawKey, "bl_") {
		t.Errorf("raw key should start with bl_, got %s", gk.RawKey[:5])
	}
	// 48 bytes → 64 base64url chars + "bl_" prefix = 67
	if len(gk.RawKey) != 67 {
		t.Errorf("expected raw key length 67, got %d", len(gk.RawKey))
	}
	// SHA256 hex = 64 chars
	if len(gk.KeyHash) != 64 {
		t.Errorf("expected key hash length 64, got %d", len(gk.KeyHash))
	}
	// Prefix = first 11 chars of raw key
	if len(gk.KeyPrefix) != 11 {
		t.Errorf("expected key prefix length 11, got %d", len(gk.KeyPrefix))
	}
	if gk.KeyPrefix != gk.RawKey[:11] {
		t.Errorf("prefix should be first 11 chars of raw key")
	}
}

func TestGenerateKey_Unique(t *testing.T) {
	gk1, _ := service.GenerateKey()
	gk2, _ := service.GenerateKey()
	if gk1.RawKey == gk2.RawKey {
		t.Error("two generated keys should not be identical")
	}
	if gk1.KeyHash == gk2.KeyHash {
		t.Error("two generated key hashes should not be identical")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/gateway && go test ./tests/ -run TestGenerateKey -v`
Expected: FAIL — `service.GenerateKey` does not exist

- [ ] **Step 3: Implement `GenerateKey`**

Add to `services/gateway/internal/service/keys.go`, after the imports (add `crypto/rand`, `encoding/base64` to imports):

```go
// GeneratedKey holds the output of key generation.
// RawKey is returned to the caller once and never stored.
// KeyHash and KeyPrefix are stored in the database.
type GeneratedKey struct {
	RawKey    string // "bl_<base64url>" — shown once at creation
	KeyHash   string // SHA256 hex — stored in api_keys.key_hash
	KeyPrefix string // first 11 chars — stored in api_keys.key_prefix
}

// GenerateKey creates a new API key with 48 bytes of randomness.
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

Add these imports to `keys.go` if not already present: `"crypto/rand"`, `"encoding/base64"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/gateway && go test ./tests/ -run TestGenerateKey -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/gateway/internal/service/keys.go services/gateway/tests/keys_generate_test.go
git commit -m "feat(gateway): extract GenerateKey into service layer"
```

---

### Task 2: Add `DefaultPermissions` to service layer

**Files:**
- Modify: `services/gateway/internal/service/permissions.go`
- Modify: `services/gateway/tests/permissions_test.go`

- [ ] **Step 1: Write the failing test**

Add to `services/gateway/tests/permissions_test.go`:

```go
func TestDefaultPermissions_AllServicesEnabled(t *testing.T) {
	dp := service.DefaultPermissions
	for _, svc := range []string{"calc", "kb", "flow"} {
		if !dp.HasServiceAccess(svc) {
			t.Errorf("DefaultPermissions should grant %s service access", svc)
		}
	}
}

func TestDefaultPermissions_WildcardAccess(t *testing.T) {
	dp := service.DefaultPermissions
	if !dp.HasAccess("calc", "any-uuid", "execute") {
		t.Error("DefaultPermissions should grant calc wildcard access")
	}
	if !dp.HasAccess("kb", "any-uuid", "search") {
		t.Error("DefaultPermissions should grant kb wildcard access")
	}
	if !dp.HasAccess("flow", "any-uuid", "trigger") {
		t.Error("DefaultPermissions should grant flow wildcard access")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/gateway && go test ./tests/ -run TestDefaultPermissions -v`
Expected: FAIL — `service.DefaultPermissions` does not exist

- [ ] **Step 3: Implement `DefaultPermissions`**

Add to bottom of `services/gateway/internal/service/permissions.go`:

```go
func strSlicePtr(s []string) *[]string { return &s }

// DefaultPermissions is the permission set for auto-provisioned keys.
// All services enabled with wildcard access. Feature flags are the real gate.
var DefaultPermissions = ResourcePermissions{
	Services: map[string]ServicePermission{
		"calc": {Enabled: true, Resources: strSlicePtr([]string{"*"}), Actions: strSlicePtr([]string{"execute", "describe"})},
		"kb":   {Enabled: true, Resources: strSlicePtr([]string{"*"}), Actions: strSlicePtr([]string{"search", "ask"})},
		"flow": {Enabled: true, Resources: strSlicePtr([]string{"*"}), Actions: strSlicePtr([]string{"trigger"})},
	},
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/gateway && go test ./tests/ -run TestDefaultPermissions -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/gateway/internal/service/permissions.go services/gateway/tests/permissions_test.go
git commit -m "feat(gateway): add DefaultPermissions constant"
```

---

### Task 3: Fix `AccountData` struct — pointer types for nullable fields

**Files:**
- Modify: `services/gateway/internal/service/keys.go`
- Modify: `services/gateway/internal/middleware/ratelimit.go`
- Modify: `services/gateway/tests/ratelimit_test.go`

- [ ] **Step 1: Update `AccountData` struct**

In `services/gateway/internal/service/keys.go`, change:

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

Changes: `RateLimitRPS int` → `*int`, `MonthlyQuota int` → `*int`, add `omitempty` tags.

- [ ] **Step 2: Simplify `lookupDB` scan**

In `lookupDB`, the intermediate `rateLimitRPS` and `monthlyQuota` pointer variables are no longer needed — scan directly into struct fields:

```go
func (ks *KeyService) lookupDB(ctx context.Context, keyHash string) (*AccountData, error) {
	if ks.db == nil {
		return nil, fmt.Errorf("database not available")
	}

	var acct AccountData
	var permJSON []byte
	var allowedOrigins, allowedIPs *[]string
	var expiresAt, revokedAt *time.Time

	err := ks.db.QueryRow(ctx, `
		SELECT id, account_id, environment, permissions,
			   allowed_origins, allowed_ips, rate_limit_rps, monthly_quota,
			   expires_at, revoked_at
		FROM api_keys WHERE key_hash = $1
	`, keyHash).Scan(
		&acct.KeyID, &acct.AccountID, &acct.Environment, &permJSON,
		&allowedOrigins, &allowedIPs, &acct.RateLimitRPS, &acct.MonthlyQuota,
		&expiresAt, &revokedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("key not found")
	}

	if revokedAt != nil {
		return nil, fmt.Errorf("key revoked")
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		return nil, fmt.Errorf("key expired")
	}

	acct.Permissions = ParsePermissions(permJSON)
	if allowedOrigins != nil {
		acct.AllowedOrigins = *allowedOrigins
	}
	if allowedIPs != nil {
		acct.AllowedIPs = *allowedIPs
	}

	return &acct, nil
}
```

- [ ] **Step 3: Simplify `lookupDBByPrefix` scan**

Same change as `lookupDB` — remove intermediate `rateLimitRPS`/`monthlyQuota` pointer variables, scan directly into struct:

```go
func (ks *KeyService) lookupDBByPrefix(ctx context.Context, prefix string) (*AccountData, error) {
	if ks.db == nil {
		return nil, fmt.Errorf("database not available")
	}

	var acct AccountData
	var permJSON []byte
	var allowedOrigins, allowedIPs *[]string
	var expiresAt, revokedAt *time.Time

	err := ks.db.QueryRow(ctx, `
		SELECT id, account_id, environment, permissions,
			   allowed_origins, allowed_ips, rate_limit_rps, monthly_quota,
			   expires_at, revoked_at
		FROM api_keys WHERE key_prefix = $1
	`, prefix).Scan(
		&acct.KeyID, &acct.AccountID, &acct.Environment, &permJSON,
		&allowedOrigins, &allowedIPs, &acct.RateLimitRPS, &acct.MonthlyQuota,
		&expiresAt, &revokedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("key not found")
	}

	if revokedAt != nil {
		return nil, fmt.Errorf("key revoked")
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		return nil, fmt.Errorf("key expired")
	}

	acct.Permissions = ParsePermissions(permJSON)
	if allowedOrigins != nil {
		acct.AllowedOrigins = *allowedOrigins
	}
	if allowedIPs != nil {
		acct.AllowedIPs = *allowedIPs
	}

	return &acct, nil
}
```

- [ ] **Step 4: Fix rate limit middleware**

In `services/gateway/internal/middleware/ratelimit.go`, line 56-59, change:

```go
// Before:
rpsLimit := acct.RateLimitRPS
if rpsLimit <= 0 {
    rpsLimit = 10 // default
}

// After:
rpsLimit := 10 // default
if acct.RateLimitRPS != nil && *acct.RateLimitRPS > 0 {
    rpsLimit = *acct.RateLimitRPS
}
```

- [ ] **Step 5: Fix rate limit test**

In `services/gateway/tests/ratelimit_test.go`, line 49, change:

```go
// Before:
RateLimitRPS: 5,

// After:
RateLimitRPS: intPtr(5),
```

Add helper at bottom of file:

```go
func intPtr(n int) *int { return &n }
```

- [ ] **Step 6: Fix middleware permissions test**

In `services/gateway/tests/permissions_test.go`, all `AccountData` literals that set `RateLimitRPS` need updating. Search for `RateLimitRPS` in the test file — currently none set it, so no changes needed. Verify by checking that `AccountData` in test literals only set `AccountID` and `Permissions`.

- [ ] **Step 7: Run all gateway tests**

Run: `cd services/gateway && go test ./... -v`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add services/gateway/internal/service/keys.go services/gateway/internal/middleware/ratelimit.go services/gateway/tests/ratelimit_test.go
git commit -m "fix(gateway): use pointer types for nullable AccountData fields"
```

---

### Task 4: Extract `insertKey` and refactor handler

**Files:**
- Modify: `services/gateway/internal/handler/apikeys.go`
- Modify: `services/gateway/tests/auto_provision_test.go`

- [ ] **Step 1: Add `insertKey` private method**

Add to `services/gateway/internal/handler/apikeys.go`, after the `Create` method:

```go
// insertKey performs the DB insert and returns the key response. Shared by Create, Rotate, AutoProvision.
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
	var scanPermJSON []byte
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
		&scanPermJSON, &resp.AllowedIPs, &resp.AllowedOrigins, &resp.RateLimitRPS, &resp.MonthlyQuota,
		&resp.ExpiresAt, &resp.LastUsedAt, &resp.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	parsed := service.ParsePermissions(scanPermJSON)
	resp.Permissions = &parsed
	resp.RawKey = gk.RawKey
	return &resp, nil
}
```

- [ ] **Step 2: Refactor `Create` to use `GenerateKey` + `insertKey`**

Replace the body of `Create` (from line 103 "Generate 48-byte" through line 156 `writeJSON`) with:

```go
func (h *APIKeyHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.AccountID == "" || req.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "account_id and name required"})
		return
	}
	if req.Environment == "" {
		req.Environment = "live"
	}
	if req.Environment != "live" && req.Environment != "test" && req.Environment != "dev" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "environment must be live, test, or dev"})
		return
	}

	gk, err := service.GenerateKey()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key generation failed"})
		return
	}

	resp, err := h.insertKey(r.Context(), gk, req)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create key"})
		return
	}

	h.invalidateKeyCache(r.Context(), gk.KeyHash, gk.KeyPrefix)
	writeJSON(w, http.StatusCreated, resp)
}
```

- [ ] **Step 3: Refactor `Rotate` to use `GenerateKey` + `insertKey`**

Replace `Rotate` with:

```go
func (h *APIKeyHandler) Rotate(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/internal/api-keys/")
	id := strings.TrimSuffix(path, "/rotate")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "key ID required"})
		return
	}

	// Get existing key details
	var old keyResponse
	var permJSON []byte
	err := h.db.QueryRow(r.Context(), `
		SELECT id, account_id, name, environment, permissions,
			allowed_ips, allowed_origins, rate_limit_rps, monthly_quota, expires_at
		FROM api_keys WHERE id = $1 AND revoked_at IS NULL
	`, id).Scan(
		&old.ID, &old.AccountID, &old.Name, &old.Environment, &permJSON,
		&old.AllowedIPs, &old.AllowedOrigins, &old.RateLimitRPS, &old.MonthlyQuota, &old.ExpiresAt,
	)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "key not found"})
		return
	}

	// Revoke old key, get its hash+prefix for cache invalidation
	var oldHash, oldPrefix string
	_ = h.db.QueryRow(r.Context(),
		`UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 RETURNING key_hash, key_prefix`, id,
	).Scan(&oldHash, &oldPrefix)

	// Create new key with same settings
	gk, err := service.GenerateKey()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key generation failed"})
		return
	}

	parsed := service.ParsePermissions(permJSON)
	req := createKeyRequest{
		AccountID:      old.AccountID,
		Name:           old.Name,
		Environment:    old.Environment,
		Permissions:    &parsed,
		AllowedIPs:     old.AllowedIPs,
		AllowedOrigins: old.AllowedOrigins,
		RateLimitRPS:   old.RateLimitRPS,
		MonthlyQuota:   old.MonthlyQuota,
		ExpiresAt:      old.ExpiresAt,
	}

	resp, err := h.insertKey(r.Context(), gk, req)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create rotated key"})
		return
	}

	h.invalidateKeyCache(r.Context(), oldHash, oldPrefix)
	h.invalidateKeyCache(r.Context(), gk.KeyHash, gk.KeyPrefix)
	writeJSON(w, http.StatusCreated, resp)
}
```

- [ ] **Step 4: Refactor `AutoProvision` to use `GenerateKey` + `insertKey`**

Replace `AutoProvision` with:

```go
func (h *APIKeyHandler) AutoProvision(w http.ResponseWriter, r *http.Request) {
	var req autoProvisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if req.AccountID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "account_id required"})
		return
	}

	// Guard: check if account already has non-revoked keys
	var count int
	err := h.db.QueryRow(r.Context(),
		`SELECT count(*) FROM api_keys WHERE account_id = $1 AND revoked_at IS NULL`,
		req.AccountID,
	).Scan(&count)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
		return
	}
	if count > 0 {
		writeJSON(w, http.StatusOK, autoProvisionResponse{
			Provisioned: false,
			Message:     "account already has keys",
		})
		return
	}

	gk, err := service.GenerateKey()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key generation failed"})
		return
	}

	defaultPerms := service.DefaultPermissions
	createReq := createKeyRequest{
		AccountID:   req.AccountID,
		Name:        "Default",
		Environment: "live",
		Permissions: &defaultPerms,
	}

	resp, err := h.insertKey(r.Context(), gk, createReq)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create key"})
		return
	}

	h.invalidateKeyCache(r.Context(), gk.KeyHash, gk.KeyPrefix)

	writeJSON(w, http.StatusCreated, autoProvisionResponse{
		Provisioned: true,
		Key:         resp,
	})
}
```

- [ ] **Step 5: Remove unused imports from handler**

After refactoring, `apikeys.go` no longer needs `"crypto/rand"`, `"crypto/sha256"`, `"encoding/base64"`, `"encoding/hex"` — these moved to `service.GenerateKey()`. Remove them from the import block. Keep `"crypto/rand"` etc. ONLY if still used elsewhere in the file (they are not).

- [ ] **Step 6: Run all gateway tests**

Run: `cd services/gateway && go test ./... -v`
Expected: All PASS (the INSERT query and args haven't changed, so pgxmock expectations still match)

- [ ] **Step 7: Commit**

```bash
git add services/gateway/internal/handler/apikeys.go services/gateway/tests/auto_provision_test.go
git commit -m "refactor(gateway): unify Create/Rotate/AutoProvision via insertKey"
```

---

### Task 5: Targeted cache invalidation

**Files:**
- Modify: `services/gateway/internal/handler/apikeys.go`

- [ ] **Step 1: Replace `invalidateAccountCache` with `invalidateKeyCache`**

Remove the old method and add:

```go
func (h *APIKeyHandler) invalidateKeyCache(ctx context.Context, keyHash, keyPrefix string) {
	if h.redis == nil {
		return
	}
	if keyHash != "" {
		h.redis.Del(ctx, "gw:key:"+keyHash)
	}
	if keyPrefix != "" {
		h.redis.Del(ctx, "gw:prefix:"+keyPrefix)
	}
}
```

- [ ] **Step 2: Update `Revoke` to get hash+prefix from RETURNING**

```go
func (h *APIKeyHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	id := extractPathParam(r.URL.Path, "/internal/api-keys/")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "key ID required"})
		return
	}

	var accountID, keyHash, keyPrefix string
	err := h.db.QueryRow(r.Context(), `
		UPDATE api_keys SET revoked_at = NOW()
		WHERE id = $1 AND revoked_at IS NULL
		RETURNING account_id, key_hash, key_prefix
	`, id).Scan(&accountID, &keyHash, &keyPrefix)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "key not found"})
		return
	}

	h.invalidateKeyCache(r.Context(), keyHash, keyPrefix)
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}
```

- [ ] **Step 3: Update `Update` to get hash+prefix from RETURNING**

```go
query := fmt.Sprintf("UPDATE api_keys SET %s WHERE id = $%d AND revoked_at IS NULL RETURNING account_id, key_hash, key_prefix",
    strings.Join(sets, ", "), argIdx)
args = append(args, id)

var accountID, keyHash, keyPrefix string
if err := h.db.QueryRow(r.Context(), query, args...).Scan(&accountID, &keyHash, &keyPrefix); err != nil {
    writeJSON(w, http.StatusNotFound, map[string]string{"error": "key not found"})
    return
}

h.invalidateKeyCache(r.Context(), keyHash, keyPrefix)
writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
```

- [ ] **Step 4: Verify `Create`, `Rotate`, `AutoProvision` already use `invalidateKeyCache`**

These were updated in Task 4 to call `h.invalidateKeyCache(r.Context(), gk.KeyHash, gk.KeyPrefix)`. Confirm no references to `invalidateAccountCache` remain.

- [ ] **Step 5: Run all gateway tests**

Run: `cd services/gateway && go test ./... -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add services/gateway/internal/handler/apikeys.go
git commit -m "fix(gateway): targeted cache invalidation instead of scan-all"
```

---

### Task 6: Migration — fix DB column default

**Files:**
- Create: `migrations/gateway/005_fix_permissions_default.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Fix permissions column default from old flat format to v3.
-- Only affects new rows that don't explicitly set permissions.
-- Existing rows were migrated by 002 and 004.

ALTER TABLE api_keys ALTER COLUMN permissions
SET DEFAULT '{"services":{"calc":{"enabled":true,"resources":["*"],"actions":["execute","describe"]},"kb":{"enabled":true,"resources":["*"],"actions":["search","ask"]},"flow":{"enabled":true,"resources":["*"],"actions":["trigger"]}}}';
```

- [ ] **Step 2: Run migration against local DB**

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -f - < migrations/gateway/005_fix_permissions_default.sql
```

- [ ] **Step 3: Verify the default changed**

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -c "\d api_keys" | grep permissions
```

Expected: default shows v3 JSON with `services` key

- [ ] **Step 4: Commit**

```bash
git add migrations/gateway/005_fix_permissions_default.sql
git commit -m "fix(gateway): update api_keys permissions column default to v3"
```

---

### Task 7: Delete dead code

**Files:**
- Delete: `services/cms/extensions/local/project-extension-formulas/src/composables/use-formula-token.ts`

- [ ] **Step 1: Verify no imports exist**

```bash
cd services/cms && grep -r "use-formula-token" extensions/local/ --include="*.ts" --include="*.vue"
```

Expected: No matches

- [ ] **Step 2: Delete the file**

```bash
rm services/cms/extensions/local/project-extension-formulas/src/composables/use-formula-token.ts
```

- [ ] **Step 3: Run formulas extension tests**

Run: `cd services/cms/extensions/local/project-extension-formulas && npm test`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add -u services/cms/extensions/local/project-extension-formulas/src/composables/use-formula-token.ts
git commit -m "chore(cms): remove dead use-formula-token composable"
```

---

### Task 8: Final verification

**Files:** None

- [ ] **Step 1: Run all gateway tests**

```bash
cd services/gateway && go test ./... -v
```

Expected: All PASS

- [ ] **Step 2: Run all CMS extension tests**

```bash
cd services/cms/extensions/local/project-extension-formulas && npm test
cd services/cms/extensions/local/project-extension-account && npm test
cd services/cms/extensions/local/project-extension-widget-api && npm test
```

Expected: All PASS

- [ ] **Step 3: Rebuild gateway container**

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml build bl-gateway && \
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d bl-gateway
```

- [ ] **Step 4: Verify auto-provision works**

```bash
# Get the internal secret from .env
source infrastructure/docker/.env
curl -s -X POST http://localhost:18080/internal/api-keys/auto-provision \
  -H "X-Internal-Secret: $GATEWAY_INTERNAL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"account_id":"test-verify-00000000-0000-0000-0000-000000000000"}' | jq .
```

Expected: `{ "provisioned": true, "key": { ... } }` or `{ "provisioned": false }` if account already has keys

- [ ] **Step 5: Verify key validation round-trip**

If a new key was created in step 4, test it:

```bash
curl -s -X POST http://localhost:18080/v1/calc/execute \
  -H "X-API-Key: <raw_key from step 4>" \
  -H "Content-Type: application/json" \
  -d '{"formula":"SUM(1,2,3)"}' | jq .
```

Expected: `{ "result": 6 }` or similar success response
