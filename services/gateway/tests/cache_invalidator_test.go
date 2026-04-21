package tests

import (
	"context"
	"testing"
	"time"

	"github.com/coignite-aps/bl-gateway/internal/service"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
)

// --- InvalidateAISpendCache ---

func TestInvalidateAISpendCache_DeletesCurrentPeriodKey(t *testing.T) {
	mr, rdb := miniRedis(t)
	keyID := "test-key-ai"

	// Pre-seed cache key
	cacheKey := "gw:apikey:" + keyID + ":ai_spend_month:" + ym()
	mr.Set(cacheKey, "42.5")

	if err := service.InvalidateAISpendCache(context.Background(), rdb, keyID); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Key should be gone
	if val, _ := mr.Get(cacheKey); val != "" {
		t.Errorf("expected cache key deleted, got %q", val)
	}
}

func TestInvalidateAISpendCache_NilRedis_NoError(t *testing.T) {
	// Must not panic or error when Redis is nil
	if err := service.InvalidateAISpendCache(context.Background(), nil, "some-key"); err != nil {
		t.Errorf("expected nil error with nil redis, got %v", err)
	}
}

func TestInvalidateAISpendCache_MissingKey_NoError(t *testing.T) {
	_, rdb := miniRedis(t)
	// DEL on non-existent key is not an error
	if err := service.InvalidateAISpendCache(context.Background(), rdb, "no-such-key"); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

// --- InvalidateKBSearchCache ---

func TestInvalidateKBSearchCache_DeletesCurrentPeriodKey(t *testing.T) {
	mr, rdb := miniRedis(t)
	keyID := "test-key-kb"

	cacheKey := "gw:apikey:" + keyID + ":kb_search_month:" + ym()
	mr.Set(cacheKey, "17")

	if err := service.InvalidateKBSearchCache(context.Background(), rdb, keyID); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if val, _ := mr.Get(cacheKey); val != "" {
		t.Errorf("expected cache key deleted, got %q", val)
	}
}

func TestInvalidateKBSearchCache_NilRedis_NoError(t *testing.T) {
	if err := service.InvalidateKBSearchCache(context.Background(), nil, "some-key"); err != nil {
		t.Errorf("expected nil error with nil redis, got %v", err)
	}
}

// --- StartCacheInvalidationSubscriber ---

func TestCacheInvalidationSubscriber_AISpendChannel(t *testing.T) {
	mr, rdb := miniRedis(t)
	keyID := "sub-key-ai"

	// Pre-seed AI spend cache
	cacheKey := "gw:apikey:" + keyID + ":ai_spend_month:" + ym()
	mr.Set(cacheKey, "99.0")

	ctx, cancel := context.WithCancel(context.Background())

	// Subscriber Redis client (separate connection — pub/sub blocks)
	subRdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { subRdb.Close() })

	logger := zerolog.Nop()
	go service.StartCacheInvalidationSubscriber(ctx, subRdb, logger)

	// Give subscriber goroutine time to subscribe
	time.Sleep(50 * time.Millisecond)

	// Publish via the main rdb client
	if err := rdb.Publish(ctx, "bl:gw_apikey_ai_spend:invalidated", keyID).Err(); err != nil {
		t.Fatalf("publish failed: %v", err)
	}

	// Wait for subscriber to process the message
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		val, _ := mr.Get(cacheKey)
		if val == "" {
			cancel()
			return // success — key was deleted
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	t.Error("AI spend cache key not deleted within 500ms after PUBLISH")
}

func TestCacheInvalidationSubscriber_KBSearchChannel(t *testing.T) {
	mr, rdb := miniRedis(t)
	keyID := "sub-key-kb"

	cacheKey := "gw:apikey:" + keyID + ":kb_search_month:" + ym()
	mr.Set(cacheKey, "5")

	ctx, cancel := context.WithCancel(context.Background())

	subRdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { subRdb.Close() })

	logger := zerolog.Nop()
	go service.StartCacheInvalidationSubscriber(ctx, subRdb, logger)

	time.Sleep(50 * time.Millisecond)

	if err := rdb.Publish(ctx, "bl:gw_apikey_kb_search:invalidated", keyID).Err(); err != nil {
		t.Fatalf("publish failed: %v", err)
	}

	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		val, _ := mr.Get(cacheKey)
		if val == "" {
			cancel()
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	t.Error("KB search cache key not deleted within 500ms after PUBLISH")
}

func TestCacheInvalidationSubscriber_ContextCancel_Exits(t *testing.T) {
	mr, _ := miniRedis(t)

	ctx, cancel := context.WithCancel(context.Background())
	subRdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { subRdb.Close() })

	done := make(chan struct{})
	logger := zerolog.Nop()
	go func() {
		service.StartCacheInvalidationSubscriber(ctx, subRdb, logger)
		close(done)
	}()

	// Cancel and verify subscriber exits
	cancel()
	select {
	case <-done:
		// good
	case <-time.After(2 * time.Second):
		t.Error("subscriber goroutine did not exit after context cancel")
	}
}
