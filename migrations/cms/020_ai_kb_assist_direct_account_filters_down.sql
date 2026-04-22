-- 020_ai_kb_assist_direct_account_filters_down.sql
--
-- Reverts 020: restores empty filter {} on knowledge_bases, kb_documents,
-- kb_chunks, ai_conversations read permissions under the AI KB Assistance
-- policy.
--
-- WARNING: running this re-opens the cross-account data leak on all four
-- collections. Only use when specifically rolling back task 38.

UPDATE directus_permissions
SET permissions = '{}'::json
WHERE id IN (123, 124, 125, 127)
  AND policy = '36a579f9-1066-401b-8c43-40d767ea2132';
