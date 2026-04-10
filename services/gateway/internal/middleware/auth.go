package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/coignite-aps/bl-gateway/internal/service"
	"github.com/redis/go-redis/v9"
)

type contextKey string

const AccountContextKey contextKey = "account"

func Auth(keyService *service.KeyService, rdb *redis.Client) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip auth for health, internal, and MCP key-prefix endpoints (MCP does its own auth via key prefix)
			if r.URL.Path == "/health" || r.URL.Path == "/metrics" || strings.HasPrefix(r.URL.Path, "/internal/") || isMCPKeyPrefixPath(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}

			apiKey := r.Header.Get("X-API-Key")
			if apiKey == "" {
				http.Error(w, `{"error":"missing API key"}`, http.StatusUnauthorized)
				return
			}

			account, err := keyService.Validate(r.Context(), apiKey)
			if err != nil {
				http.Error(w, `{"error":"invalid API key"}`, http.StatusForbidden)
				return
			}

			ctx := context.WithValue(r.Context(), AccountContextKey, account)
			r.Header.Set("X-Account-ID", account.AccountID)
			r.Header.Set("X-API-Key-ID", account.KeyID)
			r.Header.Set("X-Gateway-Auth", "true")

			// Forward permissions as JSON
			if permBytes, err := json.Marshal(account.Permissions); err == nil {
				r.Header.Set("X-API-Permissions", string(permBytes))
			}

			// Feature flag check
			featureKey, allowed := CheckFeatureFlag(r.Context(), rdb, account.AccountID, r.URL.Path)
			if !allowed {
				WriteFeatureDenied(w, featureKey)
				return
			}

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// isMCPKeyPrefixPath returns true for /v1/mcp/:keyPrefix paths.
// Excludes /v1/mcp/calculator/, /v1/mcp/formula/, and /v1/mcp/ai/ which use standard X-API-Key auth.
func isMCPKeyPrefixPath(path string) bool {
	if !strings.HasPrefix(path, "/v1/mcp/") {
		return false
	}
	rest := strings.TrimPrefix(path, "/v1/mcp/")
	return rest != "" && !strings.HasPrefix(rest, "calculator/") && !strings.HasPrefix(rest, "formula/") && !strings.HasPrefix(rest, "ai/")
}
