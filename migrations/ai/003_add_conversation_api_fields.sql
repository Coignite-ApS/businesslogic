-- Migration: Add API key tracking and external correlation fields to ai_conversations
-- Enables public API key isolation, external session correlation, and source tracking

ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS api_key_id VARCHAR(255);
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'cms';

-- Index for API key conversation scoping (API key A can't see API key B's conversations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_conversations_api_key_id
ON ai_conversations (api_key_id) WHERE api_key_id IS NOT NULL;

-- Index for external_id lookup (resume conversation by external session ID)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_conversations_external_id
ON ai_conversations (account, external_id) WHERE external_id IS NOT NULL;
