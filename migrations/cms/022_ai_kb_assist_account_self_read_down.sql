-- 022_ai_kb_assist_account_self_read_down.sql
--
-- Reverts 022: restores empty filter {} on account read under the
-- AI KB Assistance policy.
--
-- WARNING: re-opens cross-tenant account-metadata leak. Only use when
-- specifically rolling back task 38.

UPDATE directus_permissions
SET permissions = '{}'::json
WHERE id = 131
  AND policy = '36a579f9-1066-401b-8c43-40d767ea2132';
