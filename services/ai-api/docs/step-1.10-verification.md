Step 1.10: Verified AI Assistant and Knowledge modules use relative Directus paths.

Both modules pass the Directus `api` SDK object to composables which make all HTTP
calls via relative paths (e.g., `/assistant/chat`, `/kb/search`, `/kb/${id}/documents`).
The only exception is `use-chat.ts` which extracts `api.defaults.baseURL` for the SSE
streaming fetch — this is still relative to the Directus origin, so the proxy handles it.

Endpoints used by AI Assistant module:
  - POST /assistant/chat (SSE streaming via fetch, uses api.defaults.baseURL)
  - GET  /assistant/conversations
  - GET  /assistant/conversations/:id
  - POST /assistant/conversations
  - PATCH /assistant/conversations/:id
  - DELETE /assistant/conversations/:id
  - GET  /assistant/usage

Endpoints used by Knowledge module:
  - GET  /kb/list
  - GET  /kb/:id
  - POST /kb/create
  - PATCH /kb/:id
  - DELETE /kb/:id
  - GET  /kb/:id/documents
  - POST /kb/:id/upload
  - DELETE /kb/:id/documents/:docId
  - POST /kb/:id/reindex/:docId
  - POST /kb/search
  - POST /kb/ask
  - POST /kb/feedback
  - GET  /kb/:id/curated
  - POST /kb/:id/curated
  - PATCH /kb/:id/curated/:answerId
  - DELETE /kb/:id/curated/:answerId

No code changes needed — proxy in step 1.9 handles routing transparently.
Verified: 2026-03-20
