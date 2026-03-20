package middleware

import (
	"context"
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
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
