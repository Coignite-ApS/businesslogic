package handler

import (
	"net/http"
	"strings"

	"github.com/coignite-aps/bl-gateway/internal/proxy"
)

// MCPHandler proxies Account MCP requests to formula-api.
// Route: POST /v1/mcp/account/:accountId → formula-api /mcp/account/:accountId
type MCPHandler struct {
	formulaAPI *proxy.Backend
}

func NewMCPHandler(formulaAPI *proxy.Backend) *MCPHandler {
	return &MCPHandler{formulaAPI: formulaAPI}
}

// AccountMCP handles POST /v1/mcp/account/:accountId
func (h *MCPHandler) AccountMCP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	if h.formulaAPI == nil {
		http.Error(w, `{"error":"formula-api backend unavailable"}`, http.StatusBadGateway)
		return
	}

	// Rewrite path: /v1/mcp/account/:accountId → /mcp/account/:accountId
	rest := strings.TrimPrefix(r.URL.Path, "/v1")
	r.URL.Path = rest

	h.formulaAPI.ServeHTTP(w, r)
}
