-- 023_ai_kb_assist_directus_files_account_scope.sql
--
-- Task 38 — Close cross-account directus_files leak on the AI KB Assistance
-- policy (user-approved option A: account-scoped via uploader's active_account).
--
-- Context:
--   directus_permissions.id=134 grants read on directus_files with {} row
--   filter. Users on AI KB Assistance currently see files uploaded by ANY
--   account. Per user decision (2026-04-19): "managing KB is on account
--   level" → scope files to anyone whose uploader shares my active_account.
--
-- Change:
--   id=134  directus_files  read  → {"uploaded_by":{"active_account":{"_eq":"$CURRENT_USER.active_account"}}}
--
--   This uses a 2-hop relation chain:
--     directus_files.uploaded_by → directus_users.id
--     directus_users.active_account → account.id
--
--   directus_files.uploaded_by is a Directus built-in system field (auto-
--   registered on startup; not in directus_relations but known to the
--   Directus schema). directus_users.active_account is explicitly
--   registered in directus_relations and points to account.id. The filter
--   resolves via Directus' query builder across both hops.
--
--   Semantics: a user in account A sees every file uploaded by a user whose
--   active_account = A. Account isolation holds. Per-user privacy within an
--   account is NOT enforced by this filter (intentional — files are an
--   account-wide resource per user decision).
--
-- CAVEAT (do not apply without a smoke test in Phase 6.5):
--   If Directus fails to resolve the `uploaded_by.active_account` chain for
--   any reason (e.g. system-collection relation not registered for filter
--   traversal), the filter evaluates as "no match" and the user will see
--   ZERO files. Phase 6.5 integrity step must probe a known file's
--   visibility with an account-scoped token to confirm.
--
-- Reversibility:
--   Paired _down restores {}.
--
-- Idempotency:
--   WHERE clause guards against re-applying.

UPDATE directus_permissions
SET permissions = '{"uploaded_by": {"active_account": {"_eq": "$CURRENT_USER.active_account"}}}'::json
WHERE id = 134
  AND collection = 'directus_files'
  AND action = 'read'
  AND policy = '36a579f9-1066-401b-8c43-40d767ea2132'
  AND (permissions IS NULL OR permissions::text = '{}');

DO $$
DECLARE
  hit INTEGER;
BEGIN
  SELECT COUNT(*) INTO hit
  FROM directus_permissions
  WHERE id = 134
    AND permissions::jsonb = '{"uploaded_by":{"active_account":{"_eq":"$CURRENT_USER.active_account"}}}'::jsonb;
  IF hit <> 1 THEN
    RAISE EXCEPTION '023: expected id=134 (directus_files read) to carry uploaded_by.active_account filter, found % matching row(s)', hit;
  END IF;
END$$;
