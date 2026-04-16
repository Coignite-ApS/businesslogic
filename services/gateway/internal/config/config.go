package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port     int
	LogLevel string

	RedisURL    string
	DatabaseURL string

	AIApiURL       string
	FormulaAPIURL  string
	FlowTriggerURL string
	CMSURL         string

	HealthCheckInterval     time.Duration
	CircuitBreakerThreshold int
	CircuitBreakerTimeout   time.Duration

	KeyCacheTTL      time.Duration
	NegativeCacheTTL time.Duration

	InternalSecret        string
	FormulaAPIAdminToken  string
	GatewaySharedSecret   string
	WidgetConfigCacheTTL  time.Duration
	WidgetCatalogCacheTTL time.Duration
}

func Load() *Config {
	return &Config{
		Port:     envInt("PORT", 8080),
		LogLevel: envStr("LOG_LEVEL", "info"),

		RedisURL:    envStr("REDIS_URL", "redis://localhost:6379"),
		DatabaseURL: envStr("DATABASE_URL", ""),

		AIApiURL:       envStr("AI_API_URL", "http://localhost:3200"),
		FormulaAPIURL:  envStr("FORMULA_API_URL", "http://localhost:3000"),
		FlowTriggerURL: envStr("FLOW_TRIGGER_URL", "http://localhost:3100"),
		CMSURL:         envStr("CMS_URL", "http://localhost:8055"),

		HealthCheckInterval:     envDuration("HEALTH_CHECK_INTERVAL", 10*time.Second),
		CircuitBreakerThreshold: envInt("CIRCUIT_BREAKER_THRESHOLD", 3),
		CircuitBreakerTimeout:   envDuration("CIRCUIT_BREAKER_TIMEOUT", 30*time.Second),

		KeyCacheTTL:      envDuration("KEY_CACHE_TTL", 10*time.Minute),
		NegativeCacheTTL: envDuration("NEGATIVE_CACHE_TTL", 1*time.Minute),

		InternalSecret:        envStr("GATEWAY_INTERNAL_SECRET", ""),
		FormulaAPIAdminToken:  envStr("FORMULA_API_ADMIN_TOKEN", ""),
		GatewaySharedSecret:   envStr("GATEWAY_SHARED_SECRET", ""),
		WidgetConfigCacheTTL:  envDuration("WIDGET_CONFIG_CACHE_TTL", 1*time.Hour),
		WidgetCatalogCacheTTL: envDuration("WIDGET_CATALOG_CACHE_TTL", 24*time.Hour),
	}
}

// Validate checks that critical secrets are set.
// Returns an error if secrets are missing and SKIP_SECRET_VALIDATION is not "true".
func (c *Config) Validate() error {
	type check struct {
		name  string
		value string
	}
	checks := []check{
		{"GATEWAY_SHARED_SECRET", c.GatewaySharedSecret},
	}

	var missing []string
	for _, ch := range checks {
		if ch.value == "" {
			missing = append(missing, ch.name)
		}
	}

	if len(missing) == 0 {
		return nil
	}

	if envStr("SKIP_SECRET_VALIDATION", "") == "true" {
		fmt.Printf("[config] WARN: SKIP_SECRET_VALIDATION=true — missing secrets ignored: %s\n", strings.Join(missing, ", "))
		return nil
	}

	return fmt.Errorf("missing required secrets: %s. Set them or use SKIP_SECRET_VALIDATION=true for local dev", strings.Join(missing, ", "))
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
