package cache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

type CachedResponse struct {
	StatusCode int               `json:"status_code"`
	Headers    map[string]string `json:"headers"`
	Body       []byte            `json:"body"`
}

type ResponseCache struct {
	redis *redis.Client
}

func New(rdb *redis.Client) *ResponseCache {
	return &ResponseCache{redis: rdb}
}

func (c *ResponseCache) Available() bool {
	return c.redis != nil
}

func (c *ResponseCache) Get(ctx context.Context, key string) (*CachedResponse, bool) {
	if c.redis == nil {
		return nil, false
	}
	data, err := c.redis.Get(ctx, key).Bytes()
	if err != nil {
		return nil, false
	}
	var resp CachedResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, false
	}
	return &resp, true
}

func (c *ResponseCache) Set(ctx context.Context, key string, resp *CachedResponse, ttl time.Duration) {
	if c.redis == nil {
		return
	}
	data, err := json.Marshal(resp)
	if err != nil {
		return
	}
	c.redis.Set(ctx, key, data, ttl)
}

func (c *ResponseCache) Invalidate(ctx context.Context, pattern string) error {
	if c.redis == nil {
		return nil
	}
	iter := c.redis.Scan(ctx, 0, pattern, 100).Iterator()
	for iter.Next(ctx) {
		c.redis.Del(ctx, iter.Val())
	}
	return iter.Err()
}

// CacheKey generates a deterministic cache key from method + path + query.
func CacheKey(method, path, query string) string {
	raw := method + "|" + path + "|" + query
	h := sha256.Sum256([]byte(raw))
	return "gw:rc:" + hex.EncodeToString(h[:16]) // 32-char hex
}
