package middleware

import (
	"bytes"
	"net/http"
	"time"

	"github.com/coignite-aps/bl-gateway/internal/cache"
)

// CacheResponse caches GET responses for the given TTL using the response cache.
// Skips POST and non-200 responses.
func CacheResponse(rc *cache.ResponseCache, ttl time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet || !rc.Available() {
				next.ServeHTTP(w, r)
				return
			}

			key := cache.CacheKey(r.Method, r.URL.Path, r.URL.RawQuery)

			// Check cache
			if cached, ok := rc.Get(r.Context(), key); ok {
				for k, v := range cached.Headers {
					w.Header().Set(k, v)
				}
				w.Header().Set("X-Cache", "HIT")
				w.WriteHeader(cached.StatusCode)
				w.Write(cached.Body)
				return
			}

			// Capture response
			rec := &responseRecorder{ResponseWriter: w, body: &bytes.Buffer{}, statusCode: 200}
			next.ServeHTTP(rec, r)

			// Only cache 200 responses
			if rec.statusCode == http.StatusOK {
				resp := &cache.CachedResponse{
					StatusCode: rec.statusCode,
					Headers: map[string]string{
						"Content-Type": rec.Header().Get("Content-Type"),
					},
					Body: rec.body.Bytes(),
				}
				rc.Set(r.Context(), key, resp, ttl)
			}
		})
	}
}

type responseRecorder struct {
	http.ResponseWriter
	body       *bytes.Buffer
	statusCode int
	written    bool
}

func (r *responseRecorder) WriteHeader(code int) {
	r.statusCode = code
	r.ResponseWriter.WriteHeader(code)
	r.written = true
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	if !r.written {
		r.written = true
	}
	r.body.Write(b)
	return r.ResponseWriter.Write(b)
}
