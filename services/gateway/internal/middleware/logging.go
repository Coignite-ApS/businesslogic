package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/coignite-aps/bl-gateway/internal/service"
)

type responseWriter struct {
	http.ResponseWriter
	status int
	size   int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.size += n
	return n, err
}

// Logging is the base request logger (already existed — logs every request via zerolog).
func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(rw, r)

		duration := time.Since(start)
		var event *zerolog.Event
		if rw.status >= 500 {
			event = log.Error()
		} else if rw.status >= 400 {
			event = log.Warn()
		} else {
			event = log.Info()
		}

		event.
			Str("method", r.Method).
			Str("path", r.URL.Path).
			Int("status", rw.status).
			Int("size", rw.size).
			Dur("duration", duration).
			Str("request_id", r.Header.Get(RequestIDHeader)).
			Str("remote_addr", r.RemoteAddr).
			Msg("request")
	})
}

// RequestLogFn is the function signature for inserting a request log row.
// Production wires this to a pgxpool INSERT; tests supply a mock.
type RequestLogFn func(accountID, apiKeyID, method, path string, status, latencyMS, reqSize, respSize int)

// isSkippedPath returns true for routes that are never logged (health, metrics, public).
func isSkippedPath(path string) bool {
	return path == "/health" ||
		path == "/metrics" ||
		strings.HasPrefix(path, "/public/")
}

// RequestLog records every authenticated request to gateway.request_log via logFn.
// The INSERT is fire-and-forget: failures are logged at warn level and never returned.
func RequestLog(logFn RequestLogFn) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rw, r)

			// Skip unauthenticated / health routes
			if isSkippedPath(r.URL.Path) {
				return
			}

			// Only log when account context is present (i.e., auth passed)
			acct, _ := r.Context().Value(AccountContextKey).(*service.AccountData)
			if acct == nil {
				return
			}

			latencyMS := int(time.Since(start).Milliseconds())
			reqSize := int(r.ContentLength)
			if reqSize < 0 {
				reqSize = 0
			}
			respSize := rw.size
			status := rw.status
			method := r.Method
			path := r.URL.Path
			accountID := acct.AccountID
			apiKeyID := acct.KeyID

			// Fire-and-forget: INSERT must never block response
			go func() {
				defer func() {
					if rec := recover(); rec != nil {
						log.Warn().Interface("panic", rec).Msg("request_log insert panicked")
					}
				}()
				logFn(accountID, apiKeyID, method, path, status, latencyMS, reqSize, respSize)
			}()
		})
	}
}

// AuditLogFn receives structured fields for /internal/* audit logging.
type AuditLogFn func(fields map[string]interface{})

// InternalAudit writes a structured log line for every /internal/* request.
// Fields: timestamp, ip, user_id, account_id, method, path, status, latency_ms.
func InternalAudit(auditFn AuditLogFn) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rw, r)

			latencyMS := int(time.Since(start).Milliseconds())

			fields := map[string]interface{}{
				"timestamp":  start.UTC().Format(time.RFC3339),
				"ip":         r.RemoteAddr,
				"user_id":    r.Header.Get("X-User-Id"),
				"account_id": r.Header.Get("X-Account-Id"),
				"method":     r.Method,
				"path":       r.URL.Path,
				"status":     rw.status,
				"latency_ms": latencyMS,
			}

			if auditFn != nil {
				auditFn(fields)
			} else {
				// Default: emit via zerolog at info level
				log.Info().
					Str("timestamp", fields["timestamp"].(string)).
					Str("ip", fields["ip"].(string)).
					Str("user_id", fields["user_id"].(string)).
					Str("account_id", fields["account_id"].(string)).
					Str("method", fields["method"].(string)).
					Str("path", fields["path"].(string)).
					Int("status", fields["status"].(int)).
					Int("latency_ms", fields["latency_ms"].(int)).
					Msg("internal_audit")
			}
		})
	}
}
