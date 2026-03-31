package handler

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/coignite-aps/bl-gateway/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// dbPool is the minimal interface used by APIKeyHandler, satisfied by both
// *pgxpool.Pool and pgxmock.PgxPoolIface.
type dbPool interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}

type APIKeyHandler struct {
	db    dbPool
	redis *redis.Client
}

func NewAPIKeyHandler(db *pgxpool.Pool, rdb *redis.Client) *APIKeyHandler {
	return &APIKeyHandler{db: db, redis: rdb}
}

// NewAPIKeyHandlerWithDB creates a handler with a dbPool interface (for testing).
func NewAPIKeyHandlerWithDB(db dbPool, rdb *redis.Client) *APIKeyHandler {
	return &APIKeyHandler{db: db, redis: rdb}
}

type createKeyRequest struct {
	AccountID      string                       `json:"account_id"`
	Name           string                       `json:"name"`
	Environment    string                       `json:"environment"`
	Permissions    *service.ResourcePermissions `json:"permissions"`
	AllowedIPs     []string                     `json:"allowed_ips"`
	AllowedOrigins []string                     `json:"allowed_origins"`
	RateLimitRPS   *int                         `json:"rate_limit_rps"`
	MonthlyQuota   *int                         `json:"monthly_quota"`
	ExpiresAt      *time.Time                   `json:"expires_at"`
}

type updateKeyRequest struct {
	Name           *string                      `json:"name"`
	Permissions    *service.ResourcePermissions `json:"permissions"`
	AllowedIPs     *[]string                    `json:"allowed_ips"`
	AllowedOrigins *[]string                    `json:"allowed_origins"`
	RateLimitRPS   *int                         `json:"rate_limit_rps"`
	MonthlyQuota   *int                         `json:"monthly_quota"`
}

type keyResponse struct {
	ID             string                       `json:"id"`
	KeyPrefix      string                       `json:"key_prefix"`
	RawKey         string                       `json:"raw_key,omitempty"`
	AccountID      string                       `json:"account_id"`
	Name           string                       `json:"name"`
	Environment    string                       `json:"environment"`
	Permissions    *service.ResourcePermissions `json:"permissions"`
	AllowedIPs     []string                     `json:"allowed_ips"`
	AllowedOrigins []string                     `json:"allowed_origins"`
	RateLimitRPS   *int                         `json:"rate_limit_rps"`
	MonthlyQuota   *int                         `json:"monthly_quota"`
	ExpiresAt      *time.Time                   `json:"expires_at"`
	LastUsedAt     *time.Time                   `json:"last_used_at"`
	CreatedAt      time.Time                    `json:"created_at"`
}

// Create generates a new API key. Raw key is returned ONLY in this response.
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

	// Generate 48-byte random key → base64url → prefix with bl_
	rawBytes := make([]byte, 48)
	if _, err := rand.Read(rawBytes); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key generation failed"})
		return
	}
	rawKey := "bl_" + base64.RawURLEncoding.EncodeToString(rawBytes)

	// Hash for storage
	hash := sha256.Sum256([]byte(rawKey))
	keyHash := hex.EncodeToString(hash[:])
	keyPrefix := rawKey[:11] // "bl_" + first 8 chars of encoded key

	// nil permissions → store as SQL NULL (full access, v3 default)
	var permJSON []byte
	if req.Permissions != nil {
		permJSON, _ = json.Marshal(req.Permissions)
	}

	var resp keyResponse
	err := h.db.QueryRow(r.Context(), `
		INSERT INTO api_keys (key_hash, key_prefix, account_id, environment, name,
			permissions, allowed_ips, allowed_origins, rate_limit_rps, monthly_quota, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, key_prefix, account_id, name, environment, permissions,
			allowed_ips, allowed_origins, rate_limit_rps, monthly_quota,
			expires_at, last_used_at, created_at
	`, keyHash, keyPrefix, req.AccountID, req.Environment, req.Name,
		permJSON, req.AllowedIPs, req.AllowedOrigins, req.RateLimitRPS, req.MonthlyQuota, req.ExpiresAt,
	).Scan(
		&resp.ID, &resp.KeyPrefix, &resp.AccountID, &resp.Name, &resp.Environment,
		&permJSON, &resp.AllowedIPs, &resp.AllowedOrigins, &resp.RateLimitRPS, &resp.MonthlyQuota,
		&resp.ExpiresAt, &resp.LastUsedAt, &resp.CreatedAt,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create key"})
		return
	}

	parsed := service.ParsePermissions(permJSON)
	resp.Permissions = &parsed
	resp.RawKey = rawKey

	// Invalidate account cache
	h.invalidateAccountCache(r, req.AccountID)

	writeJSON(w, http.StatusCreated, resp)
}

