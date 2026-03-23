package tests

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/coignite-aps/bl-gateway/internal/middleware"
)

func TestSecurityHeaders_SetsXFrameOptions(t *testing.T) {
	handler := middleware.SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if v := rec.Header().Get("X-Frame-Options"); v != "DENY" {
		t.Errorf("expected X-Frame-Options: DENY, got %q", v)
	}
}

func TestSecurityHeaders_SetsXContentTypeOptions(t *testing.T) {
	handler := middleware.SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if v := rec.Header().Get("X-Content-Type-Options"); v != "nosniff" {
		t.Errorf("expected X-Content-Type-Options: nosniff, got %q", v)
	}
}

func TestSecurityHeaders_SetsHSTS(t *testing.T) {
	handler := middleware.SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	v := rec.Header().Get("Strict-Transport-Security")
	if v == "" {
		t.Error("expected Strict-Transport-Security header to be set")
	}
}

func TestSecurityHeaders_SetsXDNSPrefetchControl(t *testing.T) {
	handler := middleware.SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if v := rec.Header().Get("X-DNS-Prefetch-Control"); v != "off" {
		t.Errorf("expected X-DNS-Prefetch-Control: off, got %q", v)
	}
}
