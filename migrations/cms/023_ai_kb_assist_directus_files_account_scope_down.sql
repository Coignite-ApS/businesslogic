-- 023_ai_kb_assist_directus_files_account_scope_down.sql
--
-- Reverts 023: restores empty filter {} on directus_files read under the
-- AI KB Assistance policy.
--
-- WARNING: re-opens cross-account directus_files read leak. Only use when
-- specifically rolling back task 38.

UPDATE directus_permissions
SET permissions = '{}'::json
WHERE id = 134
  AND policy = '36a579f9-1066-401b-8c43-40d767ea2132';
