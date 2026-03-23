package middleware

import (
	"net"
	"net/http"
	"strings"

	"github.com/coignite-aps/bl-gateway/internal/service"
)

func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		acct, _ := r.Context().Value(AccountContextKey).(*service.AccountData)

		// Only set CORS headers for authenticated requests (F-012).
		// Unauthenticated endpoints (health, ping) do not echo origins.
		if origin != "" && acct != nil {
			if len(acct.AllowedOrigins) > 0 {
				allowed := false
				for _, o := range acct.AllowedOrigins {
					if strings.EqualFold(o, origin) {
						allowed = true
						break
					}
				}
				if !allowed {
					http.Error(w, `{"error":"origin not allowed"}`, http.StatusForbidden)
					return
				}
			}

			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key, X-Request-ID")
			w.Header().Set("Access-Control-Max-Age", "86400")
			w.Header().Set("Vary", "Origin")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// IP allowlist check
		if acct != nil && len(acct.AllowedIPs) > 0 {
			clientIP := clientAddr(r)
			if !isIPAllowed(clientIP, acct.AllowedIPs) {
				http.Error(w, `{"error":"IP not allowed"}`, http.StatusForbidden)
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}

func clientAddr(r *http.Request) string {
	// Prefer CF-Connecting-IP (behind Cloudflare)
	if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
		return ip
	}
	if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
		return strings.Split(ip, ",")[0]
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return host
}

func isIPAllowed(clientIP string, cidrs []string) bool {
	ip := net.ParseIP(clientIP)
	if ip == nil {
		return false
	}
	for _, cidr := range cidrs {
		if strings.Contains(cidr, "/") {
			_, network, err := net.ParseCIDR(cidr)
			if err == nil && network.Contains(ip) {
				return true
			}
		} else {
			if net.ParseIP(cidr) != nil && cidr == clientIP {
				return true
			}
		}
	}
	return false
}
