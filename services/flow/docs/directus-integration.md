# Directus Integration

The BusinessLogic Flow Engine shares PostgreSQL with the existing Directus CMS and extends it via two new extensions that provide visual flow editing and API proxying capabilities.

## Overview

The flow engine integrates seamlessly with Directus by:

1. **Shared Database** — All flow tables use the `bl_` prefix to distinguish them from core Directus collections. These are managed as regular Directus collections with full audit logging and permissions support.
2. **Data-Driven Node Types** — Node type registry (`bl_node_types`) is synced from the Rust engine at startup, allowing Directus to display type metadata in the visual editor.
3. **Two New Extensions** — A visual editor module and an API proxy layer that bridge Directus with the flow execution engine.
4. **Event-Driven Sync** — Redis PubSub carries execution events from the flow engine back to Directus extensions for real-time status updates.

## New Collections

All collections use the Directus API and are fully audited, permissioned, and support webhooks.

### bl_flows

Flow definitions with complete graph, trigger configuration, and execution settings.

**Schema:**
```sql
CREATE TABLE bl_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  graph JSONB NOT NULL,                    -- Vue Flow format: { nodes: [...], edges: [...] }
  trigger_type VARCHAR(50) NOT NULL,      -- 'webhook' | 'manual' | 'schedule' | 'event'
  trigger_config JSONB NOT NULL,          -- e.g., { cron: '0 9 * * *' } or { event: 'calculator.updated' }
  settings JSONB,                          -- { timeout_ms, memory_limit_mb, max_retries, ... }
  active BOOLEAN DEFAULT false,
  deployed_at TIMESTAMP,
  deployed_by UUID REFERENCES directus_users(id),
  status VARCHAR(50),                     -- 'draft' | 'active' | 'archived'
  execution_count INT DEFAULT 0,
  error_count INT DEFAULT 0,
  avg_duration_ms NUMERIC,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  created_by UUID REFERENCES directus_users(id),
  updated_by UUID REFERENCES directus_users(id)
);
```

**Directus Configuration:**
- Permissions: Scoped by `account_id`
- Workflow: Draft → Deploy → Active → Archive
- Webhooks: Fire on status change (deploy trigger)

### bl_flow_executions

Execution history and audit log. Immutable records for every flow trigger.

**Schema:**
```sql
CREATE TABLE bl_flow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES bl_flows(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  trigger_id VARCHAR(255),               -- e.g., webhook_token, schedule_run_id
  trigger_data JSONB,                    -- Input parameters passed to flow
  execution_state JSONB,                 -- Checkpointed execution state (for recovery)
  output JSONB,                          -- Final execution result
  status VARCHAR(50) NOT NULL,           -- 'pending' | 'running' | 'success' | 'failed' | 'aborted'
  error_message TEXT,
  error_code VARCHAR(50),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INT,
  node_executions JSONB,                 -- { [nodeId]: { status, duration_ms, output, error } }
  cost_estimate NUMERIC,                 -- Estimated LLM/API cost in $
  created_at TIMESTAMP DEFAULT now()
);
```

**Directus Configuration:**
- Immutable: Delete not allowed (audit trail)
- Permissions: Scoped by `account_id`
- Index: `(flow_id, created_at DESC)` for filtering
- Archive after 90 days to cold storage

### bl_node_types

Node type registry synced from the Rust engine at startup. Provides metadata for the visual editor.

**Schema:**
```sql
CREATE TABLE bl_node_types (
  id VARCHAR(100) PRIMARY KEY,           -- e.g., 'http', 'transform', 'llm', 'calculator'
  category VARCHAR(50),                  -- 'input' | 'compute' | 'output' | 'control'
  display_name VARCHAR(255),
  description TEXT,
  input_schema JSONB,                    -- JSON Schema for input ports
  output_schema JSONB,                   -- JSON Schema for output ports
  settings_schema JSONB,                 -- JSON Schema for node configuration
  icon VARCHAR(50),                      -- Icon class or URL
  tags JSON,                             -- ['async', 'billable', 'external', ...]
  documentation_url VARCHAR(500),
  synced_at TIMESTAMP DEFAULT now(),
  synced_by VARCHAR(100)                 -- e.g., 'engine-v0.2.3'
);
```

**Directus Configuration:**
- Auto-synced by flow-api extension on startup (read-only in UI)
- Used by flow editor to render node panels dynamically

### kb_documents (Future)

Knowledge base document index for retrieval flows.

**Schema:**
```sql
CREATE TABLE kb_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  source_type VARCHAR(50),               -- 'upload' | 'url' | 'database'
  source_uri VARCHAR(500),               -- File path, URL, or table reference
  title VARCHAR(255),
  content TEXT,                          -- Full text for BM25 search
  metadata JSONB,                        -- { author, tags, access_level, ... }
  indexed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
```

**Directus Configuration:**
- Scoped by `account_id`
- Webhook on create/update to trigger ingest flow (Phase 3)

