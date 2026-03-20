package routes

import (
	"net/http"
	"strings"

	"github.com/coignite-aps/bl-gateway/internal/proxy"
)

type Router struct {
	backends map[string]*proxy.Backend
	mux      *http.ServeMux
}

func New(backends map[string]*proxy.Backend) *Router {
	r := &Router{
		backends: backends,
		mux:      http.NewServeMux(),
	}
	r.setup()
	return r
}

func (r *Router) setup() {
	// Route patterns
	routes := map[string]string{
		"/v1/ai/":           "ai-api",
		"/v1/calc/":         "formula-api",
		"/v1/mcp/calc/":     "formula-api",
		"/v1/mcp/ai/":       "ai-api",
		"/v1/flows/webhook/": "flow-trigger",
		"/admin/":           "cms",
	}

	for prefix, backendName := range routes {
		backend, ok := r.backends[backendName]
		if !ok {
			continue
		}
		p := prefix
		b := backend
		r.mux.HandleFunc(p, func(w http.ResponseWriter, req *http.Request) {
			// Rewrite path: strip gateway prefix, map to backend path
			req.URL.Path = rewritePath(req.URL.Path, p, backendName)
			b.ServeHTTP(w, req)
		})
	}
}

func rewritePath(path, prefix, backendName string) string {
	remainder := strings.TrimPrefix(path, strings.TrimSuffix(prefix, "/"))

	switch {
	case strings.HasPrefix(prefix, "/v1/mcp/calc/"):
		return "/mcp" + remainder
	case strings.HasPrefix(prefix, "/v1/mcp/ai/"):
		return "/mcp" + remainder
	case strings.HasPrefix(prefix, "/v1/ai/"):
		return "/" + strings.TrimPrefix(remainder, "/")
	case strings.HasPrefix(prefix, "/v1/calc/"):
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
