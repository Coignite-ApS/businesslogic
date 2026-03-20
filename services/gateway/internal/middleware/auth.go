package middleware

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/coignite-aps/bl-gateway/internal/service"
)

type contextKey string

const AccountContextKey contextKey = "account"

func Auth(keyService *service.KeyService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip auth for health endpoints
			if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
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
			if len(account.Permissions) > 0 {
				if permBytes, err := json.Marshal(account.Permissions); err == nil {
					r.Header.Set("X-API-Permissions", string(permBytes))
				}
			}

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
