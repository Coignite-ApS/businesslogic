package middleware

import (
	"net/http"

	"github.com/coignite-aps/bl-gateway/internal/service"
)

// InternalAuth authenticates /internal/ routes using a shared secret.
// Returns 500 if secret not configured, 401 if header missing, 403 if wrong secret.
func InternalAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if secret == "" {
				http.Error(w, `{"error":"internal auth not configured"}`, http.StatusInternalServerError)
				return
			}
			provided := r.Header.Get("X-Internal-Secret")
			if provided == "" {
				http.Error(w, `{"error":"missing X-Internal-Secret"}`, http.StatusUnauthorized)
				return
			}
			if !service.ConstantTimeEqual(provided, secret) {
				http.Error(w, `{"error":"invalid internal secret"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
