package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/coignite-aps/bl-gateway/internal/middleware"
	"github.com/redis/go-redis/v9"
)

func TestRouteFeatureMapping(t *testing.T) {
	cases := []struct {
		path    string
		wantKey string
	}{
		{"/v1/ai/chat/send", "ai.chat"},
		{"/v1/ai/kb/search", "ai.kb"},
		{"/v1/ai/embed/", "ai.embeddings"},
		{"/v1/formula/execute", "formula.execute"},
		{"/v1/calculator/execute/123", "calculator.execute"},
		{"/v1/calculator/describe/123", "calculator.execute"},
		{"/v1/mcp/formula/tools/list", "formula.mcp"},
		{"/v1/mcp/calculator/some-id", "calculator.mcp"},
		{"/v1/flow/run", "flow.execute"},
		{"/v1/widget/render", "widget.render"},
	}

	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			key, _ := middleware.CheckFeatureFlag(context.Background(), nil, "acc1", tc.path)
			if key != tc.wantKey {
				t.Errorf("path %s: expected feature key %q, got %q", tc.path, tc.wantKey, key)
			}
		})
	}
}

func TestRouteFeatureMapping_NoMatch(t *testing.T) {
	key, allowed := middleware.CheckFeatureFlag(context.Background(), nil, "acc1", "/v1/unknown/path")
	if key != "" {
		t.Errorf("expected empty key for unmatched path, got %q", key)
	}
	if !allowed {
		t.Error("expected passthrough (allowed=true) for unmatched path")
	}
}

func TestFeatureCheck_NoRedis(t *testing.T) {
	key, allowed := middleware.CheckFeatureFlag(context.Background(), nil, "acc1", "/v1/ai/chat/send")
	if key != "ai.chat" {
		t.Errorf("expected ai.chat, got %q", key)
	}
	if allowed {
		t.Error("expected denied when Redis is nil (fail-closed)")
	}
}

func TestFeatureCheck_Passthrough(t *testing.T) {
	key, allowed := middleware.CheckFeatureFlag(context.Background(), nil, "acc1", "/health")
	if key != "" {
		t.Errorf("expected empty key for /health, got %q", key)
	}
	if !allowed {
		t.Error("expected allowed=true for unmapped path")
	}
}

func newTestRedis(t *testing.T) (*miniredis.Miniredis, *redis.Client) {
	t.Helper()
	s := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: s.Addr()})
	return s, rdb
}

func TestFeatureCheck_AccountOverrideWins(t *testing.T) {
	s, rdb := newTestRedis(t)
	s.Set("cms:features:acc123:ai.chat", "1")
	s.Set("cms:features:ai.chat", "0")

	key, allowed := middleware.CheckFeatureFlag(context.Background(), rdb, "acc123", "/v1/ai/chat/completions")
	if key != "ai.chat" || !allowed {
		t.Errorf("expected ai.chat allowed=true, got key=%s allowed=%v", key, allowed)
	}
}

func TestFeatureCheck_AccountOverrideDenies(t *testing.T) {
	s, rdb := newTestRedis(t)
	s.Set("cms:features:acc123:ai.chat", "0")
	s.Set("cms:features:ai.chat", "1")

	key, allowed := middleware.CheckFeatureFlag(context.Background(), rdb, "acc123", "/v1/ai/chat/completions")
	if key != "ai.chat" || allowed {
		t.Errorf("expected ai.chat allowed=false, got key=%s allowed=%v", key, allowed)
	}
}

func TestFeatureCheck_PlatformDefault(t *testing.T) {
	s, rdb := newTestRedis(t)
	s.Set("cms:features:ai.chat", "1")

	key, allowed := middleware.CheckFeatureFlag(context.Background(), rdb, "acc123", "/v1/ai/chat/completions")
	if key != "ai.chat" || !allowed {
		t.Errorf("expected ai.chat allowed=true, got key=%s allowed=%v", key, allowed)
	}
}

func TestFeatureCheck_PlatformDenied(t *testing.T) {
	s, rdb := newTestRedis(t)
	s.Set("cms:features:ai.chat", "0")

	key, allowed := middleware.CheckFeatureFlag(context.Background(), rdb, "acc123", "/v1/ai/chat/completions")
	if key != "ai.chat" || allowed {
		t.Errorf("expected ai.chat allowed=false, got key=%s allowed=%v", key, allowed)
	}
}

func TestFeatureCheck_NotRegistered(t *testing.T) {
	_, rdb := newTestRedis(t)
	// no keys set

	key, allowed := middleware.CheckFeatureFlag(context.Background(), rdb, "acc123", "/v1/ai/chat/completions")
	if key != "ai.chat" || allowed {
		t.Errorf("expected ai.chat allowed=false (fail-closed), got key=%s allowed=%v", key, allowed)
	}
}

func TestWriteFeatureDenied(t *testing.T) {
	rec := httptest.NewRecorder()
	middleware.WriteFeatureDenied(rec, "ai.chat")

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("expected application/json, got %q", ct)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"feature_disabled"`) {
		t.Errorf("expected feature_disabled in body, got %q", body)
	}
	if !strings.Contains(body, `"ai.chat"`) {
		t.Errorf("expected ai.chat in body, got %q", body)
	}
}
