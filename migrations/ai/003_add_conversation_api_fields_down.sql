-- Rollback: 003_add_conversation_api_fields
-- Removes API key tracking and external correlation fields

DROP INDEX IF EXISTS idx_ai_conversations_external_id;
DROP INDEX IF EXISTS idx_ai_conversations_api_key_id;

ALTER TABLE ai_conversations DROP COLUMN IF EXISTS source;
ALTER TABLE ai_conversations DROP COLUMN IF EXISTS external_id;
ALTER TABLE ai_conversations DROP COLUMN IF EXISTS api_key_id;
