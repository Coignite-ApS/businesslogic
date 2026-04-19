-- 022_ai_kb_assist_account_self_read.sql
--
-- Task 38 — Close cross-account leak on `account` read under the AI KB
-- Assistance policy.
--
-- Context:
--   directus_permissions.id=131 allows reading every row in the `account`
--   table for any user holding AI KB Assistance. This leaks other tenants'
--   account metadata (names, settings). Tighten so a user sees only their
--   OWN active account.
--
-- Change:
--   id=131  account  read  → {"id":{"_eq":"$CURRENT_USER.active_account"}}
--
--   Filter is on the primary key (`id`) rather than a FK column — the
--   `account` table IS the identity table; its PK is what active_account
--   points at.
--
-- Reversibility:
--   Paired _down restores {}.
--
-- Idempotency:
--   WHERE clause guards against re-applying.

UPDATE directus_permissions
SET permissions = '{"id": {"_eq": "$CURRENT_USER.active_account"}}'::json
WHERE id = 131
  AND collection = 'account'
  AND action = 'read'
  AND policy = '36a579f9-1066-401b-8c43-40d767ea2132'
  AND (permissions IS NULL OR permissions::text = '{}');

DO $$
DECLARE
  hit INTEGER;
BEGIN
  SELECT COUNT(*) INTO hit
  FROM directus_permissions
  WHERE id = 131
    AND permissions::jsonb = '{"id":{"_eq":"$CURRENT_USER.active_account"}}'::jsonb;
  IF hit <> 1 THEN
    RAISE EXCEPTION '022: expected id=131 (account read) to carry id filter, found % matching row(s)', hit;
  END IF;
END$$;
