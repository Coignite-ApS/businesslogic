package handler

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/coignite-aps/bl-gateway/internal/proxy"
	"github.com/coignite-aps/bl-gateway/internal/service"
)

// MCPHandler proxies MCP requests to formula-api, authenticating via key prefix in the URL.
// Route: POST /v1/mcp/:keyPrefix → formula-api /mcp/account/:accountId
type MCPHandler struct {
	formulaAPI *proxy.Backend
	keyService *service.KeyService
}

func NewMCPHandler(formulaAPI *proxy.Backend, keyService *service.KeyService) *MCPHandler {
	return &MCPHandler{formulaAPI: formulaAPI, keyService: keyService}
}

// ByKeyPrefix handles POST /v1/mcp/:keyPrefix
// The key prefix in the URL IS the authentication — no X-API-Key header required.
func (h *MCPHandler) ByKeyPrefix(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	if h.formulaAPI == nil {
		http.Error(w, `{"error":"formula-api backend unavailable"}`, http.StatusBadGateway)
		return
	}

	// Extract key prefix from path: /v1/mcp/:keyPrefix
	rest := strings.TrimPrefix(r.URL.Path, "/v1/mcp/")
	// rest may be "bl_xxxxxxxx" or "bl_xxxxxxxx/..." — take first segment
	keyPrefix := strings.SplitN(rest, "/", 2)[0]
	if keyPrefix == "" {
		http.Error(w, `{"error":"missing key prefix"}`, http.StatusBadRequest)
		return
	}

	// Resolve key prefix → AccountData
	if h.keyService == nil {
		http.Error(w, `{"error":"key service unavailable"}`, http.StatusInternalServerError)
		return
	}

	acct, err := h.keyService.LookupByPrefix(r.Context(), keyPrefix)
	if err != nil {
		http.Error(w, `{"error":"invalid key prefix"}`, http.StatusForbidden)
		return
	}

	// Check calc service access
	if !acct.Permissions.HasServiceAccess("calc") {
		http.Error(w, `{"error":"forbidden: calc access not enabled"}`, http.StatusForbidden)
		return
	}

	// Determine resource filter
	calcPerm, hasPerm := acct.Permissions.Services["calc"]
	if hasPerm && calcPerm.Resources != nil {
		resources := *calcPerm.Resources
		if len(resources) == 0 {
			// [] = actively restricted, no resources allowed
			http.Error(w, `{"error":"forbidden: no calculator resources permitted"}`, http.StatusForbidden)
			return
		}
		if !(len(resources) == 1 && resources[0] == "*") {
			// Specific list — set filter header
			r.Header.Set("X-Permitted-Resources", strings.Join(resources, ","))
		}
		// ["*"] or nil = forward as-is (no filter header)
	}
	// nil Services map or missing "calc" = full access, forward as-is

	// Set standard gateway identity headers
	r.Header.Set("X-Account-ID", acct.AccountID)
	r.Header.Set("X-API-Key-ID", acct.KeyID)
	r.Header.Set("X-Gateway-Auth", "true")

	// Rewrite path: /v1/mcp/:keyPrefix → /mcp/account/:accountId
	r.URL.Path = fmt.Sprintf("/mcp/account/%s", acct.AccountID)

	h.formulaAPI.ServeHTTP(w, r)
}
