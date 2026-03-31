package middleware

import (
	"encoding/json"
	"net/http"

	"github.com/coignite-aps/bl-gateway/internal/service"
)

// CheckResourceAccess verifies the API key has permission for the requested
// service, resource, and action. Returns 403 on denial.
func CheckResourceAccess(svc, resourceID, action string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			acct, ok := r.Context().Value(AccountContextKey).(*service.AccountData)
			if !ok || acct == nil {
				writePermError(w, "missing account context")
				return
			}

			if !acct.Permissions.HasAccess(svc, resourceID, action) {
				writePermError(w, "key does not grant access to this resource")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// CheckServiceAccess verifies the API key has the service enabled (for catalog
// endpoints that don't target a specific resource).
func CheckServiceAccess(svc string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			acct, ok := r.Context().Value(AccountContextKey).(*service.AccountData)
			if !ok || acct == nil {
				writePermError(w, "missing account context")
				return
			}

			if !acct.Permissions.HasServiceAccess(svc) {
				writePermError(w, "key does not grant access to this service")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func writePermError(w http.ResponseWriter, detail string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	resp := map[string]string{
		"error":  "api_key_insufficient_permissions",
		"detail": detail,
	}
	json.NewEncoder(w).Encode(resp)
}
