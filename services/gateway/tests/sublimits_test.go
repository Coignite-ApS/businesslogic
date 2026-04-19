package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/coignite-aps/bl-gateway/internal/middleware"
	"github.com/coignite-aps/bl-gateway/internal/service"
	"github.com/redis/go-redis/v9"
)

// helpers

func floatPtr(v float64) *float64 { return &v }

func ym() string { return time.Now().Format("200601") }

func accountWithCaps(opts ...func(*service.AccountData)) *service.AccountData {
	a := &service.AccountData{
		AccountID: "acct-sublimit-test",
		KeyID:     "key-sublimit-test",
	}
	for _, o := range opts {
		o(a)
	}
	return a
}

func withModuleAllowlist(modules ...string) func(*service.AccountData) {
	return func(a *service.AccountData) {
		a.ModuleAllowlistSet = true
		a.ModuleAllowlist = modules
	}
}

func withAICap(cap float64) func(*service.AccountData) {
	return func(a *service.AccountData) { a.AISpendCapMonthlyEUR = floatPtr(cap) }
}

func withKBCap(cap int) func(*service.AccountData) {
	return func(a *service.AccountData) { a.KBSearchCapMonthly = intPtr(cap) }
}

func reqWithAcct(method, path string, acct *service.AccountData) *http.Request {
	req := httptest.NewRequest(method, path, nil)
	ctx := context.WithValue(req.Context(), middleware.AccountContextKey, acct)
	return req.WithContext(ctx)
}

func okH() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func miniRedis(t *testing.T) (*miniredis.Miniredis, *redis.Client) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return mr, rdb
}

// --- Module allowlist ---

func TestSublimits_NoCaps_PassesThrough(t *testing.T) {
	acct := accountWithCaps()
	h := middleware.Sublimits(nil)(okH())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithAcct(http.MethodGet, "/v1/ai/chat", acct))
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestSublimits_ModuleAllowlist_AIBlocked(t *testing.T) {
	acct := accountWithCaps(withModuleAllowlist("calculators"))
	h := middleware.Sublimits(nil)(okH())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithAcct(http.MethodPost, "/v1/ai/chat", acct))
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
	if got := rec.Header().Get("X-RateLimit-Breached"); got != "module_allowlist" {
		t.Errorf("expected X-RateLimit-Breached=module_allowlist, got %q", got)
	}
}

func TestSublimits_ModuleAllowlist_CalculatorAllowed(t *testing.T) {
	acct := accountWithCaps(withModuleAllowlist("calculators"))
	h := middleware.Sublimits(nil)(okH())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithAcct(http.MethodPost, "/v1/calculator/execute/123", acct))
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestSublimits_ModuleAllowlist_NullAllowsAll(t *testing.T) {
	acct := accountWithCaps() // no allowlist set
	h := middleware.Sublimits(nil)(okH())
	for _, path := range []string{"/v1/ai/chat", "/v1/kb/search", "/v1/calculator/execute/x", "/v1/flows/webhook/x"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, reqWithAcct(http.MethodGet, path, acct))
		if rec.Code != http.StatusOK {
			t.Errorf("path %s: expected 200 with null allowlist, got %d", path, rec.Code)
		}
	}
}

func TestSublimits_ModuleAllowlist_EmptyBlocksAll(t *testing.T) {
	acct := accountWithCaps(withModuleAllowlist()) // empty → all classified modules blocked
	h := middleware.Sublimits(nil)(okH())
	for _, path := range []string{"/v1/ai/chat", "/v1/kb/search", "/v1/calculator/execute/x", "/v1/flows/webhook/x"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, reqWithAcct(http.MethodGet, path, acct))
		if rec.Code != http.StatusForbidden {
			t.Errorf("path %s: expected 403 with empty allowlist, got %d", path, rec.Code)
		}
	}
}

// --- InferModule ---

