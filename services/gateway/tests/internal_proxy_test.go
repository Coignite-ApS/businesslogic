package tests

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coignite-aps/bl-gateway/internal/proxy"
	"github.com/coignite-aps/bl-gateway/internal/routes"
)

const testInternalSecret = "test-internal-secret-12345"
const testFormulaAdminToken = "test-formula-admin-token"

func setupInternalProxyRouter(t *testing.T, backendHandler http.HandlerFunc) (*routes.Router, *httptest.Server) {
	t.Helper()
	backend := httptest.NewServer(backendHandler)
	t.Cleanup(backend.Close)

	formulaBackend, err := proxy.NewBackend("formula-api", backend.URL, 3, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	aiBackend, err := proxy.NewBackend("ai-api", backend.URL, 3, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	flowBackend, err := proxy.NewBackend("flow-trigger", backend.URL, 3, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}

	router := routes.New(routes.RouterConfig{
		Backends: map[string]*proxy.Backend{
			"formula-api":  formulaBackend,
			"ai-api":       aiBackend,
			"flow-trigger": flowBackend,
		},
		InternalSecret:       testInternalSecret,
		FormulaAPIAdminToken: testFormulaAdminToken,
	})
	return router, backend
}

func TestInternalProxy_RequiresSecret(t *testing.T) {
	router, _ := setupInternalProxyRouter(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	paths := []string{"/internal/formula/health", "/internal/ai/health", "/internal/flow/health"}

	for _, path := range paths {
		t.Run("no secret "+path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("expected 401, got %d for %s", rec.Code, path)
			}
		})

		t.Run("wrong secret "+path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.Header.Set("X-Internal-Secret", "wrong-secret")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusForbidden {
				t.Errorf("expected 403, got %d for %s", rec.Code, path)
			}
		})
	}
}

func TestInternalProxy_ProxiesCorrectly(t *testing.T) {
	var receivedPath string
	var receivedMethod string
	var receivedBody string

	router, _ := setupInternalProxyRouter(t, func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		receivedMethod = r.Method
		if r.Body != nil {
			b, _ := io.ReadAll(r.Body)
			receivedBody = string(b)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	})

	tests := []struct {
		name     string
		method   string
		path     string
		body     string
		wantPath string
	}{
		{"formula GET", http.MethodGet, "/internal/formula/health", "", "/health"},
		{"formula POST", http.MethodPost, "/internal/formula/execute/calculator/123", `{"inputs":{}}`, "/execute/calculator/123"},
		{"ai GET", http.MethodGet, "/internal/ai/chat/conversations", "", "/chat/conversations"},
		{"ai POST", http.MethodPost, "/internal/ai/chat/send", `{"message":"hi"}`, "/chat/send"},
		{"flow POST", http.MethodPost, "/internal/flow/webhook/trigger", `{"flow":"f1"}`, "/webhook/trigger"},
		{"flow GET", http.MethodGet, "/internal/flow/status", "", "/status"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var body io.Reader
			if tt.body != "" {
				body = strings.NewReader(tt.body)
			}
			req := httptest.NewRequest(tt.method, tt.path, body)
			req.Header.Set("X-Internal-Secret", testInternalSecret)
			if tt.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Errorf("expected 200, got %d", rec.Code)
			}
			if receivedPath != tt.wantPath {
				t.Errorf("expected backend path %q, got %q", tt.wantPath, receivedPath)
			}
			if receivedMethod != tt.method {
				t.Errorf("expected method %s, got %s", tt.method, receivedMethod)
			}
			if tt.body != "" && receivedBody != tt.body {
				t.Errorf("expected body %q, got %q", tt.body, receivedBody)
			}
		})
	}
}

