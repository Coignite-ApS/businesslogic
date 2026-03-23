package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/coignite-aps/bl-gateway/internal/cache"
	"github.com/coignite-aps/bl-gateway/internal/config"
	"github.com/coignite-aps/bl-gateway/internal/handler"
	"github.com/coignite-aps/bl-gateway/internal/middleware"
	"github.com/coignite-aps/bl-gateway/internal/proxy"
	"github.com/coignite-aps/bl-gateway/internal/routes"
	"github.com/coignite-aps/bl-gateway/internal/service"
	"github.com/coignite-aps/bl-gateway/internal/telemetry"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	cfg := config.Load()

	// Setup logging
	level, err := zerolog.ParseLevel(cfg.LogLevel)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)
	log.Logger = zerolog.New(os.Stdout).With().Timestamp().Logger()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Initialize OpenTelemetry
	shutdownOtel := telemetry.Init(ctx)
	defer shutdownOtel(ctx)

	// Connect to Redis
	var rdb *redis.Client
	opts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Warn().Err(err).Msg("invalid redis URL, running without Redis")
	} else {
		rdb = redis.NewClient(opts)
		if err := rdb.Ping(ctx).Err(); err != nil {
			log.Warn().Err(err).Msg("redis not available, running without cache")
			rdb = nil
		} else {
			log.Info().Msg("connected to Redis")
		}
	}

	// Connect to PostgreSQL
	var dbPool *pgxpool.Pool
	dbPool, err = pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Warn().Err(err).Msg("database not available, running without DB")
	} else {
		if err := dbPool.Ping(ctx); err != nil {
			log.Warn().Err(err).Msg("database ping failed")
			dbPool = nil
		} else {
			log.Info().Msg("connected to PostgreSQL")
		}
	}

	// Key service
	keyService := service.NewKeyService(rdb, dbPool, cfg.KeyCacheTTL, cfg.NegativeCacheTTL)

	// Response cache
	responseCache := cache.New(rdb)

	// API key handler
	var apiKeyHandler *handler.APIKeyHandler
	if dbPool != nil {
		apiKeyHandler = handler.NewAPIKeyHandler(dbPool, rdb)
	}

	// Create backends
	backendDefs := map[string]string{
		"ai-api":       cfg.AIApiURL,
		"formula-api":  cfg.FormulaAPIURL,
		"flow-trigger": cfg.FlowTriggerURL,
		"cms":          cfg.CMSURL,
	}

	healthPaths := map[string]string{
		"cms": "/server/ping",
	}

	backends := make(map[string]*proxy.Backend)
	var backendList []*proxy.Backend
	for name, rawURL := range backendDefs {
		b, err := proxy.NewBackend(name, rawURL, cfg.CircuitBreakerThreshold, cfg.CircuitBreakerTimeout)
		if err != nil {
			log.Fatal().Err(err).Str("backend", name).Msg("failed to create backend")
		}
		if hp, ok := healthPaths[name]; ok {
			b.HealthPath = hp
		}
		backends[name] = b
		backendList = append(backendList, b)
	}

	// Health checker
	healthChecker := proxy.NewHealthChecker(backendList, cfg.HealthCheckInterval)
	healthChecker.Start(ctx)

	// Router
	router := routes.New(routes.RouterConfig{
		Backends:        backends,
		APIKeyHandler:   apiKeyHandler,
		ResponseCache:   responseCache,
		InternalSecret:  cfg.InternalSecret,
		ConfigCacheTTL:  cfg.WidgetConfigCacheTTL,
		CatalogCacheTTL: cfg.WidgetCatalogCacheTTL,
	})

	// Build handler chain
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthChecker.Handler())
	mux.Handle("/", router)

	// Middleware chain (outermost first)
	var h http.Handler = mux
	h = middleware.GatewaySign(cfg.GatewaySharedSecret)(h)
	h = middleware.CORS(h)
	h = middleware.RateLimit(keyService)(h)
	h = middleware.Auth(keyService)(h)
	h = middleware.Tracing(h)
	h = middleware.Logging(h)
	h = middleware.SecurityHeaders(h)
	h = middleware.RequestID(h)

	// Server
	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      h,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Info().Msg("shutting down...")
		cancel()

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Error().Err(err).Msg("shutdown error")
		}
	}()

	log.Info().Int("port", cfg.Port).Msg("bl-gateway starting")
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal().Err(err).Msg("server error")
	}
	log.Info().Msg("bl-gateway stopped")
}
