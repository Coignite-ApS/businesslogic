package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/coignite-aps/bl-gateway/internal/proxy"
)

func TestHealthChecker_Handler(t *testing.T) {
	backends := []*proxy.Backend{}
	hc := proxy.NewHealthChecker(backends, 0)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	hc.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}

	var resp proxy.HealthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse health response: %v", err)
	}
	if resp.Status != "healthy" {
		t.Errorf("expected healthy status, got %s", resp.Status)
	}
}

func TestCircuitBreaker_OpensAfterFailures(t *testing.T) {
	// Start a backend that always returns 503
	failServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer failServer.Close()

	backend, err := proxy.NewBackend("test", failServer.URL, 3, 0)
	if err != nil {
		t.Fatalf("failed to create backend: %v", err)
	}

	// Send 3 requests to trigger circuit breaker
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		rec := httptest.NewRecorder()
		backend.ServeHTTP(rec, req)
	}

	// 4th request should get circuit-open 503
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	backend.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 (circuit open), got %d", rec.Code)
	}
}

func TestBackend_ProxiesRequest(t *testing.T) {
	backendServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}))
	defer backendServer.Close()

	backend, err := proxy.NewBackend("test", backendServer.URL, 3, 0)
	if err != nil {
		t.Fatalf("failed to create backend: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()

	backend.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if rec.Body.String() != `{"ok":true}` {
		t.Errorf("unexpected body: %s", rec.Body.String())
	}
}
