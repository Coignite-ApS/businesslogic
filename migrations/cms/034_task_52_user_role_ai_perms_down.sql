-- 034_task_52_user_role_ai_perms_down.sql
--
-- Reverts 034: removes the two permission rows granting User Access policy
-- read on ai_prompts and ai_conversations.
--
-- WARNING: running this will re-introduce 403s for User-role users opening
-- the AI Assistant module.

DELETE FROM directus_permissions
WHERE policy = '54f17d5e-e565-47d0-9372-b3b48db16109'
  AND collection IN ('ai_prompts', 'ai_conversations')
  AND action = 'read';
