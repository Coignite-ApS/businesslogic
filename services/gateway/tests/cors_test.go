package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/coignite-aps/bl-gateway/internal/middleware"
	"github.com/coignite-aps/bl-gateway/internal/service"
)

func TestCORS_NoOriginEchoWithoutAccount(t *testing.T) {
	// F-012: unauthenticated requests must NOT echo arbitrary origins
	handler := middleware.CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Origin", "https://evil.com")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if v := rec.Header().Get("Access-Control-Allow-Origin"); v != "" {
		t.Errorf("expected no Access-Control-Allow-Origin without account, got %q", v)
	}
}

func TestCORS_EchosOriginWithAuthenticatedAccount(t *testing.T) {
	// Authenticated requests with no origin restrictions should echo origin
	acct := &service.AccountData{}

	handler := middleware.CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Origin", "https://example.com")
	ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "https://example.com" {
		t.Errorf("expected origin echo, got %s", rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestCORS_BlocksDisallowedOrigin(t *testing.T) {
	acct := &service.AccountData{
		AllowedOrigins: []string{"https://allowed.com"},
	}

	handler := middleware.CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Origin", "https://evil.com")
	ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
}

func TestCORS_AllowsMatchingOrigin(t *testing.T) {
	acct := &service.AccountData{
		AllowedOrigins: []string{"https://allowed.com"},
	}

	handler := middleware.CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Origin", "https://allowed.com")
	ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestCORS_PreflightWithAccount(t *testing.T) {
	acct := &service.AccountData{}
	handler := middleware.CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodOptions, "/test", nil)
	req.Header.Set("Origin", "https://example.com")
	ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("expected 204 for preflight, got %d", rec.Code)
	}
	if v := rec.Header().Get("Access-Control-Allow-Origin"); v != "https://example.com" {
		t.Errorf("expected origin echo on preflight, got %q", v)
	}
}

func TestCORS_PreflightWithoutAccount(t *testing.T) {
	handler := middleware.CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodOptions, "/test", nil)
	req.Header.Set("Origin", "https://example.com")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("expected 204 for preflight, got %d", rec.Code)
	}
	if v := rec.Header().Get("Access-Control-Allow-Origin"); v != "" {
		t.Errorf("expected no CORS header without account, got %q", v)
	}
}

func TestIPAllowlist_BlocksDisallowedIP(t *testing.T) {
	acct := &service.AccountData{
		AllowedIPs: []string{"203.0.113.0/24"},
	}

	handler := middleware.CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.RemoteAddr = "192.168.1.1:12345"
	ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
}

func TestIPAllowlist_AllowsMatchingIP(t *testing.T) {
	acct := &service.AccountData{
		AllowedIPs: []string{"203.0.113.0/24"},
	}

	handler := middleware.CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.RemoteAddr = "203.0.113.42:12345"
	ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}
