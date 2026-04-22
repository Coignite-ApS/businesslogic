package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/coignite-aps/bl-gateway/internal/middleware"
	"github.com/coignite-aps/bl-gateway/internal/service"
)

// ---- ParsePermissions ----

func TestParsePermissions_NewFormat(t *testing.T) {
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "resources": ["uuid-1", "uuid-2"], "actions": ["execute", "describe"]},
			"ai":   {"enabled": true, "resources": ["kb-1"], "actions": ["chat"]},
			"flow": {"enabled": false}
		}
	}`)
	rp := service.ParsePermissions(data)

	if !rp.HasAccess("calc", "uuid-1", "execute") {
		t.Error("expected access to calc/uuid-1/execute")
	}
	if !rp.HasAccess("calc", "uuid-2", "describe") {
		t.Error("expected access to calc/uuid-2/describe")
	}
	if !rp.HasAccess("ai", "kb-1", "chat") {
		t.Error("expected access to ai/kb-1/chat")
	}
}

// v3: old flat format → full access (nil services), NOT deny
func TestParsePermissions_OldFlatFormat_FullAccess(t *testing.T) {
	data := []byte(`{"ai": true, "calc": true, "flow": false}`)
	rp := service.ParsePermissions(data)

	// v3: unrecognized/old format → nil services → full access
	if !rp.HasAccess("calc", "any-uuid", "execute") {
		t.Error("v3: old flat format should grant FULL access (nil services)")
	}
	if !rp.HasServiceAccess("calc") {
		t.Error("v3: old flat format should allow service access (nil services)")
	}
}

// v3: NULL column bytes → full access
func TestParsePermissions_NilBytes_FullAccess(t *testing.T) {
	rp := service.ParsePermissions(nil)
	if !rp.HasAccess("calc", "any-uuid", "execute") {
		t.Error("nil bytes should grant full access")
	}
	if !rp.HasServiceAccess("ai") {
		t.Error("nil bytes should allow service access")
	}
}

// v3: empty bytes → full access
func TestParsePermissions_EmptyBytes_FullAccess(t *testing.T) {
	rp := service.ParsePermissions([]byte{})
	if !rp.HasAccess("flow", "any-uuid", "trigger") {
		t.Error("empty bytes should grant full access")
	}
}

// ---- HasAccess: nil services map ----

func TestHasAccess_NilServicesMap_AllowAll(t *testing.T) {
	rp := service.ResourcePermissions{Services: nil}
	if !rp.HasAccess("calc", "uuid-1", "execute") {
		t.Error("nil services map should allow all access")
	}
	if !rp.HasAccess("ai", "kb-1", "chat") {
		t.Error("nil services map should allow all access")
	}
}

// ---- HasAccess: missing service ----

func TestHasAccess_MissingService_Allow(t *testing.T) {
	// v3: missing service = not configured = full access
	data := []byte(`{"services": {}}`)
	rp := service.ParsePermissions(data)

	if !rp.HasAccess("calc", "uuid-1", "execute") {
		t.Error("v3: missing service should ALLOW access (not configured = full access)")
	}
}

// ---- HasAccess: disabled service ----

func TestResourcePermissions_ServiceDisabled_Denied(t *testing.T) {
	data := []byte(`{
		"services": {
			"flow": {"enabled": false, "resources": ["uuid-1"], "actions": ["trigger"]}
		}
	}`)
	rp := service.ParsePermissions(data)

	if rp.HasAccess("flow", "uuid-1", "trigger") {
		t.Error("disabled service should deny access")
	}
	if rp.HasServiceAccess("flow") {
		t.Error("disabled service should not pass service access check")
	}
}

// ---- HasAccess: null resources/actions (nil pointer) ----

func TestHasAccess_NullResources_AllowAll(t *testing.T) {
	// resources key absent → nil pointer → allow all resources
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "actions": ["execute"]}
		}
	}`)
	rp := service.ParsePermissions(data)

	if !rp.HasAccess("calc", "any-uuid", "execute") {
		t.Error("null resources should allow any resource")
	}
	if !rp.HasAccess("calc", "another-uuid", "execute") {
		t.Error("null resources should allow any resource")
	}
}

func TestHasAccess_NullActions_AllowAll(t *testing.T) {
	// actions key absent → nil pointer → allow all actions
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "resources": ["uuid-1"]}
		}
	}`)
	rp := service.ParsePermissions(data)

	if !rp.HasAccess("calc", "uuid-1", "execute") {
		t.Error("null actions should allow any action")
	}
	if !rp.HasAccess("calc", "uuid-1", "describe") {
		t.Error("null actions should allow any action")
	}
}

func TestHasAccess_NullResourcesAndActions_AllowAll(t *testing.T) {
	// both absent → full access for this service
	data := []byte(`{
		"services": {
			"ai": {"enabled": true}
		}
	}`)
	rp := service.ParsePermissions(data)

	if !rp.HasAccess("ai", "kb-any", "chat") {
		t.Error("null resources+actions should allow all")
	}
}

// ---- HasAccess: empty array = deny ----

func TestResourcePermissions_EmptyResources_Deny(t *testing.T) {
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "resources": [], "actions": ["execute"]}
		}
	}`)
	rp := service.ParsePermissions(data)

	if rp.HasAccess("calc", "any-uuid", "execute") {
		t.Error("[] resources should deny access")
	}
}

