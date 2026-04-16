-- Rollback: 007_kb_sections_and_parent_doc
-- Removes kb_sections table, section_id from kb_chunks, feature toggles from knowledge_bases

ALTER TABLE knowledge_bases DROP COLUMN IF EXISTS parent_doc_enabled;
ALTER TABLE knowledge_bases DROP COLUMN IF EXISTS contextual_retrieval_enabled;
ALTER TABLE kb_chunks DROP COLUMN IF EXISTS section_id;
DROP INDEX IF EXISTS idx_kb_sections_document;
DROP TABLE IF EXISTS kb_sections;
