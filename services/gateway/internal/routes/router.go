package routes

import (
	"net/http"
	"strings"
	"time"

	"github.com/coignite-aps/bl-gateway/internal/cache"
	"github.com/coignite-aps/bl-gateway/internal/handler"
	"github.com/coignite-aps/bl-gateway/internal/middleware"
	"github.com/coignite-aps/bl-gateway/internal/proxy"
	"github.com/coignite-aps/bl-gateway/internal/service"
)

type Router struct {
	backends             map[string]*proxy.Backend
	mux                  *http.ServeMux
	apiKeyHandler        *handler.APIKeyHandler
	keyService           *service.KeyService
	responseCache        *cache.ResponseCache
	internalSecret       string
	formulaAPIAdminToken string
	configCacheTTL       time.Duration
	catalogCacheTTL      time.Duration
	auditFn              middleware.AuditLogFn
}

type RouterConfig struct {
	Backends             map[string]*proxy.Backend
	APIKeyHandler        *handler.APIKeyHandler
	KeyService           *service.KeyService
	ResponseCache        *cache.ResponseCache
	InternalSecret       string
	FormulaAPIAdminToken string
	ConfigCacheTTL       time.Duration
	CatalogCacheTTL      time.Duration
	// AuditFn is called for every /internal/* request. Nil = default zerolog.
	AuditFn middleware.AuditLogFn
}

func New(cfg RouterConfig) *Router {
	r := &Router{
		backends:             cfg.Backends,
		mux:                  http.NewServeMux(),
		apiKeyHandler:        cfg.APIKeyHandler,
		keyService:           cfg.KeyService,
		responseCache:        cfg.ResponseCache,
		internalSecret:       cfg.InternalSecret,
		formulaAPIAdminToken: cfg.FormulaAPIAdminToken,
		configCacheTTL:       cfg.ConfigCacheTTL,
		catalogCacheTTL:      cfg.CatalogCacheTTL,
		auditFn:              cfg.AuditFn,
	}
	r.setup()
	return r
}

func (r *Router) setup() {
	// Standard API routes
	apiRoutes := map[string]string{
		"/v1/ai/":             "ai-api",
		"/v1/formula/":        "formula-api",
		"/v1/mcp/formula/":    "formula-api",
		"/v1/mcp/calculator/": "formula-api",
		"/v1/mcp/ai/":         "ai-api",
		"/v1/flows/webhook/":  "flow-trigger",
		"/admin/":             "cms",
	}

	for prefix, backendName := range apiRoutes {
		backend, ok := r.backends[backendName]
		if !ok {
			continue
		}
		p := prefix
		b := backend
		r.mux.HandleFunc(p, func(w http.ResponseWriter, req *http.Request) {
			req.URL.Path = rewritePath(req.URL.Path, p, backendName)
			b.ServeHTTP(w, req)
		})
	}

	// Calculator routes (path param extraction like widgets)
	r.setupCalculatorRoutes()

	// Widget routes (GW-03)
	r.setupWidgetRoutes()

	// MCP by key prefix route (GW-06)
	r.setupMCPKeyPrefixRoute()

	// Internal service proxy routes (GW-04)
	r.setupInternalServiceProxy()

	// Internal routes (GW-02 + cache invalidation)
	r.setupInternalRoutes()
}

func (r *Router) setupCalculatorRoutes() {
	formulaAPI, ok := r.backends["formula-api"]
	if !ok {
		return
	}

	// /v1/calculator/execute/:id → formula-api /execute/calculator/:id
	// /v1/calculator/describe/:id → formula-api /calculator/:id/describe
	r.mux.HandleFunc("/v1/calculator/", func(w http.ResponseWriter, req *http.Request) {
		rest := strings.TrimPrefix(req.URL.Path, "/v1/calculator/")
		parts := strings.SplitN(rest, "/", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			http.Error(w, `{"error":"invalid calculator path"}`, http.StatusBadRequest)
			return
		}

		action := parts[0]
		calcID := parts[1]

		switch action {
		case "execute":
			req.URL.Path = "/execute/calculator/" + calcID
		case "describe":
			req.URL.Path = "/calculator/" + calcID + "/describe"
		default:
			http.Error(w, `{"error":"unknown calculator action"}`, http.StatusNotFound)
			return
		}
		formulaAPI.ServeHTTP(w, req)
	})
}

