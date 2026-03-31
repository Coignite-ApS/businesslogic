package service

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
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
	AllowedOrigins []string            `json:"allowed_origins"`
	AllowedIPs     []string            `json:"allowed_ips"`
	RateLimitRPS   int                 `json:"rate_limit_rps"`
	MonthlyQuota   int                 `json:"monthly_quota"`
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
	var permJSON []byte
	var allowedOrigins, allowedIPs []string
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
	acct.AllowedOrigins = allowedOrigins
	acct.AllowedIPs = allowedIPs

	return &acct, nil
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

func hashKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

// ConstantTimeEqual provides timing-safe key comparison
func ConstantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
