-- 035_task_52_account_subscriptions_ghost_field_down.sql
--
-- Reverts 035: re-creates the account.subscriptions o2m alias field with
-- the same shape as before deletion.
--
-- NOTE: the original id=109 is NOT preserved (sequence re-assigns). The
-- previous row's full shape (captured pre-delete from directus_fields):
--   collection=account, field=subscriptions, special=o2m, interface=list-o2m,
--   readonly=false, hidden=false, sort=10, width=full, searchable=true,
--   required=false, all other columns NULL.
--
-- WARNING: restoring this field without also re-adding the matching
-- directus_relations row will re-introduce the crash described in Task 52.3.
-- Only use this _down to roll back the migration for forensic/testing
-- purposes — not for production recovery.

INSERT INTO directus_fields (
  collection, field, special, interface, readonly, hidden, sort, width, searchable, required
) VALUES (
  'account', 'subscriptions', 'o2m', 'list-o2m', false, false, 10, 'full', true, false
)
ON CONFLICT DO NOTHING;
