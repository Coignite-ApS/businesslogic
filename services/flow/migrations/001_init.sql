-- BusinessLogic Flow Engine — Initial Schema
-- Extends the existing Directus PostgreSQL database.
-- All tables use the "bl_" prefix to avoid Directus namespace collisions.
-- Requires: pgvector extension (for future knowledge base features).

-- ============================================================================
-- Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- CREATE EXTENSION IF NOT EXISTS "vector";  -- Enable when knowledge base is implemented

-- ============================================================================
-- Flow Definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS bl_flows (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    description     TEXT,
    account_id      UUID NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'disabled')),
    -- The full flow graph (nodes + edges) as JSONB.
    graph           JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    -- Trigger configuration (webhook, cron, db_event, manual, flow_event).
    trigger_config  JSONB NOT NULL DEFAULT '{"type":"manual"}',
    -- Flow-level settings (mode, timeout, priority, budget).
    settings        JSONB NOT NULL DEFAULT '{}',
    -- Version counter for optimistic locking.
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bl_flows_account ON bl_flows (account_id);
CREATE INDEX idx_bl_flows_status ON bl_flows (status);
CREATE INDEX idx_bl_flows_trigger_type ON bl_flows ((trigger_config->>'type'));

-- ============================================================================
-- Flow Executions (execution history / audit log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bl_flow_executions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flow_id         UUID NOT NULL REFERENCES bl_flows(id) ON DELETE CASCADE,
    account_id      UUID NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'timed_out')),
    -- Trigger data that started this execution.
    trigger_data    JSONB,
    -- Full execution context after completion (all node outputs).
    context         JSONB,
    -- Final result (last node output).
    result          JSONB,
    -- Error message if failed.
    error           TEXT,
    -- Execution metrics.
    duration_ms     BIGINT,
    nodes_executed  INTEGER DEFAULT 0,
    -- LLM/AI cost tracking.
    cost_usd        DOUBLE PRECISION DEFAULT 0.0,
    -- Worker that processed this execution.
    worker_id       UUID,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_bl_executions_flow ON bl_flow_executions (flow_id);
CREATE INDEX idx_bl_executions_account ON bl_flow_executions (account_id);
CREATE INDEX idx_bl_executions_status ON bl_flow_executions (status);
CREATE INDEX idx_bl_executions_started ON bl_flow_executions (started_at DESC);

-- ============================================================================
-- Node Type Registry
-- ============================================================================

CREATE TABLE IF NOT EXISTS bl_node_types (
    id              TEXT PRIMARY KEY,  -- e.g., "core:http_request", "wasm:slack_notify"
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'utility',
    tier            TEXT NOT NULL DEFAULT 'core'
                    CHECK (tier IN ('core', 'wasm', 'external')),
    -- Input/output port definitions.
    inputs          JSONB NOT NULL DEFAULT '[]',
    outputs         JSONB NOT NULL DEFAULT '[]',
    -- JSON Schema for node configuration panel in the visual editor.
    config_schema   JSONB NOT NULL DEFAULT '{}',
    -- For WASM nodes: reference to the .wasm binary.
    wasm_module_id  UUID,
    -- For external nodes: service URL.
    external_url    TEXT,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bl_node_types_category ON bl_node_types (category);
CREATE INDEX idx_bl_node_types_tier ON bl_node_types (tier);

-- ============================================================================
-- WASM Plugin Storage
-- ============================================================================

CREATE TABLE IF NOT EXISTS bl_wasm_modules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    version         TEXT NOT NULL DEFAULT '0.1.0',
    -- Binary stored as bytea (for small modules) or S3 reference.
    wasm_bytes      BYTEA,
    s3_key          TEXT,
    -- SHA-256 hash for integrity verification.
    hash            TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    account_id      UUID NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Seed Core Node Types
-- ============================================================================

INSERT INTO bl_node_types (id, name, description, category, tier, inputs, outputs, config_schema)
VALUES
    ('core:noop', 'No-op', 'Passes input data through unchanged.', 'utility', 'core',
     '[{"name":"input","data_type":"any","required":false}]',
     '[{"name":"output","data_type":"any","required":true}]',
     '{"type":"object","properties":{}}'
    ),
    ('core:http_request', 'HTTP Request', 'Makes HTTP requests to external services.', 'integration', 'core',
     '[{"name":"input","data_type":"object","required":false}]',
     '[{"name":"output","data_type":"object","required":true}]',
     '{"type":"object","properties":{"url":{"type":"string"},"method":{"type":"string","enum":["GET","POST","PUT","DELETE","PATCH"],"default":"GET"},"headers":{"type":"object"},"body":{},"timeout_ms":{"type":"number","default":30000}},"required":["url"]}'
    ),
    ('core:transform', 'Transform', 'Maps input data to output using expressions.', 'data', 'core',
     '[{"name":"input","data_type":"any","required":false}]',
     '[{"name":"output","data_type":"object","required":true}]',
     '{"type":"object","properties":{"mapping":{"type":"object"}},"required":["mapping"]}'
    ),
    ('core:condition', 'Condition', 'Routes flow based on a condition expression.', 'logic', 'core',
     '[{"name":"input","data_type":"any","required":false}]',
     '[{"name":"output","data_type":"object","required":true}]',
     '{"type":"object","properties":{"condition":{"type":"string"},"then_value":{},"else_value":{}},"required":["condition","then_value","else_value"]}'
    ),
    ('core:formula_eval', 'Formula', 'Evaluate a single Excel formula against input data.', 'data', 'core',
     '[{"name":"input","data_type":"any","required":false}]',
     '[{"name":"output","data_type":"any","required":true}]',
     '{"type":"object","properties":{"formula":{"type":"string"},"data":{},"locale":{"type":"string","default":"enUS"}},"required":["formula"]}'
    ),
    ('core:calculator', 'Calculator', 'Spreadsheet-style multi-cell evaluation with formulas.', 'data', 'core',
     '[{"name":"input","data_type":"any","required":false}]',
     '[{"name":"output","data_type":"object","required":true}]',
     '{"type":"object","properties":{"sheets":{"type":"object"},"formulas":{"type":"array"},"output_cells":{"type":"object"},"locale":{"type":"string","default":"enUS"}},"required":["formulas"]}'
    )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Trigger: auto-update updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION bl_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bl_flows_updated
    BEFORE UPDATE ON bl_flows
    FOR EACH ROW
    EXECUTE FUNCTION bl_update_timestamp();

-- ============================================================================
-- Redis Stream Consumer Groups (run via application startup, not SQL)
-- ============================================================================
-- These must be created at runtime:
--   XGROUP CREATE flow:execute:critical workers 0 MKSTREAM
--   XGROUP CREATE flow:execute:normal workers 0 MKSTREAM
--   XGROUP CREATE flow:execute:batch workers 0 MKSTREAM