// List returns all non-revoked keys for an account.
func (h *APIKeyHandler) List(w http.ResponseWriter, r *http.Request) {
	accountID := r.URL.Query().Get("account_id")
	if accountID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "account_id query param required"})
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id, key_prefix, account_id, name, environment, permissions,
			allowed_ips, allowed_origins, rate_limit_rps, monthly_quota,
			expires_at, last_used_at, created_at
		FROM api_keys
		WHERE account_id = $1 AND revoked_at IS NULL
		ORDER BY created_at DESC
	`, accountID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
		return
	}
	defer rows.Close()

	var keys []keyResponse
	for rows.Next() {
		var k keyResponse
		var permJSON []byte
		if err := rows.Scan(
			&k.ID, &k.KeyPrefix, &k.AccountID, &k.Name, &k.Environment, &permJSON,
			&k.AllowedIPs, &k.AllowedOrigins, &k.RateLimitRPS, &k.MonthlyQuota,
			&k.ExpiresAt, &k.LastUsedAt, &k.CreatedAt,
		); err != nil {
			continue
		}
		p := service.ParsePermissions(permJSON)
		k.Permissions = &p
		keys = append(keys, k)
	}

	if keys == nil {
		keys = []keyResponse{}
	}
	writeJSON(w, http.StatusOK, keys)
}

// Get returns a single key by ID.
func (h *APIKeyHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := extractPathParam(r.URL.Path, "/internal/api-keys/")
	if id == "" || id == "rotate" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "key ID required"})
		return
	}

	var k keyResponse
	var permJSON []byte
	err := h.db.QueryRow(r.Context(), `
		SELECT id, key_prefix, account_id, name, environment, permissions,
			allowed_ips, allowed_origins, rate_limit_rps, monthly_quota,
			expires_at, last_used_at, created_at
		FROM api_keys WHERE id = $1 AND revoked_at IS NULL
	`, id).Scan(
		&k.ID, &k.KeyPrefix, &k.AccountID, &k.Name, &k.Environment, &permJSON,
		&k.AllowedIPs, &k.AllowedOrigins, &k.RateLimitRPS, &k.MonthlyQuota,
		&k.ExpiresAt, &k.LastUsedAt, &k.CreatedAt,
	)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "key not found"})
		return
	}
	p := service.ParsePermissions(permJSON)
	k.Permissions = &p
	writeJSON(w, http.StatusOK, k)
}

// Update modifies key metadata (permissions, IPs, origins, name).
func (h *APIKeyHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := extractPathParam(r.URL.Path, "/internal/api-keys/")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "key ID required"})
		return
	}

	var req updateKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	// Build dynamic update
	sets := []string{}
	args := []interface{}{}
	argIdx := 1

	if req.Name != nil {
		sets = append(sets, pgParam("name", &argIdx))
		args = append(args, *req.Name)
	}
	if req.Permissions != nil {
		permJSON, _ := json.Marshal(*req.Permissions)
		sets = append(sets, pgParam("permissions", &argIdx))
		args = append(args, permJSON)
	}
	if req.AllowedIPs != nil {
		sets = append(sets, pgParam("allowed_ips", &argIdx))
		args = append(args, *req.AllowedIPs)
	}
	if req.AllowedOrigins != nil {
		sets = append(sets, pgParam("allowed_origins", &argIdx))
		args = append(args, *req.AllowedOrigins)
	}
	if req.RateLimitRPS != nil {
		sets = append(sets, pgParam("rate_limit_rps", &argIdx))
		args = append(args, *req.RateLimitRPS)
	}
	if req.MonthlyQuota != nil {
		sets = append(sets, pgParam("monthly_quota", &argIdx))
		args = append(args, *req.MonthlyQuota)
	}

	if len(sets) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "no fields to update"})
		return
	}

	query := fmt.Sprintf("UPDATE api_keys SET %s WHERE id = $%d AND revoked_at IS NULL RETURNING account_id",
		strings.Join(sets, ", "), argIdx)
	args = append(args, id)

	var accountID string
	if err := h.db.QueryRow(r.Context(), query, args...).Scan(&accountID); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "key not found"})
		return
	}

	h.invalidateAccountCache(r, accountID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// Revoke soft-deletes a key by setting revoked_at.
func (h *APIKeyHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	id := extractPathParam(r.URL.Path, "/internal/api-keys/")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "key ID required"})
		return
	}

	var accountID string
	err := h.db.QueryRow(r.Context(), `
		UPDATE api_keys SET revoked_at = NOW()
		WHERE id = $1 AND revoked_at IS NULL
		RETURNING account_id
	`, id).Scan(&accountID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "key not found"})
		return
	}

	h.invalidateAccountCache(r, accountID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

// Rotate creates a new key and revokes the old one.
func (h *APIKeyHandler) Rotate(w http.ResponseWriter, r *http.Request) {
	// Path: /internal/api-keys/:id/rotate
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

	// (permJSON kept as raw bytes to pass to new key insert — no need to parse old.Permissions)

	// Revoke old key
	_, _ = h.db.Exec(r.Context(), `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1`, id)

	// Create new key with same settings
	rawBytes := make([]byte, 48)
	if _, err := rand.Read(rawBytes); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key generation failed"})
		return
	}
	rawKey := "bl_" + base64.RawURLEncoding.EncodeToString(rawBytes)
	hash := sha256.Sum256([]byte(rawKey))
	keyHash := hex.EncodeToString(hash[:])
	keyPrefix := rawKey[:11]

	var resp keyResponse
	err = h.db.QueryRow(r.Context(), `
		INSERT INTO api_keys (key_hash, key_prefix, account_id, environment, name,
			permissions, allowed_ips, allowed_origins, rate_limit_rps, monthly_quota, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, key_prefix, account_id, name, environment, permissions,
			allowed_ips, allowed_origins, rate_limit_rps, monthly_quota,
			expires_at, last_used_at, created_at
	`, keyHash, keyPrefix, old.AccountID, old.Environment, old.Name,
		permJSON, old.AllowedIPs, old.AllowedOrigins, old.RateLimitRPS, old.MonthlyQuota, old.ExpiresAt,
	).Scan(
		&resp.ID, &resp.KeyPrefix, &resp.AccountID, &resp.Name, &resp.Environment,
		&permJSON, &resp.AllowedIPs, &resp.AllowedOrigins, &resp.RateLimitRPS, &resp.MonthlyQuota,
		&resp.ExpiresAt, &resp.LastUsedAt, &resp.CreatedAt,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create rotated key"})
		return
	}

	rp := service.ParsePermissions(permJSON)
	resp.Permissions = &rp
	resp.RawKey = rawKey

	h.invalidateAccountCache(r, old.AccountID)
	writeJSON(w, http.StatusCreated, resp)
}

type autoProvisionRequest struct {
	AccountID string `json:"account_id"`
}

type autoProvisionResponse struct {
	Provisioned bool          `json:"provisioned"`
	Message     string        `json:"message,omitempty"`
	Keys        []keyResponse `json:"keys,omitempty"`
}

// AutoProvision creates test + live keys for an account that has none. Idempotent.
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

	// Generate both keys inside a transaction
	tx, err := h.db.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "transaction failed"})
		return
	}
	defer tx.Rollback(r.Context())

	var createdKeys []keyResponse

	for _, env := range []string{"test", "live"} {
		rawBytes := make([]byte, 48)
		if _, err := rand.Read(rawBytes); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key generation failed"})
			return
		}
		rawKey := "bl_" + base64.RawURLEncoding.EncodeToString(rawBytes)
		hash := sha256.Sum256([]byte(rawKey))
		keyHash := hex.EncodeToString(hash[:])
		keyPrefix := rawKey[:11]

		name := "Test"
		if env == "live" {
			name = "Live"
		}

		var resp keyResponse
		var permJSON []byte
		err = tx.QueryRow(r.Context(), `
			INSERT INTO api_keys (key_hash, key_prefix, account_id, environment, name,
				permissions, allowed_ips, allowed_origins, rate_limit_rps, monthly_quota, expires_at)
			VALUES ($1, $2, $3, $4, $5, NULL, '{}', '{}', NULL, NULL, NULL)
			RETURNING id, key_prefix, account_id, name, environment, permissions,
				allowed_ips, allowed_origins, rate_limit_rps, monthly_quota,
				expires_at, last_used_at, created_at
		`, keyHash, keyPrefix, req.AccountID, env, name,
		).Scan(
			&resp.ID, &resp.KeyPrefix, &resp.AccountID, &resp.Name, &resp.Environment,
			&permJSON, &resp.AllowedIPs, &resp.AllowedOrigins, &resp.RateLimitRPS, &resp.MonthlyQuota,
			&resp.ExpiresAt, &resp.LastUsedAt, &resp.CreatedAt,
		)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create key"})
			return
		}
		resp.Permissions = nil // full access
		resp.RawKey = rawKey
		createdKeys = append(createdKeys, resp)
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "commit failed"})
		return
	}

	h.invalidateAccountCache(r, req.AccountID)

	writeJSON(w, http.StatusCreated, autoProvisionResponse{
		Provisioned: true,
		Keys:        createdKeys,
	})
}

func (h *APIKeyHandler) invalidateAccountCache(r *http.Request, accountID string) {
	if h.redis == nil {
		return
	}
	// Clear all cached keys for this account by scanning gw:key:* pattern
	// This is a blunt approach but safe — keys re-cache on next validation
	iter := h.redis.Scan(r.Context(), 0, "gw:key:*", 100).Iterator()
	for iter.Next(r.Context()) {
		h.redis.Del(r.Context(), iter.Val())
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func extractPathParam(path, prefix string) string {
	rest := strings.TrimPrefix(path, prefix)
	rest = strings.TrimSuffix(rest, "/")
	// Don't return sub-paths (e.g., "id/rotate")
	if idx := strings.Index(rest, "/"); idx >= 0 {
		return rest[:idx]
	}
	return rest
}

func pgParam(col string, idx *int) string {
	s := fmt.Sprintf("%s = $%d", col, *idx)
	*idx++
	return s
}
