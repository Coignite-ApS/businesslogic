package tests

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/coignite-aps/bl-gateway/internal/middleware"
	"github.com/coignite-aps/bl-gateway/internal/service"
)

func TestAuthMiddleware_MissingKey(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	handler := middleware.Auth(keyService, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/formula/health", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestAuthMiddleware_InvalidKey(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	handler := middleware.Auth(keyService, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/formula/health", nil)
	req.Header.Set("X-API-Key", "bl_invalid_key_12345")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
}

func TestAuthMiddleware_SkipsHealthEndpoint(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	handler := middleware.Auth(keyService, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for /health, got %d", rec.Code)
	}
}

// Regression tests: /v1/mcp/calculator/ and /v1/mcp/formula/ must NOT bypass X-API-Key auth.
// Before fix, isMCPKeyPrefixPath() checked for old "calc/" prefix, so "calculator/" would
// incorrectly match the key-prefix bypass and skip auth entirely.

func TestAuthMiddleware_MCPCalculatorRequiresAPIKey(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	handler := middleware.Auth(keyService, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/mcp/calculator/some-id", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("/v1/mcp/calculator/ must require X-API-Key: expected 401, got %d", rec.Code)
	}
}

func TestAuthMiddleware_MCPFormulaRequiresAPIKey(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	handler := middleware.Auth(keyService, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/mcp/formula/some-id", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("/v1/mcp/formula/ must require X-API-Key: expected 401, got %d", rec.Code)
	}
}

func TestAuthMiddleware_MCPAIRequiresAPIKey(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	handler := middleware.Auth(keyService, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/mcp/ai/some-id", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("/v1/mcp/ai/ must require X-API-Key: expected 401, got %d", rec.Code)
	}
}

func TestAuthMiddleware_MCPKeyPrefixSkipsAuth(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	handler := middleware.Auth(keyService, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// A legitimate key-prefix path (not calculator/, formula/, or ai/) should bypass auth
	req := httptest.NewRequest(http.MethodGet, "/v1/mcp/myKeyPrefix/sse", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("/v1/mcp/:keyPrefix should bypass auth: expected 200, got %d", rec.Code)
	}
}