func (r *Router) setupMCPKeyPrefixRoute() {
	formulaBackend, ok := r.backends["formula-api"]
	if !ok {
		return
	}

	// NOTE: This route does NOT use standard Auth middleware — the key prefix IS the auth.
	// The handler itself resolves prefix → account and checks permissions.
	mcpHandler := handler.NewMCPHandler(formulaBackend, r.keyService)

	// Register with a trailing slash to catch /v1/mcp/:keyPrefix
	// Must be registered AFTER /v1/mcp/formula/, /v1/mcp/calculator/, /v1/mcp/ai/ (more specific prefixes win in ServeMux).
	r.mux.HandleFunc("/v1/mcp/", func(w http.ResponseWriter, req *http.Request) {
		// Only handle paths that look like /v1/mcp/:keyPrefix (not already matched by named routes)
		rest := strings.TrimPrefix(req.URL.Path, "/v1/mcp/")
		if strings.HasPrefix(rest, "formula/") || strings.HasPrefix(rest, "calculator/") || strings.HasPrefix(rest, "ai/") {
			// Should be handled by the standard proxy routes above — fallback 404
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		mcpHandler.ByKeyPrefix(w, req)
	})
}

func (r *Router) setupWidgetRoutes() {
	cms, hasCMS := r.backends["cms"]
	formulaAPI, hasFormula := r.backends["formula-api"]

	// GET /v1/widget/:id/display → CMS /calc/widget-config/:id (cached)
	if hasCMS {
		r.mux.HandleFunc("/v1/widget/components", r.widgetCatalogHandler(cms, "/calc/widget-components"))
		r.mux.HandleFunc("/v1/widget/themes", r.widgetCatalogHandler(cms, "/calc/widget-themes"))
		r.mux.HandleFunc("/v1/widget/templates", r.widgetCatalogHandler(cms, "/calc/widget-templates"))
	}

	// Widget display + execute — need path param extraction
	r.mux.HandleFunc("/v1/widget/", func(w http.ResponseWriter, req *http.Request) {
		// Parse /v1/widget/:id/display or /v1/widget/:id/execute
		rest := strings.TrimPrefix(req.URL.Path, "/v1/widget/")
		parts := strings.SplitN(rest, "/", 2)
		if len(parts) != 2 || parts[0] == "" {
			http.Error(w, `{"error":"invalid widget path"}`, http.StatusBadRequest)
			return
		}

		calcID := parts[0]
		action := parts[1]

		switch action {
		case "display":
			if !hasCMS {
				http.Error(w, `{"error":"cms backend unavailable"}`, http.StatusBadGateway)
				return
			}
			req.URL.Path = "/calc/widget-config/" + calcID
			// Apply response cache for display
			if r.responseCache != nil && r.responseCache.Available() && req.Method == http.MethodGet {
				key := cache.CacheKey(req.Method, req.URL.Path, req.URL.RawQuery)
				if cached, ok := r.responseCache.Get(req.Context(), key); ok {
					for k, v := range cached.Headers {
						w.Header().Set(k, v)
					}
					w.Header().Set("X-Cache", "HIT")
					w.WriteHeader(cached.StatusCode)
					w.Write(cached.Body)
					return
				}
			}
			cms.ServeHTTP(w, req)

		case "execute":
			if !hasFormula {
				http.Error(w, `{"error":"formula-api backend unavailable"}`, http.StatusBadGateway)
				return
			}
			req.URL.Path = "/execute/calculator/" + calcID
			formulaAPI.ServeHTTP(w, req)

		default:
			http.Error(w, `{"error":"unknown widget action"}`, http.StatusNotFound)
		}
	})
}

func (r *Router) widgetCatalogHandler(backend *proxy.Backend, targetPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		// Apply cache for catalog endpoints
		if r.responseCache != nil && r.responseCache.Available() && req.Method == http.MethodGet {
			key := cache.CacheKey(req.Method, targetPath, req.URL.RawQuery)
			if cached, ok := r.responseCache.Get(req.Context(), key); ok {
				for k, v := range cached.Headers {
					w.Header().Set(k, v)
				}
				w.Header().Set("X-Cache", "HIT")
				w.WriteHeader(cached.StatusCode)
				w.Write(cached.Body)
				return
			}
		}
		req.URL.Path = targetPath
		backend.ServeHTTP(w, req)
	}
}