func TestResourcePermissions_EmptyActions_Deny(t *testing.T) {
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "resources": ["uuid-1"], "actions": []}
		}
	}`)
	rp := service.ParsePermissions(data)

	if rp.HasAccess("calc", "uuid-1", "execute") {
		t.Error("[] actions should deny access")
	}
}

// ---- HasAccess: wildcard ["*"] ----

func TestHasAccess_WildcardResources_AllowAll(t *testing.T) {
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "resources": ["*"], "actions": ["execute"]}
		}
	}`)
	rp := service.ParsePermissions(data)

	if !rp.HasAccess("calc", "uuid-any", "execute") {
		t.Error(`["*"] resources should allow any resource`)
	}
	if !rp.HasAccess("calc", "uuid-other", "execute") {
		t.Error(`["*"] resources should allow any resource`)
	}
}

func TestHasAccess_WildcardActions_AllowAll(t *testing.T) {
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "resources": ["uuid-1"], "actions": ["*"]}
		}
	}`)
	rp := service.ParsePermissions(data)

	if !rp.HasAccess("calc", "uuid-1", "execute") {
		t.Error(`["*"] actions should allow any action`)
	}
	if !rp.HasAccess("calc", "uuid-1", "describe") {
		t.Error(`["*"] actions should allow any action`)
	}
}

func TestHasAccess_WildcardBoth_AllowAll(t *testing.T) {
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "resources": ["*"], "actions": ["*"]}
		}
	}`)
	rp := service.ParsePermissions(data)

	if !rp.HasAccess("calc", "uuid-anything", "do-anything") {
		t.Error(`["*"] for both should allow everything`)
	}
}

// ---- HasAccess: explicit list matching ----

func TestResourcePermissions_ResourceNotInList_Denied(t *testing.T) {
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "resources": ["uuid-1"], "actions": ["execute"]}
		}
	}`)
	rp := service.ParsePermissions(data)

	if rp.HasAccess("calc", "uuid-999", "execute") {
		t.Error("resource not in explicit list should be denied")
	}
}

func TestResourcePermissions_ActionNotInList_Denied(t *testing.T) {
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "resources": ["uuid-1"], "actions": ["describe"]}
		}
	}`)
	rp := service.ParsePermissions(data)

	if rp.HasAccess("calc", "uuid-1", "execute") {
		t.Error("action not in explicit list should be denied")
	}
}

// ---- HasServiceAccess ----

func TestHasServiceAccess_NilServicesMap_AllowAll(t *testing.T) {
	rp := service.ResourcePermissions{Services: nil}
	if !rp.HasServiceAccess("calc") {
		t.Error("nil services map should allow all service access")
	}
	if !rp.HasServiceAccess("ai") {
		t.Error("nil services map should allow all service access")
	}
}

func TestHasServiceAccess_MissingService_Allow(t *testing.T) {
	data := []byte(`{"services": {}}`)
	rp := service.ParsePermissions(data)
	if !rp.HasServiceAccess("calc") {
		t.Error("v3: missing service should ALLOW service access")
	}
}

