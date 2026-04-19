-- 019_ai_token_usage_kb_assist_permission_down.sql
--
-- Reverts 019: restore empty filter {} on ai_token_usage read permission
-- for the AI KB Assistance policy.
--
-- WARNING: running this re-opens the cross-account data leak. Only use
-- when specifically rolling back task 36.

UPDATE directus_permissions
SET permissions = '{}'::json
WHERE collection = 'ai_token_usage'
  AND action = 'read'
  AND policy = '36a579f9-1066-401b-8c43-40d767ea2132';