### kb_chunks

Embedding chunks with pgvector for semantic search.

**Schema:**
```sql
CREATE TABLE kb_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES kb_documents(id),
  account_id UUID NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),               -- OpenAI embeddings (pgvector)
  chunk_index INT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX ON kb_chunks USING ivfflat (embedding vector_cosine_ops);
```

**Directus Configuration:**
- Scoped by `account_id`
- Not exposed in UI (managed by Vector Search node)

## New Extensions

### project-extension-flows

**Type:** Module
**Vue Pattern:** Based on existing `calculators` module
**Tech Stack:** Vue 3 + Composition API, TypeScript, Vue Flow (@vue-flow/core)

**Features:**

1. **Visual Flow Editor**
   - Drag-and-drop node palette (categorized: Input, Compute, Output, Control)
   - Canvas with zooming and panning
   - Node property panels with dynamic forms (generated from `bl_node_types.settings_schema`)
   - Edge drawing with validation (type checking)
   - Auto-layout for new nodes
   - Copy/paste node templates

2. **Flow Management**
   - Browse flows: filterable table (account, status, execution count)
   - Create flow: modal with name, slug, description
   - Edit flow: canvas + metadata panel
   - Duplicate flow: copy graph + reset name
   - Archive/delete: bulk operations
   - Flow versioning: compare graph changes over time

3. **Execution Monitor**
   - Live execution status overlay on canvas during trigger
   - Node color states: pending (gray), running (blue), success (green), failed (red), skipped (light gray)
   - Execution history sidebar: list recent runs with duration, status, cost
   - Drill-down: click execution → view node-by-node output and errors

4. **Integration**
   - **Trigger Mapping Modal:** Map webhook/schedule parameters to flow input ports
   - **Calculator Browser:** Search and select calculators for Calculator node
   - **LLM Model Picker:** Select GPT-4, Claude, etc. for LLM node
   - **Knowledge Base Picker:** Select KB for Vector Search node

**File Structure:**
```
extensions/project-extension-flows/
├── index.ts                                # Extension config
├── src/
│   ├── modules/
│   │   └── flows/
│   │       ├── index.ts
│   │       ├── FlowEditor.vue             # Main editor
│   │       ├── FlowList.vue               # Browse/manage
│   │       ├── ExecutionMonitor.vue       # Real-time status
│   │       ├── components/
│   │       │   ├── NodePalette.vue
│   │       │   ├── CanvasToolbar.vue
│   │       │   ├── NodePanel.vue
│   │       │   ├── ExecutionHistory.vue
│   │       │   └── TriggerMapper.vue
│   │       └── composables/
│   │           ├── useFlow.ts             # CRUD + validation
│   │           ├── useFlowExecution.ts    # SSE connection
│   │           └── useNodeTypes.ts        # Load from bl_node_types
│   └── utils/
│       ├── schema-to-form.ts             # bl_node_types.settings_schema → Vue Form
│       └── vue-flow-to-graph.ts          # Serialize/deserialize
├── package.json
└── tsconfig.json
```

**Dependencies:**
```json
{
  "@vue-flow/core": "^1.x",
  "@vue-flow/controls": "^1.x",
  "@vue-flow/background": "^1.x",
  "@vue/composition-api": "^1.x",
  "axios": "latest"
}
```

### project-extension-flow-api

**Type:** Hook + Routes
**Pattern:** Based on existing `calculator-api` extension
**Tech Stack:** Express/Node.js, TypeScript

**Routes:**

1. **POST /flows/:flowId/deploy**
   - Validate flow graph (cycle detection, port type matching)
   - Activate flow (set `active=true`, `status='active'`, `deployed_at=now()`)
   - Sync to Redis cache for trigger service
   - Webhook trigger: notify external systems
   - Response: `{ success, graph, errors?: [...] }`

2. **POST /flows/:flowId/trigger**
   - Manual trigger (same as webhook but no signature check)
   - Request: `{ data: {...} }` (trigger_data)
   - Response: `{ execution_id, status }`

3. **GET /flows/:flowId/executions/:executionId**
   - Fetch execution record
   - Response: full `bl_flow_executions` row

4. **GET /flows/:flowId/executions/:executionId/stream** (SSE)
   - Real-time execution status
   - Events: `node-start`, `node-complete`, `node-error`, `flow-complete`
   - Payload: `{ nodeId, status, output, duration_ms, error }`
   - Closes after flow completes or timeout

5. **POST /flows/:flowId/abort**
   - Abort running execution
   - Request: `{ execution_id }`
   - Response: `{ success }`

6. **POST /node-types/sync**
   - Called by hook on extension startup
   - Fetch node type definitions from Rust engine
   - Upsert into `bl_node_types` collection
   - Response: `{ synced: N, errors: [...] }`

7. **POST /flows/validate**
   - Validate graph without deploying
   - Request: `{ graph: {...} }`
   - Response: `{ valid, errors?: [...] }`

