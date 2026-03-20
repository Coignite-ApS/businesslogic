package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/coignite-aps/bl-gateway/internal/middleware"
	"github.com/coignite-aps/bl-gateway/internal/service"
)

func TestRateLimit_SkipsHealthEndpoint(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	handler := middleware.RateLimit(keyService)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for /health, got %d", rec.Code)
	}
}

func TestRateLimit_NoAccountPassesThrough(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	handler := middleware.RateLimit(keyService)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/calc/test", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 without account context, got %d", rec.Code)
	}
}

func TestRateLimit_WithAccountNoRedis_FallsBackToMemory(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	acct := &service.AccountData{
		AccountID:    "test-account-123",
		RateLimitRPS: 5,
	}

	handler := middleware.RateLimit(keyService)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Should use in-memory fallback since no Redis
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodGet, "/v1/calc/test", nil)
		ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
		req = req.WithContext(ctx)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("request %d: expected 200, got %d", i+1, rec.Code)
		}
	}
}
