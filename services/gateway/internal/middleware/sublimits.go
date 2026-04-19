package middleware

import (
	"net/http"

	"github.com/coignite-aps/bl-gateway/internal/service"
)

// Sublimits enforces per-API-key v2 caps (task 27):
//   - module_allowlist  → 403
//   - ai_spend_cap      → 402
//   - kb_search_cap     → 429
//
// Runs AFTER Auth (account is already in context).
// All checks are fail-open: errors → allow.
func Sublimits(checker *service.SublimitChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			acct, ok := r.Context().Value(AccountContextKey).(*service.AccountData)
			if !ok || acct == nil {
				// No account in context (unauthenticated path) — skip
				next.ServeHTTP(w, r)
				return
			}

			path := r.URL.Path

			// 1. Module allowlist — zero DB cost
			if module, allowed := service.CheckModuleAllowlist(acct, path); !allowed {
				w.Header().Set("X-RateLimit-Breached", "module_allowlist")
				http.Error(w, `{"error":"API key not permitted for module: `+module+`"}`, http.StatusForbidden)
				return
			}

			// 2. AI spend cap — cache-backed
			if service.IsAIRoute(path) && checker != nil {
				if breach, allowed := checker.CheckAISpendCap(r.Context(), acct); !allowed {
					w.Header().Set("X-RateLimit-Breached", breach)
					http.Error(w, `{"error":"API key monthly AI spend cap reached"}`, http.StatusPaymentRequired)
					return
				}
			}

			// 3. KB search cap — cache-backed
			// KB Q&A (/v1/kb/*/ask) counts as BOTH kb (allowlist already checked above) AND kb search cap.
			if service.IsKBRoute(path) && checker != nil {
				if breach, allowed := checker.CheckKBSearchCap(r.Context(), acct); !allowed {
					w.Header().Set("X-RateLimit-Breached", breach)
					http.Error(w, `{"error":"API key monthly KB search cap reached"}`, http.StatusTooManyRequests)
					return
				}
			}

			next.ServeHTTP(w, r)
		})
	}
}