func TestInferModule(t *testing.T) {
	cases := []struct {
		path   string
		expect string
	}{
		{"/v1/ai/chat", "ai"},
		{"/v1/mcp/ai/session", "ai"},
		{"/v1/kb/search", "kb"},
		{"/v1/knowledge/base", "kb"},
		{"/v1/calculator/execute/123", "calculators"},
		{"/v1/mcp/calculator/run", "calculators"},
		{"/v1/mcp/formula/eval", "calculators"},
		{"/v1/formula/eval", "calculators"},
		{"/v1/widget/123/execute", "calculators"},
		{"/v1/flows/webhook/abc", "flows"},
		{"/v1/flow/run", "flows"},
		{"/health", ""},
		{"/internal/api-keys/", ""},
	}
	for _, tc := range cases {
		got := service.InferModule(tc.path)
		if got != tc.expect {
			t.Errorf("InferModule(%q) = %q, want %q", tc.path, got, tc.expect)
		}
	}
}

// --- AI spend cap ---

func TestSublimits_AISpendCap_Exceeded(t *testing.T) {
	mr, rdb := miniRedis(t)
	checker := service.NewSublimitChecker(nil, rdb)
	acct := accountWithCaps(withAICap(10.0))

	mr.Set("gw:apikey:key-sublimit-test:ai_spend_month:"+ym(), "10.0")

	h := middleware.Sublimits(checker)(okH())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithAcct(http.MethodPost, "/v1/ai/chat", acct))

	if rec.Code != http.StatusPaymentRequired {
		t.Errorf("expected 402, got %d", rec.Code)
	}
	if got := rec.Header().Get("X-RateLimit-Breached"); got != "ai_spend_cap" {
		t.Errorf("expected X-RateLimit-Breached=ai_spend_cap, got %q", got)
	}
}

func TestSublimits_AISpendCap_UnderCap_Allowed(t *testing.T) {
	mr, rdb := miniRedis(t)
	checker := service.NewSublimitChecker(nil, rdb)
	acct := accountWithCaps(withAICap(10.0))

	mr.Set("gw:apikey:key-sublimit-test:ai_spend_month:"+ym(), "5.0")

	h := middleware.Sublimits(checker)(okH())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithAcct(http.MethodPost, "/v1/ai/chat", acct))

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestSublimits_AISpendCap_NilCap_Allowed(t *testing.T) {
	acct := accountWithCaps() // no AI cap
	h := middleware.Sublimits(nil)(okH())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithAcct(http.MethodPost, "/v1/ai/chat", acct))
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestSublimits_AISpendCap_RedisDown_FailOpen(t *testing.T) {
	checker := service.NewSublimitChecker(nil, nil) // no Redis, no DB
	acct := accountWithCaps(withAICap(0.01))        // tiny cap, but fail-open

	h := middleware.Sublimits(checker)(okH())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithAcct(http.MethodPost, "/v1/ai/chat", acct))

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (fail-open), got %d", rec.Code)
	}
}

// --- KB search cap ---

func TestSublimits_KBSearchCap_Exceeded(t *testing.T) {
	mr, rdb := miniRedis(t)
	checker := service.NewSublimitChecker(nil, rdb)
	acct := accountWithCaps(withKBCap(100))

	mr.Set("gw:apikey:key-sublimit-test:kb_search_month:"+ym(), "100")

	h := middleware.Sublimits(checker)(okH())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithAcct(http.MethodGet, "/v1/kb/search", acct))

	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", rec.Code)
	}
	if got := rec.Header().Get("X-RateLimit-Breached"); got != "kb_search_cap" {
		t.Errorf("expected X-RateLimit-Breached=kb_search_cap, got %q", got)
	}
}

