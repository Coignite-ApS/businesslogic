-- Migration: Parent-document retrieval — kb_sections table + per-KB feature toggles

CREATE TABLE IF NOT EXISTS kb_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
    knowledge_base UUID NOT NULL,
    section_index INT NOT NULL,
    heading TEXT,
    content TEXT NOT NULL,
    token_count INT,
    date_created TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_sections_document ON kb_sections(document);

-- Parent-doc FK on chunks
ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES kb_sections(id) ON DELETE SET NULL;

-- Per-KB feature toggles
ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS contextual_retrieval_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS parent_doc_enabled BOOLEAN DEFAULT FALSE;
