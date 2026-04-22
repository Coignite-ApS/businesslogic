-- 021_ai_kb_assist_knowledge_bases_create_down.sql
--
-- Reverts 021: restores empty create-validation filter {} on knowledge_bases
-- under the AI KB Assistance policy.
--
-- WARNING: re-opens cross-account create leak. Only use when specifically
-- rolling back task 38.

UPDATE directus_permissions
SET permissions = '{}'::json
WHERE id = 126
  AND policy = '36a579f9-1066-401b-8c43-40d767ea2132';
