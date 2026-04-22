package service

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
)

const (
	channelAISpend  = "bl:gw_apikey_ai_spend:invalidated"
	channelKBSearch = "bl:gw_apikey_kb_search:invalidated"
)

// InvalidateAISpendCache deletes the current-period AI spend cache key for keyID.
// No-op when rdb is nil (fail-open).
func InvalidateAISpendCache(ctx context.Context, rdb *redis.Client, keyID string) error {
	if rdb == nil {
		return nil
	}
	return rdb.Del(ctx, aiSpendCacheKey(keyID)).Err()
}

// InvalidateKBSearchCache deletes the current-period KB search cache key for keyID.
// No-op when rdb is nil (fail-open).
func InvalidateKBSearchCache(ctx context.Context, rdb *redis.Client, keyID string) error {
	if rdb == nil {
		return nil
	}
	return rdb.Del(ctx, kbSearchCacheKey(keyID)).Err()
}

// StartCacheInvalidationSubscriber subscribes to the gateway invalidation channels
// and deletes the matching per-key cache entries. Runs until ctx is cancelled.
//
// Reconnect behaviour: go-redis/v9 PubSub automatically reconnects on network
// errors — matching formula-api's unbounded-retry pattern (task 22 polish).
func StartCacheInvalidationSubscriber(ctx context.Context, rdb *redis.Client, logger zerolog.Logger) {
	ps := rdb.Subscribe(ctx, channelAISpend, channelKBSearch)
	defer ps.Close() //nolint:errcheck

	logger.Info().Msg("[cache-inv] subscribed to ai_spend + kb_search invalidation channels")

	ch := ps.Channel()
	for {
		select {
		case <-ctx.Done():
			logger.Info().Msg("[cache-inv] context cancelled — exiting subscriber")
			return
		case msg, ok := <-ch:
			if !ok {
				// Channel closed (Redis disconnect); go-redis reopens the subscription
				// automatically. Sleep briefly to avoid tight loop on repeated failures.
				logger.Warn().Msg("[cache-inv] pub/sub channel closed — waiting for reconnect")
				select {
				case <-ctx.Done():
					return
				case <-time.After(5 * time.Second):
				}
				continue
			}

			keyID := msg.Payload
			if keyID == "" {
				continue
			}

			switch msg.Channel {
			case channelAISpend:
				if err := InvalidateAISpendCache(ctx, rdb, keyID); err != nil {
					logger.Warn().Err(err).Str("key_id", keyID).Msg("[cache-inv] DEL ai_spend key failed")
				} else {
					logger.Debug().Str("key_id", keyID).Msg("[cache-inv] invalidated ai_spend cache")
				}
			case channelKBSearch:
				if err := InvalidateKBSearchCache(ctx, rdb, keyID); err != nil {
					logger.Warn().Err(err).Str("key_id", keyID).Msg("[cache-inv] DEL kb_search key failed")
				} else {
					logger.Debug().Str("key_id", keyID).Msg("[cache-inv] invalidated kb_search cache")
				}
			}
		}
	}
}
