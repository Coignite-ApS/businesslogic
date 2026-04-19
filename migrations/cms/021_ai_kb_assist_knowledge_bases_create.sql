-- 021_ai_kb_assist_knowledge_bases_create.sql
--
-- Task 38 — Close cross-account create leak on knowledge_bases under the
-- AI KB Assistance policy.
--
-- Context:
--   directus_permissions.id=126 grants CREATE on knowledge_bases with {} as
--   the validation filter, meaning any payload is accepted regardless of the
--   `account` value. A user on the AI KB Assistance policy could create a
--   knowledge_bases row bound to a different account.
--
-- Change:
--   id=126  knowledge_bases  create  → {"account":{"_eq":"$CURRENT_USER.active_account"}}
--
--   On CREATE actions Directus evaluates the filter as a VALIDATION rule:
--   the submitted row must satisfy the filter or the insert is rejected.
--   With this filter, any create attempt where `account` is missing or
--   differs from the user's active_account is blocked.
--
-- Reversibility:
--   Paired _down restores {}.
--
-- Idempotency:
--   WHERE clause guards against re-applying.

UPDATE directus_permissions
SET permissions = '{"account": {"_eq": "$CURRENT_USER.active_account"}}'::json
WHERE id = 126
  AND collection = 'knowledge_bases'
  AND action = 'create'
  AND policy = '36a579f9-1066-401b-8c43-40d767ea2132'
  AND (permissions IS NULL OR permissions::text = '{}');

DO $$
DECLARE
  hit INTEGER;
BEGIN
  SELECT COUNT(*) INTO hit
  FROM directus_permissions
  WHERE id = 126
    AND permissions::jsonb = '{"account":{"_eq":"$CURRENT_USER.active_account"}}'::jsonb;
  IF hit <> 1 THEN
    RAISE EXCEPTION '021: expected id=126 (knowledge_bases create) to carry account filter, found % matching row(s)', hit;
  END IF;
END$$;
