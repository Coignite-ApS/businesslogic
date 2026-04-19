package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

const sublimitCacheTTL = 60 * time.Second

// SublimitChecker performs per-API-key sublimit enforcement (task 27).
// All checks are fail-open: Redis down → DB; DB down → allow.
type SublimitChecker struct {
	db    *pgxpool.Pool
	redis *redis.Client
}

func NewSublimitChecker(db *pgxpool.Pool, rdb *redis.Client) *SublimitChecker {
	return &SublimitChecker{db: db, redis: rdb}
}

// CheckModuleAllowlist returns ("", true) if the route is allowed.
// Returns (module, false) if the key's module_allowlist blocks it.
// NULL allowlist → always allowed.
func CheckModuleAllowlist(acct *AccountData, path string) (module string, allowed bool) {
	if !acct.ModuleAllowlistSet {
		return "", true
	}
	module = InferModule(path)
	if module == "" {
		// Unknown module → allow (don't block unclassified routes)
		return "", true
	}
	for _, m := range acct.ModuleAllowlist {
		if m == module {
			return module, true
		}
	}
	return module, false
}

// InferModule maps a request path to a module name.
// Returns "" for unknown/unclassified routes.
func InferModule(path string) string {
	switch {
	case strings.HasPrefix(path, "/v1/ai/"), strings.HasPrefix(path, "/v1/mcp/ai/"):
		return "ai"
	case strings.HasPrefix(path, "/v1/kb/"), strings.HasPrefix(path, "/v1/knowledge/"):
		return "kb"
	case strings.HasPrefix(path, "/v1/calculator/"), strings.HasPrefix(path, "/v1/mcp/calculator/"), strings.HasPrefix(path, "/v1/mcp/formula/"), strings.HasPrefix(path, "/v1/formula/"), strings.HasPrefix(path, "/v1/widget/"):
		return "calculators"
	case strings.HasPrefix(path, "/v1/flows/"), strings.HasPrefix(path, "/v1/flow/"):
		return "flows"
	default:
		return ""
	}
}

// isAIRoute returns true for routes that consume AI budget.
func isAIRoute(path string) bool {
	return InferModule(path) == "ai"
}

// isKBRoute returns true for KB search/Q&A routes.
func isKBRoute(path string) bool {
	m := InferModule(path)
	return m == "kb"
}

// CheckAISpendCap checks the per-key monthly AI spend cap.
// Returns (breach, allowed, spend, cap); spend and cap are zero when allowed=true or on error.
// Uses Redis cache (60s TTL); falls through to DB on cache miss or Redis down.
func (sc *SublimitChecker) CheckAISpendCap(ctx context.Context, acct *AccountData) (breach string, allowed bool, spend float64, capVal float64) {
	if acct.AISpendCapMonthlyEUR == nil {
		return "", true, 0, 0
	}
	capVal = *acct.AISpendCapMonthlyEUR

	var err error
	spend, err = sc.getAISpend(ctx, acct.KeyID)
	if err != nil {
		// DB down → fail-open
		log.Warn().Err(err).Str("key_id", acct.KeyID).Msg("sublimit: AI spend check failed, fail-open")
		return "", true, 0, 0
	}

	if spend >= capVal {
		return "ai_spend_cap", false, spend, capVal
	}
	return "", true, 0, 0
}

// CheckKBSearchCap checks the per-key monthly KB search count cap.
// Returns (breach, allowed, count, cap); count and cap are zero when allowed=true or on error.
func (sc *SublimitChecker) CheckKBSearchCap(ctx context.Context, acct *AccountData) (breach string, allowed bool, count int, capVal int) {
	if acct.KBSearchCapMonthly == nil {
		return "", true, 0, 0
	}
	capVal = *acct.KBSearchCapMonthly

	var err error
	count, err = sc.getKBSearchCount(ctx, acct.KeyID)
	if err != nil {
		log.Warn().Err(err).Str("key_id", acct.KeyID).Msg("sublimit: KB search check failed, fail-open")
		return "", true, 0, 0
	}

	if count >= capVal {
		return "kb_search_cap", false, count, capVal
	}
	return "", true, 0, 0
}

// getAISpend returns the current-month AI spend for a key_id in EUR.
// Tries Redis cache first; falls back to DB on miss.
func (sc *SublimitChecker) getAISpend(ctx context.Context, keyID string) (float64, error) {
	cacheKey := aiSpendCacheKey(keyID)

	if sc.redis != nil {
		if val, err := sc.redis.Get(ctx, cacheKey).Float64(); err == nil {
			return val, nil
		}
	}

	if sc.db == nil {
		return 0, fmt.Errorf("database not available")
	}

	var spend float64
	err := sc.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(awl.amount_eur), 0)
		FROM ai_wallet_ledger awl
		JOIN usage_events ue ON ue.id = awl.usage_event_id
		WHERE ue.api_key_id = $1::uuid
		  AND awl.entry_type = 'debit'
		  AND awl.occurred_at >= date_trunc('month', NOW())
	`, keyID).Scan(&spend)
	if err != nil {
		return 0, fmt.Errorf("AI spend query failed: %w", err)
	}

	if sc.redis != nil {
		_ = sc.redis.Set(ctx, cacheKey, spend, sublimitCacheTTL).Err()
	}

	return spend, nil
}

// getKBSearchCount returns the current-month KB search+ask count for a key_id.
func (sc *SublimitChecker) getKBSearchCount(ctx context.Context, keyID string) (int, error) {
	cacheKey := kbSearchCacheKey(keyID)

	if sc.redis != nil {
		if val, err := sc.redis.Get(ctx, cacheKey).Int(); err == nil {
			return val, nil
		}
	}

	if sc.db == nil {
		return 0, fmt.Errorf("database not available")
	}

	var count int
	err := sc.db.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM usage_events
		WHERE api_key_id = $1::uuid
		  AND event_kind IN ('kb.search', 'kb.ask')
		  AND occurred_at >= date_trunc('month', NOW())
	`, keyID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("KB search count query failed: %w", err)
	}

	if sc.redis != nil {
		_ = sc.redis.Set(ctx, cacheKey, count, sublimitCacheTTL).Err()
	}

	return count, nil
}

// Cache invalidation (InvalidateAISpendCache / InvalidateKBSearchCache) is deferred to TTL (60s).
// Re-add when the wallet-debit hook (task 18) and usage_events emit path (task 20) publish invalidation events.

func aiSpendCacheKey(keyID string) string {
	ym := time.Now().Format("200601")
	return fmt.Sprintf("gw:apikey:%s:ai_spend_month:%s", keyID, ym)
}

func kbSearchCacheKey(keyID string) string {
	ym := time.Now().Format("200601")
	return fmt.Sprintf("gw:apikey:%s:kb_search_month:%s", keyID, ym)
}

// TriggersAISpendCap returns true for any path that consumes AI budget.
// This includes direct AI routes AND KB Q&A (/v1/kb/*/ask), which calls an LLM.
// Note: InferModule still returns "kb" for /v1/kb/*/ask — module allowlist unaffected.
func TriggersAISpendCap(path string) bool {
	if isAIRoute(path) {
		return true
	}
	// KB Q&A calls an LLM → subject to AI spend cap
	return strings.HasPrefix(path, "/v1/kb/") && strings.HasSuffix(path, "/ask")
}

// IsAIRoute and IsKBRoute exported for middleware use.
func IsAIRoute(path string) bool { return isAIRoute(path) }
func IsKBRoute(path string) bool { return isKBRoute(path) }
