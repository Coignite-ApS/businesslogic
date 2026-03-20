# BusinessLogic AI API

## Quick Start

```typescript
import { BusinessLogic } from '@coignite/sdk';

const bl = new BusinessLogic({ apiKey: 'bl_...' });

// Chat with AI
const response = await bl.chat.send({ message: 'What is our refund policy?' });
console.log(response.response);

// Search knowledge base
const results = await bl.kb.search('refund policy', 'kb-uuid');

// Ask knowledge base
const answer = await bl.kb.ask('What is our refund policy?', 'kb-uuid');
console.log(answer.answer);
```

## Authentication

All requests require an API key via the `X-API-Key` header. Keys are created in the BusinessLogic admin panel.

```bash
curl -H "X-API-Key: bl_your_key_here" \
  https://api.businesslogic.online/v1/ai/models
```

### API Key Permissions

Each key has granular permissions:

| Permission | Controls |
|-----------|----------|
| `ai` | Chat, KB search/ask, embeddings, MCP |
| `calc` | Calculator tools in chat |
| `flow` | Flow tools in chat |
| `kb` | Knowledge base tools in chat |

### Environments

Keys can be scoped to environments: `live`, `test`, or `dev`.

## Endpoints

### Chat

#### POST /v1/ai/chat — Streaming (SSE)

```bash
curl -N -H "X-API-Key: bl_..." \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}' \
  https://api.businesslogic.online/v1/ai/chat
```

**SSE Events:**
- `text_delta` — Streamed text chunk: `{"text": "..."}`
- `tool_use_start` — Tool execution starting: `{"name": "execute_calculator"}`
- `tool_executing` — Tool running: `{"name": "...", "id": "..."}`
- `tool_result` — Tool result: `{"name": "...", "result": {...}}`
- `conversation_created` — New conversation: `{"id": "uuid"}`
- `done` — Stream complete: `{"conversation_id": "...", "usage": {...}}`
- `error` — Error: `{"message": "..."}`

#### POST /v1/ai/chat/sync — Non-streaming

```bash
curl -H "X-API-Key: bl_..." \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}' \
  https://api.businesslogic.online/v1/ai/chat/sync
```

Response:
```json
{
  "data": {
    "conversation_id": "uuid",
    "response": "Hello! How can I help?",
    "tool_calls": [],
    "usage": {
      "input_tokens": 50,
      "output_tokens": 12,
      "model": "claude-sonnet-4-6",
      "cost_usd": 0.000234
    }
  }
}
```

**Usage headers** (both endpoints):
- `X-AI-Cost` — Cost in USD
- `X-AI-Tokens-Input` — Input tokens
- `X-AI-Tokens-Output` — Output tokens

### Knowledge Base

#### POST /v1/ai/kb/search — Hybrid search (BM25 + vector)

```json
{ "query": "refund policy", "kb_id": "uuid", "limit": 10 }
```

#### POST /v1/ai/kb/ask — Search + AI answer

```json
{ "question": "What is our refund policy?", "kb_id": "uuid" }
```

Response includes `answer`, `confidence`, `source_refs`, and `sources`.

#### GET /v1/ai/kb/list — List knowledge bases
#### POST /v1/ai/kb/create — Create KB
#### GET /v1/ai/kb/:kbId — Get KB with stats
#### POST /v1/ai/kb/:kbId/upload — Upload document for ingestion

### MCP (Model Context Protocol)

#### POST /v1/ai/mcp/:kbId — KB-specific MCP

JSON-RPC 2.0 endpoint for a single knowledge base. Exposes `kb_search_*` and `kb_ask_*` tools.

```json
{"jsonrpc":"2.0","id":1,"method":"initialize"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"kb_search_abc12345","arguments":{"query":"refund"}}}
```

#### POST /v1/mcp/account/:accountId — Unified MCP

Exposes ALL tools (calculators + knowledge bases) as a single MCP endpoint. One API key for all access.

### Embeddings

#### POST /v1/ai/embeddings

```json
{ "input": "text to embed", "model": "text-embedding-3-small" }
```

### Usage & Models

#### GET /v1/ai/usage — Monthly token usage
#### GET /v1/ai/models — Available models

## Rate Limiting

- Per-account rate limiting (configurable per API key)
- Subscription-based query quotas
- `Retry-After` header on 429 responses

## Error Codes

| Status | Meaning |
|--------|---------|
| 400 | Bad request / validation error |
| 401 | Missing or invalid API key |
| 403 | Permission denied (key lacks required permission) |
| 404 | Resource not found |
| 429 | Rate limit or quota exceeded |
| 503 | Service unavailable / AI provider not configured |

Error response format:
```json
{ "error": "Human-readable message" }
```
or
```json
{ "errors": [{ "message": "Detailed error" }] }
```

## OpenAPI Specification

Full spec: [`services/ai-api/docs/openapi.yaml`](../../services/ai-api/docs/openapi.yaml)