**Hooks:**

1. **Extension Init**
   - Sync node types: `POST /node-types/sync`
   - Ensure indices on `bl_flow_executions`
   - Register webhook handler for flow status changes

2. **Filter: bl_flows.graph (before save)**
   - Validate JSON structure
   - Cycle detection (DAG check)
   - Port type validation
   - Return errors to user

3. **Action: bl_flows.items.update (after update)**
   - If `status='active'` and `active=true`: POST to trigger service `/flows/deploy`
   - If `active=false`: POST to trigger service `/flows/deactivate`

4. **Action: directus_webhooks.items.create (after create)**
   - If webhook references a flow: validate flow exists and is active

**File Structure:**
```
extensions/project-extension-flow-api/
├── index.ts                                # Extension config
├── src/
│   ├── routes.ts                           # All endpoints above
│   ├── hooks.ts                            # Directus hooks
│   ├── services/
│   │   ├── flow-validation.ts             # Graph validation
│   │   ├── node-type-sync.ts              # Sync from Rust
│   │   └── trigger-client.ts              # REST client to trigger service
│   └── utils/
│       ├── sse-handler.ts
│       └── error-mapping.ts               # Map engine errors to HTTP
├── package.json
└── tsconfig.json
```

## Extending Existing Extensions

### admin

**Changes:**
- Add flow metrics card to dashboard
  - Executions per day (last 7 days, bar chart)
  - Error rate (red/green indicator)
  - Average execution duration (ms)
  - Top 5 slowest flows
- Flow settings: execution timeout, memory limit, max retries
- Deprecation: Remove old HyperFormula function editor

### stripe

**Changes:**
- Add flow execution limits to subscription plans
  - e.g., Pro plan: 10K executions/month
  - Enterprise: unlimited
- Track execution usage per account
- Warn when account approaches limit (80%, 95%)
- Webhook: update usage stats in Stripe (for billing analytics)

### account

**Changes:**
- Add nested relation: `account.flows` → list of `bl_flows` for account
- Add nested relation: `account.knowledge_bases` → future `kb_index` collection
- Migration: Create default knowledge base for new accounts
- UI: Show flow and KB counts on account overview

### calculator-api

**No Changes Required**

Flows can call calculators via the **Calculator node** (Phase 2). The Calculator node will use existing HTTP client to call the `/execute` endpoint.

## Communication Patterns

### Directus → Flow Engine

**Deploy Flow**
```
POST /flows/deploy
Content-Type: application/json
Authorization: Bearer engine-admin-token

{
  "flow_id": "uuid",
  "graph": {...},
  "trigger_config": {...}
}
```

**Manual Trigger**
```
POST /flows/{flowId}/trigger
Content-Type: application/json

{
  "data": { "param1": "value1" }
}
```

### Flow Engine → Directus

**Read Flow Definition**
```
SELECT * FROM bl_flows WHERE id = $1 AND account_id = $2
```

**Read Node Types**
```
SELECT * FROM bl_node_types
```

**Write Execution Record**
```
INSERT INTO bl_flow_executions (flow_id, account_id, ...) VALUES (...)
```

### Real-Time: Flow Engine → Directus (SSE/WebSocket)

**Redis PubSub Topic:** `flow:execution:{executionId}`

**Events:**
```json
{
  "event": "node-start",
  "nodeId": "node-123",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

The `project-extension-flow-api` subscribes to Redis and broadcasts to browser clients via Server-Sent Events.

## Extension Development Guidelines

### Prerequisites

1. Install Directus extension CLI:
   ```bash
   npm install -g @directus/extensions-sdk
   ```

2. Review Directus docs:
   - Module extensions: https://directus.io/docs/guides/extensions/modules
   - Routes/Hooks: https://directus.io/docs/guides/extensions/routes-hooks

### Creating an Extension

Use the Directus CLI scaffold:

```bash
npx create-directus-extension@latest
# Choose: Module or Routes+Hooks
# Naming: project-extension-flows or project-extension-flow-api
```

### Development Workflow

```bash
# Install dependencies
npm install

# Development mode (watch rebuild)
directus-extension build -w --no-minify

# Production build
npm run build
```

### Code Standards

- **TypeScript:** Always use TS for type safety
- **Vue 3 + Composition API:** Use `<script setup>` syntax
- **Error Handling:** Use try-catch and propagate via HTTP status codes
- **Logging:** Use Directus logger: `import { logger } from '@directus/api'`
- **Testing:** Unit tests with Vitest

### Naming Convention

- Base extensions (submodule): `base-extension-*`
- Project extensions: `project-extension-*`
- Example: `project-extension-flows`, `project-extension-flow-api`

## Deployment

1. **Development:** Extensions in `extensions/` loaded automatically by Directus
2. **Production:** Extensions bundled in Docker image, deployed with Directus

See `/Volumes/Data/Code/businesslogic-cms/base/docs/deployment.md` for Docker build process.
