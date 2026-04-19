-- 019_ai_token_usage_kb_assist_permission.sql
--
-- Task 36 — Close cross-account data leak on ai_token_usage read.
--
-- Context:
--   The Directus permission row for collection=ai_token_usage, action=read,
--   policy='AI KB Assistance' (id 36a579f9-1066-401b-8c43-40d767ea2132) has
--   an empty filter ({}), allowing any user holding that policy to read
--   token-usage rows from every account.
--
--   The FK column on ai_token_usage is `account` (NOT `account_id`).
--
-- Change:
--   Replace {} with {"account": {"_eq": "$CURRENT_USER.active_account"}}.
--
-- Reversibility:
--   Paired _down restores {}.
--
-- Idempotency:
--   WHERE clause guards against re-applying; running twice is a no-op.

UPDATE directus_permissions
SET permissions = '{"account": {"_eq": "$CURRENT_USER.active_account"}}'::json
WHERE collection = 'ai_token_usage'
  AND action = 'read'
  AND policy = '36a579f9-1066-401b-8c43-40d767ea2132'
  AND (permissions IS NULL OR permissions::text = '{}');

-- Assert: exactly one row should now carry the account filter for this policy.
-- Compare via jsonb canonicalization so whitespace differences don't trip the check.
DO $$
DECLARE
  hit INTEGER;
BEGIN
  SELECT COUNT(*) INTO hit
  FROM directus_permissions
  WHERE collection = 'ai_token_usage'
    AND action = 'read'
    AND policy = '36a579f9-1066-401b-8c43-40d767ea2132'
    AND permissions::jsonb = '{"account":{"_eq":"$CURRENT_USER.active_account"}}'::jsonb;
  IF hit <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 ai_token_usage KB Assist read permission with account filter, found %', hit;
  END IF;
END$$;
