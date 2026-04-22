-- 035_task_52_account_subscriptions_ghost_field.sql
--
-- Task 52.3 — Remove the ghost `account.subscriptions` alias field from
-- directus_fields.
--
-- Context:
--   directus_fields id=109 declares `account.subscriptions` as an o2m alias
--   (interface list-o2m, special o2m). For an o2m alias to render, Directus
--   expects a matching row in directus_relations with
--     many_collection = 'subscriptions', many_field = <FK col>,
--     one_collection  = 'account',        one_field  = 'subscriptions'.
--   No such row exists (verified against directus_relations at apply time).
--
--   The legacy relation was created pre-Sprint-1 (task 18) when the
--   subscriptions table used a different FK shape. When subscriptions was
--   restructured to its current shape (subscriptions.account_id NOT NULL,
--   per migration 005_pricing_v2_subscriptions.sql), the directus_relations
--   row was dropped but the alias field was orphaned. Directus now crashes
--   trying to render the relation for new accounts (ux test 2026-04-20).
--
-- Downstream usage audit (Phase 4.5 Step C):
--   Grepped services/, packages/, migrations/, services/cms/extensions/ for
--   `account.subscriptions`, `account[.subscriptions.]`, and `.subscriptions\b`.
--   Zero hits reference the Directus relational field. Hits all reference:
--     - public.subscriptions table directly (SQL/knex) — unaffected
--     - stripe.subscriptions SDK API — unaffected
--     - overview.subscriptions property on an admin dashboard object — unaffected
--   No extension, service, or UI reads the `account.subscriptions` alias.
--   Safe to remove.
--
-- Alternatives considered:
--   Option A: add a matching directus_relations row pointing to
--     subscriptions.account_id. Rejected because no caller needs the relation —
--     adding it back would be cargo-cult; current account-management UIs
--     navigate via subscriptions.account_id directly or via the Admin
--     dashboard's aggregate endpoints.
--   Option B (chosen): delete the orphaned alias field. Removes the crash and
--     leaves schema consistent.
--
-- Reversibility:
--   Paired _down re-creates the field row with the same shape (id will be
--   re-assigned by the sequence — id 109 is not preserved).
--
-- Idempotency:
--   WHERE clause allows re-apply as a no-op.
--
-- Assertion:
--   Post-delete: zero rows remain for (collection='account', field='subscriptions').

DELETE FROM directus_fields
WHERE collection = 'account'
  AND field = 'subscriptions'
  AND special = 'o2m';

-- Assert removal
DO $$
DECLARE
  hit INTEGER;
BEGIN
  SELECT COUNT(*) INTO hit
  FROM directus_fields
  WHERE collection = 'account'
    AND field = 'subscriptions';
  IF hit <> 0 THEN
    RAISE EXCEPTION '035: expected 0 account.subscriptions field rows, found %', hit;
  END IF;
END$$;
