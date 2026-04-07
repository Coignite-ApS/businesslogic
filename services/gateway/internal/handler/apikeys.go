package handler

import (
	"context"
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

// insertKey performs the INSERT + RETURNING scan shared by Create, Rotate, and AutoProvision.
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

	oldPerms := service.ParsePermissions(permJSON)

	// Revoke old key
	_, _ = h.db.Exec(r.Context(), `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1`, id)

	// Create new key with same settings
	gk, err := service.GenerateKey()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "key generation failed"})
		return
	}

	resp, err := h.insertKey(r.Context(), gk, createKeyRequest{
		AccountID:      old.AccountID,
		Name:           old.Name,
		Environment:    old.Environment,
		Permissions:    &oldPerms,
		AllowedIPs:     old.AllowedIPs,
		AllowedOrigins: old.AllowedOrigins,
		RateLimitRPS:   old.RateLimitRPS,
		MonthlyQuota:   old.MonthlyQuota,
		ExpiresAt:      old.ExpiresAt,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create rotated key"})
		return
	}

	h.invalidateAccountCache(r, old.AccountID)
	writeJSON(w, http.StatusCreated, resp)
}

type autoProvisionRequest struct {
	AccountID string `json:"account_id"`
}

type autoProvisionResponse struct {
	Provisioned bool         `json:"provisioned"`
	Message     string       `json:"message,omitempty"`
	Key         *keyResponse `json:"key,omitempty"`
}

// AutoProvision creates a test key for an account that has none. Idempotent.
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
	resp, err := h.insertKey(r.Context(), gk, createKeyRequest{
		AccountID:   req.AccountID,
		Name:        "Default",
		Environment: "live",
		Permissions: &defaultPerms,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create key"})
		return
	}

	h.invalidateAccountCache(r, req.AccountID)

	writeJSON(w, http.StatusCreated, autoProvisionResponse{
		Provisioned: true,
		Key:         resp,
	})
}

type checkLiveKeyResponse struct {
	HasLiveKey bool `json:"has_live_key"`
	KeyCount   int  `json:"key_count"`
}

// CheckLiveKey returns whether an account has any live-environment non-revoked keys.
func (h *APIKeyHandler) CheckLiveKey(w http.ResponseWriter, r *http.Request) {
	accountID := r.URL.Query().Get("account_id")
	if accountID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "account_id query param required"})
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT environment FROM api_keys
		WHERE account_id = $1 AND revoked_at IS NULL
	`, accountID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
		return
	}
	defer rows.Close()

	var total int
	var hasLive bool
	for rows.Next() {
		var env string
		if err := rows.Scan(&env); err != nil {
			continue
		}
		total++
		if env == "live" {
			hasLive = true
		}
	}

	writeJSON(w, http.StatusOK, checkLiveKeyResponse{
		HasLiveKey: hasLive,
		KeyCount:   total,
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
