package middleware

import (
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/coignite-aps/bl-gateway/internal/service"
	"github.com/rs/zerolog/log"
)

// in-memory fallback when Redis is down
type memoryLimiter struct {
	mu      sync.Mutex
	windows map[string]*window
}

type window struct {
	count  int
	expiry time.Time
}

var fallback = &memoryLimiter{windows: make(map[string]*window)}

func (m *memoryLimiter) allow(key string, limit int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	w, ok := m.windows[key]
	if !ok || now.After(w.expiry) {
		m.windows[key] = &window{count: 1, expiry: now.Add(time.Second)}
		return true
	}
	w.count++
	return w.count <= limit
}

func RateLimit(keyService *service.KeyService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip rate limiting for health endpoints
			if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
				next.ServeHTTP(w, r)
				return
			}

			acct, ok := r.Context().Value(AccountContextKey).(*service.AccountData)
			if !ok {
				next.ServeHTTP(w, r)
				return
			}

			rpsLimit := acct.RateLimitRPS
			if rpsLimit <= 0 {
				rpsLimit = 10 // default
			}

			allowed, remaining, err := keyService.CheckRateLimit(r.Context(), acct.AccountID, rpsLimit)
			if err != nil {
				log.Warn().Err(err).Msg("redis rate limit failed, using in-memory fallback")
				memKey := fmt.Sprintf("rps:%s", acct.AccountID)
				if !fallback.allow(memKey, rpsLimit) {
					w.Header().Set("Retry-After", "1")
					http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(rpsLimit))
			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(time.Now().Add(time.Second).Unix(), 10))

			if !allowed {
				w.Header().Set("Retry-After", "1")
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
