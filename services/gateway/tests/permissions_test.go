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

func TestParsePermissions_OldFlatFormat_NoAccess(t *testing.T) {
	data := []byte(`{"ai": true, "calc": true, "flow": false}`)
	rp := service.ParsePermissions(data)

	if rp.HasAccess("calc", "any-uuid", "execute") {
		t.Error("old flat format should grant NO access")
	}
	if rp.HasServiceAccess("calc") {
		t.Error("old flat format should not enable service access")
	}
}

func TestResourcePermissions_EmptyResources_NoAccess(t *testing.T) {
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "resources": [], "actions": ["execute"]}
		}
	}`)
	rp := service.ParsePermissions(data)

	if rp.HasAccess("calc", "any-uuid", "execute") {
		t.Error("empty resources should deny access")
	}
}

func TestResourcePermissions_EmptyActions_NoAccess(t *testing.T) {
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "resources": ["uuid-1"], "actions": []}
		}
	}`)
	rp := service.ParsePermissions(data)

	if rp.HasAccess("calc", "uuid-1", "execute") {
		t.Error("empty actions should deny access")
	}
}

func TestResourcePermissions_ResourceNotInList_Denied(t *testing.T) {
	data := []byte(`{
		"services": {
			"calc": {"enabled": true, "resources": ["uuid-1"], "actions": ["execute"]}
		}
	}`)
	rp := service.ParsePermissions(data)

	if rp.HasAccess("calc", "uuid-999", "execute") {
		t.Error("resource not in list should be denied")
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
		t.Error("action not in list should be denied")
	}
}

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

func TestResourcePermissions_MissingService_Denied(t *testing.T) {
	data := []byte(`{"services": {}}`)
	rp := service.ParsePermissions(data)

	if rp.HasAccess("calc", "uuid-1", "execute") {
		t.Error("missing service should deny access")
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

func TestCheckResourceAccess_Middleware_Grants(t *testing.T) {
	acct := &service.AccountData{
		AccountID: "acc-1",
		Permissions: service.ResourcePermissions{
			Services: map[string]service.ServicePermission{
				"calc": {Enabled: true, Resources: []string{"uuid-1"}, Actions: []string{"execute"}},
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
	acct := &service.AccountData{
		AccountID: "acc-1",
		Permissions: service.ResourcePermissions{
			Services: map[string]service.ServicePermission{
				"calc": {Enabled: true, Resources: []string{"uuid-1"}, Actions: []string{"execute"}},
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

func TestCheckServiceAccess_Middleware_Grants(t *testing.T) {
	acct := &service.AccountData{
		AccountID: "acc-1",
		Permissions: service.ResourcePermissions{
			Services: map[string]service.ServicePermission{
				"calc": {Enabled: true, Resources: []string{"uuid-1"}, Actions: []string{"execute"}},
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

func TestAuthMiddleware_SkipsInternalEndpoints(t *testing.T) {
	keyService := service.NewKeyService(nil, nil, 0, 0)
	handler := middleware.Auth(keyService)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/internal/api-keys", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for /internal/ path (skips API key auth), got %d", rec.Code)
	}
}
