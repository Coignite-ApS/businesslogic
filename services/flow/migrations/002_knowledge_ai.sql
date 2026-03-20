-- BusinessLogic Flow Engine — Phase 3: Knowledge Base + AI
-- Adds pgvector, knowledge bases, document/chunk storage, and account budgets.

-- ============================================================================
-- Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- Knowledge Bases
-- ============================================================================

CREATE TABLE bl_knowledge_bases (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id      UUID NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    embedding_model TEXT NOT NULL DEFAULT 'BAAI/bge-small-en-v1.5',
    dimensions      INTEGER NOT NULL DEFAULT 384,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'disabled', 'building')),
    chunks_count    INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bl_kb_account ON bl_knowledge_bases (account_id);

-- ============================================================================
-- Folder Hierarchy (materialized path for retrieval scoping)
-- ============================================================================

CREATE TABLE bl_kb_folders (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    knowledge_base_id   UUID NOT NULL REFERENCES bl_knowledge_bases(id) ON DELETE CASCADE,
    parent_id           UUID REFERENCES bl_kb_folders(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    path                TEXT NOT NULL,  -- e.g. "/reports/2026/q1"
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (knowledge_base_id, path)
);

-- ============================================================================
-- Documents
-- ============================================================================

CREATE TABLE bl_kb_documents (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    knowledge_base_id   UUID NOT NULL REFERENCES bl_knowledge_bases(id) ON DELETE CASCADE,
    folder_id           UUID REFERENCES bl_kb_folders(id) ON DELETE SET NULL,
    filename            TEXT NOT NULL,
    file_size           BIGINT,
    file_mime_type      TEXT,
    version_hash        TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'processing'
                        CHECK (status IN ('processing', 'ready', 'error')),
    error_message       TEXT,
    chunks_count        INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (knowledge_base_id, filename, version_hash)
);

-- ============================================================================
-- Document Tags (cross-folder retrieval scoping)
-- ============================================================================

CREATE TABLE bl_kb_document_tags (
    document_id     UUID NOT NULL REFERENCES bl_kb_documents(id) ON DELETE CASCADE,
    tag             TEXT NOT NULL,
    PRIMARY KEY (document_id, tag)
);

CREATE INDEX idx_bl_kb_doc_tags_tag ON bl_kb_document_tags (tag);

-- ============================================================================
-- Chunks (vector embeddings)
-- ============================================================================

CREATE TABLE bl_kb_chunks (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id         UUID NOT NULL REFERENCES bl_kb_documents(id) ON DELETE CASCADE,
    knowledge_base_id   UUID NOT NULL REFERENCES bl_knowledge_bases(id) ON DELETE CASCADE,
    folder_id           UUID,  -- denormalized from document for fast filtered search
    chunk_index         INTEGER NOT NULL,
    content             TEXT NOT NULL,
    embedding           vector(384) NOT NULL,  -- bge-small-en-v1.5 fixed dimensions
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (document_id, chunk_index)
);

-- HNSW for production (best recall at scale).
-- For dev/testing with small datasets, ivfflat is faster to build:
--   CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_bl_kb_chunks_embedding ON bl_kb_chunks
    USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_bl_kb_chunks_kb ON bl_kb_chunks (knowledge_base_id);
CREATE INDEX idx_bl_kb_chunks_folder ON bl_kb_chunks (folder_id);
CREATE INDEX idx_bl_kb_chunks_document ON bl_kb_chunks (document_id);

-- ============================================================================
-- Account Budgets (admin-managed)
-- ============================================================================

CREATE TABLE bl_account_budgets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id      UUID NOT NULL,
    month_year      DATE NOT NULL,
    daily_limit_usd DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    budget_limit_usd DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    spent_usd       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, month_year)
);

CREATE INDEX idx_bl_account_budgets_account ON bl_account_budgets (account_id);

-- ============================================================================
-- Seed AI Node Types
-- ============================================================================

INSERT INTO bl_node_types (id, name, description, category, tier, inputs, outputs, config_schema)
VALUES
    ('core:llm', 'LLM', 'Call an LLM (Anthropic Claude) with a prompt and return the response.', 'ai', 'core',
     '[{"name":"input","data_type":"any","required":false}]',
     '[{"name":"output","data_type":"object","required":true}]',
     '{"type":"object","properties":{"model":{"type":"string","default":"claude-sonnet-4-6"},"prompt":{"type":"string"},"system_prompt":{"type":"string"},"temperature":{"type":"number","default":0.7},"max_tokens":{"type":"integer","default":1000},"timeout_seconds":{"type":"integer","default":30},"fallback_model":{"type":"string"},"api_base_url":{"type":"string"}},"required":["prompt"]}'
    ),
    ('core:embedding', 'Embedding', 'Generate vector embeddings from text using local ONNX model.', 'ai', 'core',
     '[{"name":"input","data_type":"any","required":true}]',
     '[{"name":"output","data_type":"object","required":true}]',
     '{"type":"object","properties":{"model":{"type":"string","default":"BAAI/bge-small-en-v1.5"},"input":{},"batch_size":{"type":"integer","default":256}},"required":["input"]}'
    ),
    ('core:vector_search', 'Vector Search', 'Search knowledge base chunks by vector similarity.', 'ai', 'core',
     '[{"name":"input","data_type":"any","required":true}]',
     '[{"name":"output","data_type":"object","required":true}]',
     '{"type":"object","properties":{"knowledge_base_id":{"type":"string"},"query_embedding":{},"top_k":{"type":"integer","default":5},"similarity_threshold":{"type":"number","default":0.7},"folder_ids":{"type":"array","items":{"type":"string"}},"tags":{"type":"array","items":{"type":"string"}}},"required":["knowledge_base_id","query_embedding"]}'
    )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Auto-update timestamps
-- ============================================================================

CREATE TRIGGER trg_bl_knowledge_bases_updated
    BEFORE UPDATE ON bl_knowledge_bases
    FOR EACH ROW
    EXECUTE FUNCTION bl_update_timestamp();

CREATE TRIGGER trg_bl_kb_documents_updated
    BEFORE UPDATE ON bl_kb_documents
    FOR EACH ROW
    EXECUTE FUNCTION bl_update_timestamp();

CREATE TRIGGER trg_bl_account_budgets_updated
    BEFORE UPDATE ON bl_account_budgets
    FOR EACH ROW
    EXECUTE FUNCTION bl_update_timestamp();
