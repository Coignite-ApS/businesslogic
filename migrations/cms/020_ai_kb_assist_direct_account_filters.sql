-- 020_ai_kb_assist_direct_account_filters.sql
--
-- Task 38 — Close cross-account data leak on 4 AI KB Assistance read permissions.
--
-- Context:
--   Policy '36a579f9-1066-401b-8c43-40d767ea2132' (AI KB Assistance) has {} row
--   filter on 4 collections that carry a direct per-row account FK. Any user
--   holding the policy can currently read rows from every account. Tighten to
--   the standard $CURRENT_USER.active_account filter.
--
--   This migration handles the 4 rows with DIRECT-account filters:
--     id=123  knowledge_bases    read  → {"account":    {"_eq": "$CURRENT_USER.active_account"}}
--     id=124  kb_documents       read  → {"account":    {"_eq": "$CURRENT_USER.active_account"}}
--     id=125  kb_chunks          read  → {"account_id": {"_eq": "$CURRENT_USER.active_account"}}
--     id=127  ai_conversations   read  → {"account":    {"_eq": "$CURRENT_USER.active_account"}}
--
-- FK columns confirmed against live schema (pre-task YAML snapshot +
-- information_schema.columns dump) — kb_chunks uses `account_id` while the
-- other three use `account`; this historical inconsistency is preserved.
--
-- Sibling permissions (021, 022) close the remaining create-side and self-read
-- leaks under the same policy.
--
-- Sibling "legit-global" rows under the same policy — intentionally left as {}:
--   id=129  ai_prompts         read  → shared prompt catalog (global by design)
--   id=130  ai_model_config    read  → shared model config (global by design)
--   id=136  subscription_plans read  → public plan catalog (global by design)
-- These three are NOT changed by this migration. Documented here so future
-- audits don't re-flag them as gaps (task 38 acceptance #3).
--
-- Reversibility:
--   Paired _down restores {} on all 4 rows.
--
-- Idempotency:
--   WHERE clause guards against re-applying; running twice is a no-op.
--
-- Assertion:
--   Uses jsonb canonicalization (whitespace-insensitive). Postgres json type
--   preserves input whitespace which bit Task 36's first apply attempt.

-- 123: knowledge_bases read
UPDATE directus_permissions
SET permissions = '{"account": {"_eq": "$CURRENT_USER.active_account"}}'::json
WHERE id = 123
  AND collection = 'knowledge_bases'
  AND action = 'read'
  AND policy = '36a579f9-1066-401b-8c43-40d767ea2132'
  AND (permissions IS NULL OR permissions::text = '{}');

-- 124: kb_documents read
UPDATE directus_permissions
SET permissions = '{"account": {"_eq": "$CURRENT_USER.active_account"}}'::json
WHERE id = 124
  AND collection = 'kb_documents'
  AND action = 'read'
  AND policy = '36a579f9-1066-401b-8c43-40d767ea2132'
  AND (permissions IS NULL OR permissions::text = '{}');

-- 125: kb_chunks read  (note: account_id, NOT account — pricing-v2 convention)
UPDATE directus_permissions
SET permissions = '{"account_id": {"_eq": "$CURRENT_USER.active_account"}}'::json
WHERE id = 125
  AND collection = 'kb_chunks'
  AND action = 'read'
  AND policy = '36a579f9-1066-401b-8c43-40d767ea2132'
  AND (permissions IS NULL OR permissions::text = '{}');

-- 127: ai_conversations read
UPDATE directus_permissions
SET permissions = '{"account": {"_eq": "$CURRENT_USER.active_account"}}'::json
WHERE id = 127
  AND collection = 'ai_conversations'
  AND action = 'read'
  AND policy = '36a579f9-1066-401b-8c43-40d767ea2132'
  AND (permissions IS NULL OR permissions::text = '{}');

-- Assert: each of the four rows now carries the expected filter.
-- jsonb comparison = whitespace-insensitive.
DO $$
DECLARE
  hit INTEGER;
BEGIN
  SELECT COUNT(*) INTO hit
  FROM directus_permissions
  WHERE id = 123
    AND permissions::jsonb = '{"account":{"_eq":"$CURRENT_USER.active_account"}}'::jsonb;
  IF hit <> 1 THEN
    RAISE EXCEPTION '020: expected id=123 (knowledge_bases read) to carry account filter, found % matching row(s)', hit;
  END IF;

  SELECT COUNT(*) INTO hit
  FROM directus_permissions
  WHERE id = 124
    AND permissions::jsonb = '{"account":{"_eq":"$CURRENT_USER.active_account"}}'::jsonb;
  IF hit <> 1 THEN
    RAISE EXCEPTION '020: expected id=124 (kb_documents read) to carry account filter, found % matching row(s)', hit;
  END IF;

  SELECT COUNT(*) INTO hit
  FROM directus_permissions
  WHERE id = 125
    AND permissions::jsonb = '{"account_id":{"_eq":"$CURRENT_USER.active_account"}}'::jsonb;
  IF hit <> 1 THEN
    RAISE EXCEPTION '020: expected id=125 (kb_chunks read) to carry account_id filter, found % matching row(s)', hit;
  END IF;

  SELECT COUNT(*) INTO hit
  FROM directus_permissions
  WHERE id = 127
    AND permissions::jsonb = '{"account":{"_eq":"$CURRENT_USER.active_account"}}'::jsonb;
  IF hit <> 1 THEN
    RAISE EXCEPTION '020: expected id=127 (ai_conversations read) to carry account filter, found % matching row(s)', hit;
  END IF;
END$$;
