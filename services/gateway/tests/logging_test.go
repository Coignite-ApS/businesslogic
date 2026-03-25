package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/coignite-aps/bl-gateway/internal/middleware"
	"github.com/coignite-aps/bl-gateway/internal/service"
)

// mockDB captures INSERT calls for testing RequestLogMiddleware.
type mockDB struct {
	mu      sync.Mutex
	inserts []requestLogRow
}

type requestLogRow struct {
	accountID  string
	apiKeyID   string
	method     string
	path       string
	statusCode int
	latencyMS  int
	reqSize    int
	respSize   int
}

func (m *mockDB) InsertRequestLog(ctx context.Context, row requestLogRow) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.inserts = append(m.inserts, row)
}

// --- RequestLogMiddleware tests ---

func TestRequestLogMiddleware_InsertsOnAuthenticatedRequest(t *testing.T) {
	var insertCalled bool
	var insertedAccountID, insertedMethod, insertedPath string
	var insertedStatus int

	logFn := func(accountID, apiKeyID, method, path string, status, latencyMS, reqSize, respSize int) {
		insertCalled = true
		insertedAccountID = accountID
		insertedMethod = method
		insertedPath = path
		insertedStatus = status
	}

	handler := middleware.RequestLog(logFn)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	}))

	// Set up authenticated context
	acct := &service.AccountData{AccountID: "acct-123", KeyID: "key-456"}
	req := httptest.NewRequest(http.MethodGet, "/v1/calc/health", nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.AccountContextKey, acct))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	// Give goroutine a moment to fire
	time.Sleep(10 * time.Millisecond)

	if !insertCalled {
		t.Error("expected INSERT to be called for authenticated request")
	}
	if insertedAccountID != "acct-123" {
		t.Errorf("expected account_id acct-123, got %s", insertedAccountID)
	}
	if insertedMethod != http.MethodGet {
		t.Errorf("expected method GET, got %s", insertedMethod)
	}
	if insertedPath != "/v1/calc/health" {
		t.Errorf("expected path /v1/calc/health, got %s", insertedPath)
	}
	if insertedStatus != http.StatusOK {
		t.Errorf("expected status 200, got %d", insertedStatus)
	}
}

func TestRequestLogMiddleware_SkipsUnauthenticatedRoutes(t *testing.T) {
	var insertCalled bool

	logFn := func(accountID, apiKeyID, method, path string, status, latencyMS, reqSize, respSize int) {
		insertCalled = true
	}

	handler := middleware.RequestLog(logFn)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	unauthPaths := []string{"/health", "/metrics", "/public/something"}
	for _, p := range unauthPaths {
		insertCalled = false
		req := httptest.NewRequest(http.MethodGet, p, nil)
		// No account context — unauthenticated
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		time.Sleep(10 * time.Millisecond)

		if insertCalled {
			t.Errorf("expected no INSERT for unauthenticated path %s", p)
		}
	}
}

func TestRequestLogMiddleware_SkipsWhenNoAccountContext(t *testing.T) {
	var insertCalled bool

	logFn := func(accountID, apiKeyID, method, path string, status, latencyMS, reqSize, respSize int) {
		insertCalled = true
	}

	handler := middleware.RequestLog(logFn)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Authenticated path but no account context (e.g., auth middleware rejected early)
	req := httptest.NewRequest(http.MethodGet, "/v1/calc/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	time.Sleep(10 * time.Millisecond)

	if insertCalled {
		t.Error("expected no INSERT when no account context")
	}
}

func TestRequestLogMiddleware_DBFailureDoesNotBlockResponse(t *testing.T) {
	// logFn that panics — response must still complete
	logFn := func(accountID, apiKeyID, method, path string, status, latencyMS, reqSize, respSize int) {
		panic("DB failure simulation")
	}

	handler := middleware.RequestLog(logFn)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	}))

	acct := &service.AccountData{AccountID: "acct-123", KeyID: "key-456"}
	req := httptest.NewRequest(http.MethodGet, "/v1/calc/health", nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.AccountContextKey, acct))
	rec := httptest.NewRecorder()

	// Must not panic in the handler goroutine
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("panic propagated to handler: %v", r)
		}
	}()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 response despite logFn error, got %d", rec.Code)
	}

	// Wait briefly so goroutine runs (it panics internally, which is recovered)
	time.Sleep(20 * time.Millisecond)
}

func TestRequestLogMiddleware_CapturesStatusAndSize(t *testing.T) {
	var capturedStatus, capturedRespSize int

	logFn := func(accountID, apiKeyID, method, path string, status, latencyMS, reqSize, respSize int) {
		capturedStatus = status
		capturedRespSize = respSize
	}

	handler := middleware.RequestLog(logFn)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"created":true}`))
	}))

	acct := &service.AccountData{AccountID: "acct-123", KeyID: "key-456"}
	req := httptest.NewRequest(http.MethodPost, "/v1/calc/execute", nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.AccountContextKey, acct))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)
	time.Sleep(10 * time.Millisecond)

	if capturedStatus != http.StatusCreated {
		t.Errorf("expected status 201, got %d", capturedStatus)
	}
	if capturedRespSize != len(`{"created":true}`) {
		t.Errorf("expected resp size %d, got %d", len(`{"created":true}`), capturedRespSize)
	}
}

// --- InternalAuditMiddleware tests ---

func TestInternalAuditMiddleware_LogsStructuredFields(t *testing.T) {
	var loggedFields map[string]interface{}
	var logMu sync.Mutex

	auditFn := func(fields map[string]interface{}) {
		logMu.Lock()
		defer logMu.Unlock()
		loggedFields = fields
	}

	handler := middleware.InternalAudit(auditFn)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/internal/calc/execute", nil)
	req.Header.Set("X-User-Id", "user-789")
	req.Header.Set("X-Account-Id", "acct-123")
	req.RemoteAddr = "10.0.0.1:12345"
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	logMu.Lock()
	defer logMu.Unlock()

	requiredFields := []string{"timestamp", "ip", "user_id", "account_id", "method", "path", "status", "latency_ms"}
	for _, f := range requiredFields {
		if _, ok := loggedFields[f]; !ok {
			t.Errorf("missing field %q in audit log", f)
		}
	}
	if loggedFields["user_id"] != "user-789" {
		t.Errorf("expected user_id user-789, got %v", loggedFields["user_id"])
	}
	if loggedFields["account_id"] != "acct-123" {
		t.Errorf("expected account_id acct-123, got %v", loggedFields["account_id"])
	}
	if loggedFields["method"] != http.MethodPost {
		t.Errorf("expected method POST, got %v", loggedFields["method"])
	}
	if loggedFields["path"] != "/internal/calc/execute" {
		t.Errorf("expected path /internal/calc/execute, got %v", loggedFields["path"])
	}
}