func TestSublimits_KBSearchCap_UnderCap_Allowed(t *testing.T) {
	mr, rdb := miniRedis(t)
	checker := service.NewSublimitChecker(nil, rdb)
	acct := accountWithCaps(withKBCap(100))

	mr.Set("gw:apikey:key-sublimit-test:kb_search_month:"+ym(), "50")

	h := middleware.Sublimits(checker)(okH())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithAcct(http.MethodGet, "/v1/kb/search", acct))

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestSublimits_KBSearchCap_NilCap_Allowed(t *testing.T) {
	acct := accountWithCaps()
	h := middleware.Sublimits(nil)(okH())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithAcct(http.MethodGet, "/v1/kb/search", acct))
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestSublimits_KBSearchCap_RedisDown_FailOpen(t *testing.T) {
	checker := service.NewSublimitChecker(nil, nil)
	acct := accountWithCaps(withKBCap(0)) // cap=0, but fail-open

	h := middleware.Sublimits(checker)(okH())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithAcct(http.MethodGet, "/v1/kb/search", acct))

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 (fail-open), got %d", rec.Code)
	}
}

// --- Cache hit path (no DB call) ---

func TestSublimits_CacheHit_NoDBNeeded(t *testing.T) {
	mr, rdb := miniRedis(t)
	checker := service.NewSublimitChecker(nil, rdb) // db=nil: any DB call fails

	acct := accountWithCaps(withAICap(100.0), withKBCap(1000))

	mr.Set("gw:apikey:key-sublimit-test:ai_spend_month:"+ym(), "1.0")
	mr.Set("gw:apikey:key-sublimit-test:kb_search_month:"+ym(), "5")

	h := middleware.Sublimits(checker)(okH())

	for _, tc := range []struct{ path string }{{"/v1/ai/chat"}, {"/v1/kb/search"}} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, reqWithAcct(http.MethodPost, tc.path, acct))
		if rec.Code != http.StatusOK {
			t.Errorf("%s: expected 200 from cache, got %d", tc.path, rec.Code)
		}
	}
}

// --- No account in context ---

func TestSublimits_NoAccountContext_PassesThrough(t *testing.T) {
	checker := service.NewSublimitChecker(nil, nil)
	h := middleware.Sublimits(checker)(okH())

	req := httptest.NewRequest(http.MethodGet, "/v1/ai/chat", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 without account context, got %d", rec.Code)
	}
}

// --- X-RateLimit-Breached header on each 4xx ---

func TestSublimits_BreachHeaders(t *testing.T) {
	mr, rdb := miniRedis(t)
	checker := service.NewSublimitChecker(nil, rdb)

	tests := []struct {
		name           string
		acct           *service.AccountData
		path           string
		setup          func()
		expectCode     int
		expectBreached string
	}{
		{
			name:           "module_allowlist",
			acct:           accountWithCaps(withModuleAllowlist("calculators")),
			path:           "/v1/ai/chat",
			setup:          func() {},
			expectCode:     http.StatusForbidden,
			expectBreached: "module_allowlist",
		},
		{
			name: "ai_spend_cap",
			acct: accountWithCaps(withAICap(5.0)),
			path: "/v1/ai/chat",
			setup: func() {
				mr.Set("gw:apikey:key-sublimit-test:ai_spend_month:"+ym(), "5.0")
			},
			expectCode:     http.StatusPaymentRequired,
			expectBreached: "ai_spend_cap",
		},
		{
			name: "kb_search_cap",
			acct: accountWithCaps(withKBCap(10)),
			path: "/v1/kb/search",
			setup: func() {
				mr.Set("gw:apikey:key-sublimit-test:kb_search_month:"+ym(), "10")
			},
			expectCode:     http.StatusTooManyRequests,
			expectBreached: "kb_search_cap",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tc.setup()
			h := middleware.Sublimits(checker)(okH())
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, reqWithAcct(http.MethodPost, tc.path, tc.acct))

			if rec.Code != tc.expectCode {
				t.Errorf("expected %d, got %d", tc.expectCode, rec.Code)
			}
			if got := rec.Header().Get("X-RateLimit-Breached"); got != tc.expectBreached {
				t.Errorf("expected X-RateLimit-Breached=%q, got %q", tc.expectBreached, got)
			}
		})
	}
}
