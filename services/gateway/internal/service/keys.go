package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type AccountData struct {
	AccountID      string              `json:"account_id"`
	KeyID          string              `json:"key_id"`
	Environment    string              `json:"environment"`
	Permissions    ResourcePermissions `json:"permissions"`
	AllowedOrigins []string            `json:"allowed_origins,omitempty"`
	AllowedIPs     []string            `json:"allowed_ips,omitempty"`
	RateLimitRPS   *int                `json:"rate_limit_rps,omitempty"`
	MonthlyQuota   *int                `json:"monthly_quota,omitempty"`
	// v2 per-key sublimits (task 27)
	AISpendCapMonthlyEUR *float64 `json:"ai_spend_cap_monthly_eur,omitempty"`
	KBSearchCapMonthly   *int     `json:"kb_search_cap_monthly,omitempty"`
	ModuleAllowlist      []string `json:"module_allowlist,omitempty"`     // nil = no restriction; []string{} = all blocked
	ModuleAllowlistSet   bool     `json:"module_allowlist_set,omitempty"` // true when column is non-NULL
}

type KeyService struct {
	redis            *redis.Client
	db               *pgxpool.Pool
	keyCacheTTL      time.Duration
	negativeCacheTTL time.Duration
}

func NewKeyService(rdb *redis.Client, db *pgxpool.Pool, keyCacheTTL, negativeCacheTTL time.Duration) *KeyService {
	return &KeyService{
		redis:            rdb,
		db:               db,
		keyCacheTTL:      keyCacheTTL,
		negativeCacheTTL: negativeCacheTTL,
	}
}

func (ks *KeyService) Validate(ctx context.Context, apiKey string) (*AccountData, error) {
	hash := hashKey(apiKey)
	cacheKey := fmt.Sprintf("gw:key:%s", hash)

	// Try Redis cache first
	if ks.redis != nil {
		data, err := ks.redis.Get(ctx, cacheKey).Bytes()
		if err == nil {
			if string(data) == "nil" {
				return nil, fmt.Errorf("invalid key (cached)")
			}
			var acct AccountData
			if err := json.Unmarshal(data, &acct); err == nil {
				return &acct, nil
			}
		}
	}

	// PostgreSQL fallback
	acct, err := ks.lookupDB(ctx, hash)
	if err != nil {
		// Cache negative result
		if ks.redis != nil {
			_ = ks.redis.Set(ctx, cacheKey, "nil", ks.negativeCacheTTL).Err()
		}
		return nil, err
	}

	// Cache positive result
	if ks.redis != nil {
		if data, err := json.Marshal(acct); err == nil {
			_ = ks.redis.Set(ctx, cacheKey, data, ks.keyCacheTTL).Err()
		}
	}

	return acct, nil
}

