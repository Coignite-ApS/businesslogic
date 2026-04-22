-- 034_task_52_user_role_ai_perms.sql
--
-- Task 52.2 — Grant User Access policy read on ai_prompts and ai_conversations.
--
-- Context:
--   Non-admin users (role "User") currently hit 403s from the AI Assistant
--   module because their policy ("User Access", id=54f17d5e-e565-47d0-9372-b3b48db16109)
--   has NO permission rows for ai_prompts or ai_conversations. The AI Assistant
--   loads both collections on module open:
--     - ai_prompts: shared prompt catalog (global by design — mirrors Task 38's
--       inline rationale for AI KB Assistance policy row 129). See also the
--       identical shape of User Access row 135 (subscription_plans) which uses
--       an empty filter {} for its public catalog. The extension's proxy layer
--       (services/cms/extensions/local/project-extension-ai-api/src/index.ts
--       line 175) already restricts the read to status=published — no row-level
--       filter is needed at the permission layer.
--     - ai_conversations: per-account chat history. Column is `account` (NOT
--       `account_id`) — matches Task 38 migration 020's row 127 shape under
--       the AI KB Assistance policy.
--
-- Scope:
--   READ only. Create/update/delete of conversations routes through bl-ai-api
--   in production (AI_SERVICE_ENABLED=true) which owns the stamping of the
--   `account` FK. Local dev fallback to the CMS ItemsService proxy path is a
--   known limitation for non-admin users — tracked separately if needed.
--
-- Reversibility:
--   Paired _down deletes the two new permission rows by their unique
--   (policy, collection, action) signature.
--
-- Idempotency:
--   ON CONFLICT DO NOTHING via explicit pre-check — the (policy, collection,
--   action) triple is unique enough for safe re-apply. We query before insert.
--
-- Assertion:
--   Post-insert count check: exactly 1 row must exist per (policy, collection,
--   action) tuple.

DO $$
DECLARE
  user_access_policy CONSTANT uuid := '54f17d5e-e565-47d0-9372-b3b48db16109';
  existing_prompts INTEGER;
  existing_convs INTEGER;
BEGIN
  -- Guard against re-apply: skip insert if row already exists
  SELECT COUNT(*) INTO existing_prompts
  FROM directus_permissions
  WHERE policy = user_access_policy
    AND collection = 'ai_prompts'
    AND action = 'read';

  IF existing_prompts = 0 THEN
    INSERT INTO directus_permissions (policy, collection, action, permissions, validation, presets, fields)
    VALUES (
      user_access_policy,
      'ai_prompts',
      'read',
      '{}'::json,      -- no row filter: shared prompt catalog (global)
      NULL,
      NULL,
      '*'
    );
  END IF;

  SELECT COUNT(*) INTO existing_convs
  FROM directus_permissions
  WHERE policy = user_access_policy
    AND collection = 'ai_conversations'
    AND action = 'read';

  IF existing_convs = 0 THEN
    INSERT INTO directus_permissions (policy, collection, action, permissions, validation, presets, fields)
    VALUES (
      user_access_policy,
      'ai_conversations',
      'read',
      '{"account":{"_eq":"$CURRENT_USER.active_account"}}'::json,
      NULL,
      NULL,
      '*'
    );
  END IF;
END$$;

-- Assert: both rows exist with the expected filter shape.
DO $$
DECLARE
  user_access_policy CONSTANT uuid := '54f17d5e-e565-47d0-9372-b3b48db16109';
  hit INTEGER;
BEGIN
  -- ai_prompts — must be global {} (shared catalog)
  SELECT COUNT(*) INTO hit
  FROM directus_permissions
  WHERE policy = user_access_policy
    AND collection = 'ai_prompts'
    AND action = 'read'
    AND permissions::jsonb = '{}'::jsonb;
  IF hit <> 1 THEN
    RAISE EXCEPTION '034: expected 1 ai_prompts read row with {} filter under User Access, found %', hit;
  END IF;

  -- ai_conversations — must be account-scoped
  SELECT COUNT(*) INTO hit
  FROM directus_permissions
  WHERE policy = user_access_policy
    AND collection = 'ai_conversations'
    AND action = 'read'
    AND permissions::jsonb = '{"account":{"_eq":"$CURRENT_USER.active_account"}}'::jsonb;
  IF hit <> 1 THEN
    RAISE EXCEPTION '034: expected 1 ai_conversations read row with account filter under User Access, found %', hit;
  END IF;
END$$;
