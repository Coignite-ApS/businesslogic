package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coignite-aps/bl-gateway/internal/handler"
	"github.com/coignite-aps/bl-gateway/internal/routes"
	"github.com/pashagolub/pgxmock/v4"
)

const testAutoProvisionAccountID = "550e8400-e29b-41d4-a716-446655440000"

func setupAutoProvisionRouter(t *testing.T, mock pgxmock.PgxPoolIface) *routes.Router {
	t.Helper()
	h := handler.NewAPIKeyHandlerWithDB(mock, nil)
	return routes.New(routes.RouterConfig{
		APIKeyHandler:  h,
		InternalSecret: testInternalSecret,
	})
}

func TestAutoProvision_FirstCall_CreatesTestKey(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	now := time.Now()

	// Expect count query → 0 (no existing keys)
	mock.ExpectQuery(`SELECT count\(\*\) FROM api_keys WHERE account_id = \$1 AND revoked_at IS NULL`).
		WithArgs(testAutoProvisionAccountID).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(0))

	// Expect INSERT for live key (11 args via shared insertKey)
	defaultPermsJSON := []byte(`{"services":{"calc":{"enabled":true,"resources":["*"],"actions":["execute","describe"]},"kb":{"enabled":true,"resources":["*"],"actions":["search","ask"]},"flow":{"enabled":true,"resources":["*"],"actions":["trigger"]}}}`)
	mock.ExpectQuery(`INSERT INTO api_keys`).
		WithArgs(
			pgxmock.AnyArg(), pgxmock.AnyArg(), testAutoProvisionAccountID, "live", "Default",
			pgxmock.AnyArg(), []string{}, []string{}, pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
		).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "key_prefix", "account_id", "name", "environment", "permissions",
			"allowed_ips", "allowed_origins", "rate_limit_rps", "monthly_quota",
			"expires_at", "last_used_at", "created_at",
		}).AddRow(
			"id-test-1", "bl_testXXX", testAutoProvisionAccountID, "Default", "live", defaultPermsJSON,
			[]string{}, []string{}, nil, nil, nil, nil, now,
		))

	router := setupAutoProvisionRouter(t, mock)

	body := `{"account_id":"` + testAutoProvisionAccountID + `"}`
	req := httptest.NewRequest(http.MethodPost, "/internal/api-keys/auto-provision", strings.NewReader(body))
	req.Header.Set("X-Internal-Secret", testInternalSecret)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatal("failed to decode response:", err)
	}

	if resp["provisioned"] != true {
		t.Errorf("expected provisioned=true, got %v", resp["provisioned"])
	}

	key, ok := resp["key"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected key object in response, got %v", resp["key"])
	}

	if key["environment"] != "live" {
		t.Errorf("expected key environment=live, got %v", key["environment"])
	}
	if key["name"] != "Default" {
		t.Errorf("expected key name=Default, got %v", key["name"])
	}

	// Verify permissions include calc, kb, flow services
	perms, ok := key["permissions"].(map[string]interface{})
	if !ok {
		t.Fatal("expected permissions object in key")
	}
	services, ok := perms["services"].(map[string]interface{})
	if !ok {
		t.Fatal("expected services in permissions")
	}
	for _, svc := range []string{"calc", "kb", "flow"} {
		if services[svc] == nil {
			t.Errorf("expected %s service in permissions", svc)
		}
	}

	// raw_key must be present (only surfaced at creation time)
	if key["raw_key"] == "" || key["raw_key"] == nil {
		t.Error("expected raw_key in response for test key")
	}

	// keys array must NOT be present
	if resp["keys"] != nil {
		t.Errorf("expected no keys array in response, got %v", resp["keys"])
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled mock expectations: %s", err)
	}
}

func TestAutoProvision_SecondCall_NoOp(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	// Expect count query → 1 (account already has a key)
	mock.ExpectQuery(`SELECT count\(\*\) FROM api_keys WHERE account_id = \$1 AND revoked_at IS NULL`).
		WithArgs(testAutoProvisionAccountID).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(1))

	// No transaction, no inserts expected

	router := setupAutoProvisionRouter(t, mock)

	body := `{"account_id":"` + testAutoProvisionAccountID + `"}`
	req := httptest.NewRequest(http.MethodPost, "/internal/api-keys/auto-provision", strings.NewReader(body))
	req.Header.Set("X-Internal-Secret", testInternalSecret)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatal("failed to decode response:", err)
	}

	if resp["provisioned"] != false {
		t.Errorf("expected provisioned=false, got %v", resp["provisioned"])
	}
	if resp["message"] != "account already has keys" {
		t.Errorf("expected no-op message, got %v", resp["message"])
	}
	if resp["key"] != nil {
		t.Errorf("expected no key in response, got %v", resp["key"])
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled mock expectations: %s", err)
	}
}

func TestAutoProvision_RequiresInternalSecret(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	router := setupAutoProvisionRouter(t, mock)

	body := `{"account_id":"` + testAutoProvisionAccountID + `"}`
	req := httptest.NewRequest(http.MethodPost, "/internal/api-keys/auto-provision", strings.NewReader(body))
	// No X-Internal-Secret header
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestAutoProvision_MissingAccountID(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	router := setupAutoProvisionRouter(t, mock)

	body := `{}`
	req := httptest.NewRequest(http.MethodPost, "/internal/api-keys/auto-provision", strings.NewReader(body))
	req.Header.Set("X-Internal-Secret", testInternalSecret)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestCheckLiveKey_HasLiveKey(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	mock.ExpectQuery(`SELECT environment FROM api_keys`).
		WithArgs(testAutoProvisionAccountID).
		WillReturnRows(pgxmock.NewRows([]string{"environment"}).
			AddRow("test").
			AddRow("live"))

	router := setupAutoProvisionRouter(t, mock)

	req := httptest.NewRequest(http.MethodGet, "/internal/api-keys/check-live?account_id="+testAutoProvisionAccountID, nil)
	req.Header.Set("X-Internal-Secret", testInternalSecret)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatal("failed to decode response:", err)
	}

	if resp["has_live_key"] != true {
		t.Errorf("expected has_live_key=true, got %v", resp["has_live_key"])
	}
	if resp["key_count"] != float64(2) {
		t.Errorf("expected key_count=2, got %v", resp["key_count"])
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled mock expectations: %s", err)
	}
}

func TestCheckLiveKey_NoLiveKey(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	mock.ExpectQuery(`SELECT environment FROM api_keys`).
		WithArgs(testAutoProvisionAccountID).
		WillReturnRows(pgxmock.NewRows([]string{"environment"}).
			AddRow("test"))

	router := setupAutoProvisionRouter(t, mock)

	req := httptest.NewRequest(http.MethodGet, "/internal/api-keys/check-live?account_id="+testAutoProvisionAccountID, nil)
	req.Header.Set("X-Internal-Secret", testInternalSecret)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatal("failed to decode response:", err)
	}

	if resp["has_live_key"] != false {
		t.Errorf("expected has_live_key=false, got %v", resp["has_live_key"])
	}
	if resp["key_count"] != float64(1) {
		t.Errorf("expected key_count=1, got %v", resp["key_count"])
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled mock expectations: %s", err)
	}
}

func TestCheckLiveKey_MissingAccountID(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close()

	router := setupAutoProvisionRouter(t, mock)

	req := httptest.NewRequest(http.MethodGet, "/internal/api-keys/check-live", nil)
	req.Header.Set("X-Internal-Secret", testInternalSecret)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}
