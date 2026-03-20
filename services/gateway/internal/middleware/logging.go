package middleware

import (
	"net/http"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
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
