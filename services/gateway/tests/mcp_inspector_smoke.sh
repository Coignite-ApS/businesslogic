#!/usr/bin/env bash
# MCP Inspector smoke test for /v1/mcp/platform (06a).
# Requires: dev stack running (make up), API key seeded in DB.
#
# Usage:
#   GATEWAY_URL=http://localhost:8080 API_KEY=bl_xxx ./mcp_inspector_smoke.sh
#
# Alternative: use the official MCP Inspector CLI:
#   npx @modelcontextprotocol/inspector \
#     http://localhost:8080/v1/mcp/platform \
#     --header "X-API-Key: ${API_KEY}"
#
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
API_KEY="${API_KEY:?API_KEY env var required}"

echo "→ initialize"
INIT=$(curl -sS -X POST "${GATEWAY_URL}/v1/mcp/platform" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"smoke","version":"1.0"},"capabilities":{}}}' \
  -i)

SESSION_ID=$(echo "${INIT}" | grep -i '^Mcp-Session-Id:' | awk -F': ' '{print $2}' | tr -d '\r\n')

if [[ -z "${SESSION_ID}" ]]; then
  echo "FAIL: no Mcp-Session-Id returned"
  echo "${INIT}"
  exit 1
fi
echo "  session=${SESSION_ID}"

echo "→ ping"
curl -fsS -X POST "${GATEWAY_URL}/v1/mcp/platform" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: ${SESSION_ID}" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"ping"}' | jq '.result' >/dev/null

echo "→ tools/list"
TOOLS=$(curl -fsS -X POST "${GATEWAY_URL}/v1/mcp/platform" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: ${SESSION_ID}" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}')
echo "${TOOLS}" | jq '.result.tools | length' | xargs -I{} echo "  tool count: {}"

echo "→ DELETE session"
curl -fsS -X DELETE "${GATEWAY_URL}/v1/mcp/platform" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Mcp-Session-Id: ${SESSION_ID}"

echo "✅ smoke pass"