func TestHasServiceAccess_EnabledService(t *testing.T) {
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "resources": ["uuid-1"], "actions": ["execute"]}
		}
	}`)
	rp := service.ParsePermissions(data)

	if !rp.HasServiceAccess("calc") {
		t.Error("enabled service should pass service access check")
	}
}

// ---- Middleware tests ----

func TestCheckResourceAccess_Middleware_Grants(t *testing.T) {
	resources := []string{"uuid-1"}
	actions := []string{"execute"}
	acct := &service.AccountData{
		AccountID: "acc-1",
		Permissions: service.ResourcePermissions{
			Services: map[string]service.ServicePermission{
				"calc": {Enabled: true, Resources: &resources, Actions: &actions},
			},
		},
	}

	handler := middleware.CheckResourceAccess("calc", "uuid-1", "execute")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/widget/uuid-1/execute", nil)
	ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestCheckResourceAccess_Middleware_Denies(t *testing.T) {
	resources := []string{"uuid-1"}
	actions := []string{"execute"}
	acct := &service.AccountData{
		AccountID: "acc-1",
		Permissions: service.ResourcePermissions{
			Services: map[string]service.ServicePermission{
				"calc": {Enabled: true, Resources: &resources, Actions: &actions},
			},
		},
	}

	handler := middleware.CheckResourceAccess("calc", "uuid-999", "execute")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/widget/uuid-999/execute", nil)
	ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}

	var resp map[string]string
	json.NewDecoder(rec.Body).Decode(&resp)
	if resp["error"] != "api_key_insufficient_permissions" {
		t.Errorf("expected api_key_insufficient_permissions error, got %s", resp["error"])
	}
}

func TestCheckResourceAccess_Middleware_NoAccount(t *testing.T) {
	handler := middleware.CheckResourceAccess("calc", "uuid-1", "execute")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/widget/uuid-1/execute", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 without account, got %d", rec.Code)
	}
}

func TestCheckResourceAccess_Middleware_NilPermissions_Grants(t *testing.T) {
	// v3: nil services map = full access
	acct := &service.AccountData{
		AccountID:   "acc-1",
		Permissions: service.ResourcePermissions{Services: nil},
	}

	handler := middleware.CheckResourceAccess("calc", "uuid-1", "execute")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodPost, "/v1/widget/uuid-1/execute", nil)
	ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("v3: nil permissions should grant access, got %d", rec.Code)
	}
}

func TestCheckServiceAccess_Middleware_Grants(t *testing.T) {
	resources := []string{"uuid-1"}
	actions := []string{"execute"}
	acct := &service.AccountData{
		AccountID: "acc-1",
		Permissions: service.ResourcePermissions{
			Services: map[string]service.ServicePermission{
				"calc": {Enabled: true, Resources: &resources, Actions: &actions},
			},
		},
	}

	handler := middleware.CheckServiceAccess("calc")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodGet, "/v1/widget/components", nil)
	ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestCheckServiceAccess_Middleware_Denies(t *testing.T) {
	acct := &service.AccountData{
		AccountID: "acc-1",
		Permissions: service.ResourcePermissions{
			Services: map[string]service.ServicePermission{
				"calc": {Enabled: false},
			},
		},
	}

	handler := middleware.CheckServiceAccess("calc")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodGet, "/v1/widget/components", nil)
	ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
}

func TestCheckServiceAccess_Middleware_NilPermissions_Grants(t *testing.T) {
	// v3: nil services = full access
	acct := &service.AccountData{
		AccountID:   "acc-1",
		Permissions: service.ResourcePermissions{Services: nil},
	}

	handler := middleware.CheckServiceAccess("calc")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodGet, "/v1/widget/components", nil)
	ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("v3: nil permissions should grant service access, got %d", rec.Code)
	}
}

// ---- Internal auth middleware tests ----

func TestInternalAuth_MissingSecret(t *testing.T) {
	handler := middleware.InternalAuth("test-secret")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodGet, "/internal/api-keys", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestInternalAuth_WrongSecret(t *testing.T) {
	handler := middleware.InternalAuth("test-secret")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodGet, "/internal/api-keys", nil)
	req.Header.Set("X-Internal-Secret", "wrong-secret")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
}

func TestInternalAuth_CorrectSecret(t *testing.T) {
	handler := middleware.InternalAuth("test-secret")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodGet, "/internal/api-keys", nil)
	req.Header.Set("X-Internal-Secret", "test-secret")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestAuthMiddleware_SkipsMCPKeyPrefixEndpoints(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	handler := middleware.Auth(keyService, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// MCP key prefix path should skip auth (handler does its own auth)
	req := httptest.NewRequest(http.MethodPost, "/v1/mcp/bl_abcdef12", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for /v1/mcp/:keyPrefix path (skips API key auth), got %d", rec.Code)
	}
}

func TestAuthMiddleware_DoesNotSkipMCPCalcAI(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	handler := middleware.Auth(keyService, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// /v1/mcp/calculator/ should still require X-API-Key (renamed from /v1/mcp/calc/)
	req := httptest.NewRequest(http.MethodPost, "/v1/mcp/calculator/some-endpoint", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for /v1/mcp/calculator/ without API key, got %d", rec.Code)
	}

	// /v1/mcp/ai/ should still require X-API-Key
	req2 := httptest.NewRequest(http.MethodPost, "/v1/mcp/ai/some-endpoint", nil)
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for /v1/mcp/ai/ without API key, got %d", rec2.Code)
	}
}

func TestDefaultPermissions_AllServicesEnabled(t *testing.T) {
	dp := service.DefaultPermissions
	for _, svc := range []string{"calc", "kb", "flow"} {
		if !dp.HasServiceAccess(svc) {
			t.Errorf("DefaultPermissions should grant %s service access", svc)
		}
	}
}

func TestDefaultPermissions_WildcardAccess(t *testing.T) {
	dp := service.DefaultPermissions
	if !dp.HasAccess("calc", "any-uuid", "execute") {
		t.Error("DefaultPermissions should grant calc wildcard access")
	}
	if !dp.HasAccess("kb", "any-uuid", "search") {
		t.Error("DefaultPermissions should grant kb wildcard access")
	}
	if !dp.HasAccess("flow", "any-uuid", "trigger") {
		t.Error("DefaultPermissions should grant flow wildcard access")
	}
}

func TestAuthMiddleware_SkipsInternalEndpoints(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	handler := middleware.Auth(keyService, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/internal/api-keys", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for /internal/ path (skips API key auth), got %d", rec.Code)
	}
}