func (ks *KeyService) lookupDB(ctx context.Context, keyHash string) (*AccountData, error) {
	if ks.db == nil {
		return nil, fmt.Errorf("database not available")
	}

	var acct AccountData
	var permJSON, moduleAllowlistJSON []byte
	var allowedOrigins, allowedIPs *[]string
	var expiresAt, revokedAt *time.Time

	err := ks.db.QueryRow(ctx, `
		SELECT id, account_id, environment, permissions,
			   allowed_origins, allowed_ips, rate_limit_rps, monthly_quota,
			   expires_at, revoked_at,
			   ai_spend_cap_monthly_eur, kb_search_cap_monthly, module_allowlist
		FROM api_keys WHERE key_hash = $1
	`, keyHash).Scan(
		&acct.KeyID, &acct.AccountID, &acct.Environment, &permJSON,
		&allowedOrigins, &allowedIPs, &acct.RateLimitRPS, &acct.MonthlyQuota,
		&expiresAt, &revokedAt,
		&acct.AISpendCapMonthlyEUR, &acct.KBSearchCapMonthly, &moduleAllowlistJSON,
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
	parseModuleAllowlist(&acct, moduleAllowlistJSON)

	return &acct, nil
}

// LookupByPrefix resolves an API key by its prefix (first 11 chars, e.g. bl_xxxxxxxx).
// Used by the MCP-by-prefix endpoint where the key prefix IS the auth token in the URL.
func (ks *KeyService) LookupByPrefix(ctx context.Context, prefix string) (*AccountData, error) {
	cacheKey := fmt.Sprintf("gw:prefix:%s", prefix)

	// Try Redis cache first
	if ks.redis != nil {
		data, err := ks.redis.Get(ctx, cacheKey).Bytes()
		if err == nil {
			if string(data) == "nil" {
				return nil, fmt.Errorf("invalid key prefix (cached)")
			}
			var acct AccountData
			if err := json.Unmarshal(data, &acct); err == nil {
				return &acct, nil
			}
		}
	}

	// PostgreSQL fallback
	acct, err := ks.lookupDBByPrefix(ctx, prefix)
	if err != nil {
		if ks.redis != nil {
			_ = ks.redis.Set(ctx, cacheKey, "nil", ks.negativeCacheTTL).Err()
		}
		return nil, err
	}

	// Cache positive result
	if ks.redis != nil {
		if data, err := json.Marshal(acct); err == nil {
			_ = ks.redis.Set(ctx, cacheKey, data, ks.keyCacheTTL).Err()
		}
	}

	return acct, nil
}

func (ks *KeyService) lookupDBByPrefix(ctx context.Context, prefix string) (*AccountData, error) {
	if ks.db == nil {
		return nil, fmt.Errorf("database not available")
	}

	var acct AccountData
	var permJSON, moduleAllowlistJSON []byte
	var allowedOrigins, allowedIPs *[]string
	var expiresAt, revokedAt *time.Time

	err := ks.db.QueryRow(ctx, `
		SELECT id, account_id, environment, permissions,
			   allowed_origins, allowed_ips, rate_limit_rps, monthly_quota,
			   expires_at, revoked_at,
			   ai_spend_cap_monthly_eur, kb_search_cap_monthly, module_allowlist
		FROM api_keys WHERE key_prefix = $1
	`, prefix).Scan(
		&acct.KeyID, &acct.AccountID, &acct.Environment, &permJSON,
		&allowedOrigins, &allowedIPs, &acct.RateLimitRPS, &acct.MonthlyQuota,
		&expiresAt, &revokedAt,
		&acct.AISpendCapMonthlyEUR, &acct.KBSearchCapMonthly, &moduleAllowlistJSON,
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
	parseModuleAllowlist(&acct, moduleAllowlistJSON)

	return &acct, nil
}

// parseModuleAllowlist decodes a JSONB module_allowlist column into AccountData.
// nil JSON → ModuleAllowlistSet=false (no restriction).
// valid JSON → ModuleAllowlistSet=true, ModuleAllowlist set to decoded slice.
func parseModuleAllowlist(acct *AccountData, raw []byte) {
	if len(raw) == 0 {
		acct.ModuleAllowlistSet = false
		acct.ModuleAllowlist = nil
		return
	}
	var list []string
	if err := json.Unmarshal(raw, &list); err == nil {
		acct.ModuleAllowlistSet = true
		acct.ModuleAllowlist = list
	}
}

func (ks *KeyService) CheckRateLimit(ctx context.Context, accountID string, rpsLimit int) (allowed bool, remaining int, err error) {
	if ks.redis == nil {
		return false, 0, fmt.Errorf("redis not available")
	}

	key := fmt.Sprintf("rl:rps:%s:%d", accountID, time.Now().Unix())

	pipe := ks.redis.Pipeline()
	incrCmd := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, 2*time.Second)
	_, err = pipe.Exec(ctx)
	if err != nil {
		return false, 0, err
	}

	count := int(incrCmd.Val())
	remaining = rpsLimit - count
	if remaining < 0 {
		remaining = 0
	}
	return count <= rpsLimit, remaining, nil
}

type GeneratedKey struct {
	RawKey    string
	KeyHash   string
	KeyPrefix string
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

func hashKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

// ConstantTimeEqual provides timing-safe key comparison
func ConstantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
