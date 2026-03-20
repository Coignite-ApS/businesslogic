package proxy

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

type Backend struct {
	Name    string
	URL     *url.URL
	Proxy   *httputil.ReverseProxy
	circuit *circuitBreaker
}

type circuitBreaker struct {
	mu        sync.Mutex
	failures  int
	threshold int
	timeout   time.Duration
	openUntil time.Time
}

func (cb *circuitBreaker) isOpen() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	if cb.failures >= cb.threshold {
		if time.Now().Before(cb.openUntil) {
			return true
		}
		// half-open: reset and allow a probe
		cb.failures = 0
	}
	return false
}

func (cb *circuitBreaker) recordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures++
	if cb.failures >= cb.threshold {
		cb.openUntil = time.Now().Add(cb.timeout)
		log.Warn().Str("open_until", cb.openUntil.Format(time.RFC3339)).Msg("circuit breaker opened")
	}
}

func (cb *circuitBreaker) recordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures = 0
}

func NewBackend(name, rawURL string, threshold int, timeout time.Duration) (*Backend, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}

	b := &Backend{
		Name: name,
		URL:  u,
		circuit: &circuitBreaker{
			threshold: threshold,
			timeout:   timeout,
		},
	}

	proxy := httputil.NewSingleHostReverseProxy(u)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		b.circuit.recordFailure()
		log.Error().Err(err).Str("backend", name).Msg("proxy error")
		http.Error(w, `{"error":"service unavailable"}`, http.StatusBadGateway)
	}

	originalDirector := proxy.Director
	proxy.Director = func(r *http.Request) {
		originalDirector(r)
		r.Header.Set("X-Forwarded-For", r.RemoteAddr)
	}

	proxy.ModifyResponse = func(resp *http.Response) error {
		if resp.StatusCode >= 500 {
			b.circuit.recordFailure()
		} else {
			b.circuit.recordSuccess()
		}
		return nil
	}

	b.Proxy = proxy
	return b, nil
}

func (b *Backend) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if b.circuit.isOpen() {
		http.Error(w, `{"error":"service unavailable (circuit open)"}`, http.StatusServiceUnavailable)
		return
	}
	b.Proxy.ServeHTTP(w, r)
}
