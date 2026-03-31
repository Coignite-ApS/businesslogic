package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coignite-aps/bl-gateway/internal/middleware"
	"github.com/coignite-aps/bl-gateway/internal/proxy"
	"github.com/coignite-aps/bl-gateway/internal/routes"
	"github.com/coignite-aps/bl-gateway/internal/service"
)

// setupMCPRouter creates a router with a mock formula-api backend.
func setupMCPRouter(t *testing.T, backendHandler http.HandlerFunc) (*routes.Router, *httptest.Server) {
	t.Helper()
	backend := httptest.NewServer(backendHandler)
	t.Cleanup(backend.Close)

	formulaBackend, err := proxy.NewBackend("formula-api", backend.URL, 3, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}

	router := routes.New(routes.RouterConfig{
		Backends: map[string]*proxy.Backend{
			"formula-api": formulaBackend,
		},
	})
	return router, backend
}

// withCalcAuth wraps a handler with an authenticated account context that has calc access.
func withCalcAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		acct := &service.AccountData{
			AccountID: "acct-mcp-001",
			KeyID:     "key-mcp-001",
			Permissions: service.ResourcePermissions{
				Services: map[string]service.ServicePermission{
					"calc": {Enabled: true, Resources: &[]string{"*"}, Actions: &[]string{"*"}},
				},
			},
		}
		ctx := context.WithValue(r.Context(), middleware.AccountContextKey, acct)
		r.Header.Set("X-Account-ID", acct.AccountID)
		r.Header.Set("X-API-Key-ID", acct.KeyID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func TestMCPAccountRoute_ProxiesToFormulaAPI(t *testing.T) {
	var receivedPath string
	var receivedMethod string

	router, _ := setupMCPRouter(t, func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		receivedMethod = r.Method
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{}}`))
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/mcp/account/acct-mcp-001", strings.NewReader(`{"jsonrpc":"2.0","method":"tools/list","id":1}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	// Simulate authenticated request
	withCalcAuth(router).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if receivedMethod != http.MethodPost {
		t.Errorf("expected POST to backend, got %s", receivedMethod)
	}
	if receivedPath != "/mcp/account/acct-mcp-001" {
		t.Errorf("expected backend path /mcp/account/acct-mcp-001, got %s", receivedPath)
	}
}

func TestMCPAccountRoute_RequiresAPIKey(t *testing.T) {
	router, _ := setupMCPRouter(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/mcp/account/acct-mcp-001", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	// No auth context set — gateway should reject
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden && rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401/403 without auth, got %d", rec.Code)
	}
}

func TestMCPAccountRoute_RequiresCalcPermission(t *testing.T) {
	router, _ := setupMCPRouter(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// Account with calc explicitly disabled (v3: missing = allow, so must set enabled: false to deny)
	noCalcAuth := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			acct := &service.AccountData{
				AccountID: "acct-nocalc",
				KeyID:     "key-nocalc",
				Permissions: service.ResourcePermissions{
					Services: map[string]service.ServicePermission{
						"ai":   {Enabled: true, Resources: &[]string{"*"}, Actions: &[]string{"*"}},
						"calc": {Enabled: false}, // explicitly disabled
					},
				},
			}
			ctx := context.WithValue(r.Context(), middleware.AccountContextKey, acct)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/mcp/account/acct-nocalc", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	noCalcAuth(router).ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 without calc permission, got %d", rec.Code)
	}
}

func TestMCPAccountRoute_ForwardsGatewayHeaders(t *testing.T) {
	var receivedHeaders http.Header

	router, _ := setupMCPRouter(t, func(w http.ResponseWriter, r *http.Request) {
		receivedHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{}`))
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/mcp/account/acct-mcp-001", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	withCalcAuth(router).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	// The auth middleware sets X-Account-ID and X-API-Key-ID on the request
	if receivedHeaders.Get("X-Account-ID") != "acct-mcp-001" {
		t.Errorf("expected X-Account-ID acct-mcp-001, got %q", receivedHeaders.Get("X-Account-ID"))
	}
}