func TestInternalProxy_StripsInternalSecret(t *testing.T) {
	var receivedHeaders http.Header

	router, _ := setupInternalProxyRouter(t, func(w http.ResponseWriter, r *http.Request) {
		receivedHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/internal/formula/health", nil)
	req.Header.Set("X-Internal-Secret", testInternalSecret)
	req.Header.Set("X-Custom-Header", "keep-me")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if receivedHeaders.Get("X-Internal-Secret") != "" {
		t.Error("X-Internal-Secret should be stripped before proxying")
	}
	if receivedHeaders.Get("X-Custom-Header") != "keep-me" {
		t.Error("other headers should be preserved")
	}
}

func TestInternalProxy_ForwardsUserContext(t *testing.T) {
	var receivedHeaders http.Header

	router, _ := setupInternalProxyRouter(t, func(w http.ResponseWriter, r *http.Request) {
		receivedHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/internal/ai/chat/send", nil)
	req.Header.Set("X-Internal-Secret", testInternalSecret)
	req.Header.Set("X-User-Id", "user-123")
	req.Header.Set("X-Account-Id", "acct-456")
	req.Header.Set("X-Account-Role", "admin")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if receivedHeaders.Get("X-User-Id") != "user-123" {
		t.Error("X-User-Id should be forwarded")
	}
	if receivedHeaders.Get("X-Account-Id") != "acct-456" {
		t.Error("X-Account-Id should be forwarded")
	}
	if receivedHeaders.Get("X-Account-Role") != "admin" {
		t.Error("X-Account-Role should be forwarded")
	}
}

func TestInternalProxy_InjectsAdminTokenForFormula(t *testing.T) {
	var receivedHeaders http.Header

	router, _ := setupInternalProxyRouter(t, func(w http.ResponseWriter, r *http.Request) {
		receivedHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
	})

	// /internal/formula/ should get X-Admin-Token injected
	req := httptest.NewRequest(http.MethodGet, "/internal/formula/health", nil)
	req.Header.Set("X-Internal-Secret", testInternalSecret)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if receivedHeaders.Get("X-Admin-Token") != testFormulaAdminToken {
		t.Errorf("expected X-Admin-Token %q, got %q", testFormulaAdminToken, receivedHeaders.Get("X-Admin-Token"))
	}
}

func TestInternalProxy_NoAdminTokenForNonFormula(t *testing.T) {
	var receivedHeaders http.Header

	router, _ := setupInternalProxyRouter(t, func(w http.ResponseWriter, r *http.Request) {
		receivedHeaders = r.Header.Clone()
		w.WriteHeader(http.StatusOK)
	})

	// /internal/ai/ should NOT get X-Admin-Token (non-formula route)
	req := httptest.NewRequest(http.MethodGet, "/internal/ai/chat/send", nil)
	req.Header.Set("X-Internal-Secret", testInternalSecret)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if receivedHeaders.Get("X-Admin-Token") != "" {
		t.Error("X-Admin-Token should NOT be injected for non-formula routes")
	}
}

// TestInternalProxy_BlanketAuth_UnknownRoute proves that ANY /internal/ path
// requires InternalAuth even if no handler is explicitly registered for it.
// This is the defense-in-depth guarantee: forgetting per-route middleware
// cannot create an unauthenticated internal endpoint.
func TestInternalProxy_BlanketAuth_UnknownRoute(t *testing.T) {
	router, _ := setupInternalProxyRouter(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// A path under /internal/ that has no explicit handler registration
	unknownPaths := []string{
		"/internal/unknown-service/foo",
		"/internal/new-route",
		"/internal/debug/something",
	}

	for _, path := range unknownPaths {
		t.Run("no secret "+path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("expected 401 for unauthenticated %s, got %d", path, rec.Code)
			}
		})

		t.Run("wrong secret "+path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.Header.Set("X-Internal-Secret", "wrong-secret")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusForbidden {
				t.Errorf("expected 403 for bad secret on %s, got %d", path, rec.Code)
			}
		})

		t.Run("valid secret "+path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.Header.Set("X-Internal-Secret", testInternalSecret)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			// With valid secret, request passes auth — gets 404 from mux (no handler)
			// The key point: it does NOT get 401/403, proving auth passed
			if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden {
				t.Errorf("expected auth to pass for valid secret on %s, got %d", path, rec.Code)
			}
		})
	}
}
