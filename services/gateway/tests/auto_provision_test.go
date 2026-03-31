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

func TestAutoProvision_FirstCall_CreatesBothKeys(t *testing.T) {
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

	// Expect transaction begin
	mock.ExpectBegin()

	// Expect INSERT for test key (5 args: keyHash, keyPrefix, accountID, env, name)
	mock.ExpectQuery(`INSERT INTO api_keys`).
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), testAutoProvisionAccountID, "test", "Test").
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "key_prefix", "account_id", "name", "environment", "permissions",
			"allowed_ips", "allowed_origins", "rate_limit_rps", "monthly_quota",
			"expires_at", "last_used_at", "created_at",
		}).AddRow(
			"id-test-1", "bl_testXXX", testAutoProvisionAccountID, "Test", "test", nil,
			[]string{}, []string{}, nil, nil, nil, nil, now,
		))

	// Expect INSERT for live key
	mock.ExpectQuery(`INSERT INTO api_keys`).
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), testAutoProvisionAccountID, "live", "Live").
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "key_prefix", "account_id", "name", "environment", "permissions",
			"allowed_ips", "allowed_origins", "rate_limit_rps", "monthly_quota",
			"expires_at", "last_used_at", "created_at",
		}).AddRow(
			"id-live-1", "bl_liveXXX", testAutoProvisionAccountID, "Live", "live", nil,
			[]string{}, []string{}, nil, nil, nil, nil, now,
		))

	// Expect commit
	mock.ExpectCommit()

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

	keys, ok := resp["keys"].([]interface{})
	if !ok || len(keys) != 2 {
		t.Errorf("expected 2 keys, got %v", resp["keys"])
	}

	// Verify key environments
	key0 := keys[0].(map[string]interface{})
	key1 := keys[1].(map[string]interface{})
	if key0["environment"] != "test" {
		t.Errorf("expected first key environment=test, got %v", key0["environment"])
	}
	if key1["environment"] != "live" {
		t.Errorf("expected second key environment=live, got %v", key1["environment"])
	}

	// raw_key must be present (only surfaced at creation time)
	if key0["raw_key"] == "" || key0["raw_key"] == nil {
		t.Error("expected raw_key in response for test key")
	}
	if key1["raw_key"] == "" || key1["raw_key"] == nil {
		t.Error("expected raw_key in response for live key")
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

	// Expect count query → 2 (account already has keys)
	mock.ExpectQuery(`SELECT count\(\*\) FROM api_keys WHERE account_id = \$1 AND revoked_at IS NULL`).
		WithArgs(testAutoProvisionAccountID).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(2))

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
	if resp["keys"] != nil {
		t.Errorf("expected no keys in response, got %v", resp["keys"])
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
