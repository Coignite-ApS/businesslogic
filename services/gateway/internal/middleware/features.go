package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/redis/go-redis/v9"
)

var routeFeatureMap = map[string]string{
	"/v1/ai/chat/":             "ai.chat",
	"/v1/ai/kb/":               "ai.kb",
	"/v1/ai/embed/":            "ai.embeddings",
	"/v1/formula/":             "formula.execute",
	"/v1/calculator/execute/":  "calculator.execute",
	"/v1/calculator/describe/": "calculator.execute",
	"/v1/mcp/formula/":         "formula.mcp",
	"/v1/mcp/calculator/":      "calculator.mcp",
	"/v1/flow/":                "flow.execute",
	"/v1/widget/":              "widget.render",
}

// CheckFeatureFlag returns (featureKey, allowed).
// featureKey is empty when no route mapping exists (passthrough).
// Checks account-level override first, then platform default; fail-closed if neither is set.
func CheckFeatureFlag(ctx context.Context, rdb *redis.Client, accountID, path string) (string, bool) {
	// Find matching feature key by prefix
	featureKey := ""
	for prefix, key := range routeFeatureMap {
		if strings.HasPrefix(path, prefix) {
			featureKey = key
			break
		}
	}

	// No mapping → passthrough
	if featureKey == "" {
		return "", true
	}

	// No Redis → fail-closed
	if rdb == nil {
		return featureKey, false
	}

	accountKey := fmt.Sprintf("cms:features:%s:%s", accountID, featureKey)
	platformKey := fmt.Sprintf("cms:features:%s", featureKey)

	vals, err := rdb.MGet(ctx, accountKey, platformKey).Result()
	if err != nil {
		return featureKey, false
	}

	// First non-nil wins (account override > platform default)
	for _, v := range vals {
		if v != nil {
			s, ok := v.(string)
			if ok {
				return featureKey, s == "1"
			}
		}
	}

	// Both nil → not registered → deny
	return featureKey, false
}

// WriteFeatureDenied writes a 403 JSON response. Exported for testing.
func WriteFeatureDenied(w http.ResponseWriter, featureKey string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	fmt.Fprintf(w, `{"error":"feature_disabled","feature":"%s","message":"This feature is not currently available"}`, featureKey)
}