func (r *Router) setupInternalRoutes() {
	if r.apiKeyHandler == nil || r.internalSecret == "" {
		return
	}

	internalAuth := middleware.InternalAuth(r.internalSecret)
	internalAudit := middleware.InternalAudit(r.auditFn)

	// API Key management
	r.mux.Handle("/internal/api-keys/", internalAuth(internalAudit(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		path := req.URL.Path

		switch req.Method {
		case http.MethodPost:
			if strings.HasSuffix(path, "/rotate") {
				r.apiKeyHandler.Rotate(w, req)
			} else if path == "/internal/api-keys/auto-provision" {
				r.apiKeyHandler.AutoProvision(w, req)
			} else if path == "/internal/api-keys/" || path == "/internal/api-keys" {
				r.apiKeyHandler.Create(w, req)
			} else {
				http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			}
		case http.MethodGet:
			if path == "/internal/api-keys/" || path == "/internal/api-keys" {
				r.apiKeyHandler.List(w, req)
			} else if path == "/internal/api-keys/check-live" {
				r.apiKeyHandler.CheckLiveKey(w, req)
			} else {
				r.apiKeyHandler.Get(w, req)
			}
		case http.MethodPatch:
			r.apiKeyHandler.Update(w, req)
		case http.MethodDelete:
			r.apiKeyHandler.Revoke(w, req)
		default:
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		}
	}))))

	// Cache invalidation
	r.mux.Handle("/internal/cache/invalidate", internalAuth(internalAudit(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		if r.responseCache == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// Invalidate all widget cache entries
		r.responseCache.Invalidate(req.Context(), "gw:rc:*")
		w.WriteHeader(http.StatusNoContent)
	}))))
}

func (r *Router) setupInternalServiceProxy() {
	if r.internalSecret == "" {
		return
	}

	internalAuth := middleware.InternalAuth(r.internalSecret)
	internalAudit := middleware.InternalAudit(r.auditFn)

	// /internal/formula/* → formula-api, /internal/ai/* → ai-api, /internal/flow/* → flow-trigger
	internalRoutes := map[string]string{
		"/internal/formula/": "formula-api",
		"/internal/ai/":      "ai-api",
		"/internal/flow/":    "flow-trigger",
	}

	for prefix, backendName := range internalRoutes {
		backend, ok := r.backends[backendName]
		if !ok {
			continue
		}
		p := prefix
		b := backend
		bn := backendName
		r.mux.Handle(p, internalAuth(internalAudit(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			// Strip internal secret — don't leak to backend
			req.Header.Del("X-Internal-Secret")
			// Inject admin token for formula-api (P0-1)
			if bn == "formula-api" && r.formulaAPIAdminToken != "" {
				req.Header.Set("X-Admin-Token", r.formulaAPIAdminToken)
			}
			// Rewrite path: /internal/formula/foo → /foo
			req.URL.Path = "/" + strings.TrimPrefix(req.URL.Path, p)
			b.ServeHTTP(w, req)
		}))))
	}
}

func rewritePath(path, prefix, backendName string) string {
	remainder := strings.TrimPrefix(path, strings.TrimSuffix(prefix, "/"))

	switch {
	case strings.HasPrefix(prefix, "/v1/mcp/formula/"):
		return "/mcp" + remainder
	case strings.HasPrefix(prefix, "/v1/mcp/calculator/"):
		return "/mcp" + remainder
	case strings.HasPrefix(prefix, "/v1/mcp/ai/"):
		return "/mcp" + remainder
	case strings.HasPrefix(prefix, "/v1/ai/"):
		return "/v1/ai/" + strings.TrimPrefix(remainder, "/")
	case strings.HasPrefix(prefix, "/v1/formula/"):
		return "/" + strings.TrimPrefix(remainder, "/")
	case strings.HasPrefix(prefix, "/v1/flows/webhook/"):
		return "/webhook" + remainder
	case strings.HasPrefix(prefix, "/admin/"):
		return "/" + strings.TrimPrefix(remainder, "/")
	}
	return remainder
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	r.mux.ServeHTTP(w, req)
}
