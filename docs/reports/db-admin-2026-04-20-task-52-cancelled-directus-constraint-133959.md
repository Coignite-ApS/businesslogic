# DB Admin Report — Task 52.2 + 52.3 — Directus-constraint pivot

**Date:** 2026-04-20  
**Slug:** task-52-user-perms-plus-account-field  
**Status:** 52.2 DONE (API-applied) | 52.3 CANCELLED (directus_* constraint)

---

## Constraint surfaced

User rule: **no raw SQL migrations touching `directus_*` system tables**.

Both staged migrations violated this:
- `034_task_52_user_role_ai_perms.sql` — INSERTs into `directus_permissions`
- `035_task_52_account_subscriptions_ghost_field.sql` — DELETE from `directus_fields`

Migration 034 was already staged/unapplied (after the protocol-violation rollback documented in the WIP file).

---

## DB baseline (confirmed pre-this-session)

| Check | Expected | Actual |
|-------|----------|--------|
| User Access × ai_prompts × read rows | 0 | 0 ✓ |
| User Access × ai_conversations × read rows | 0 | 0 ✓ |
| directus_fields account.subscriptions (id=109) | 1 (present) | 1 (present) ✓ |

Confirmed via Directus API GET /permissions before any changes this session.

---

## Task 52.3 — CANCELLED

**Reason:** fix requires `DELETE FROM directus_fields` — raw SQL against a Directus system table.

**Action taken:**
- `migrations/cms/035_task_52_account_subscriptions_ghost_field.sql` → renamed to `migrations/cms/dryrun_cancelled_035_task_52_account_subscriptions_ghost_field.sql`
- `migrations/cms/035_task_52_account_subscriptions_ghost_field_down.sql` → renamed to `migrations/cms/dryrun_cancelled_035_task_52_account_subscriptions_ghost_field_down.sql`

Files are NOT deleted — kept for forensic reference and for use if the constraint is ever lifted.

**The ghost field (directus_fields id=109, `account.subscriptions`, special=o2m) remains in DB.**

### Manual admin-UI path (actionable for user)

To fix 52.3 without raw SQL:

1. Log into Directus admin UI → **Settings** → **Data Model**
2. Find the **`account`** collection
3. Locate the **`subscriptions`** field (type: One to Many, orphaned — no relation)
4. Click the field → **Delete field**
5. Confirm deletion

This removes `directus_fields` id=109 through the Directus service layer (correct abstraction — same effect as migration 035, zero data loss, idempotent).

**Note:** The down-migration (`dryrun_cancelled_035_*_down.sql`) documents how to restore the row if ever needed (though re-inserting an orphaned alias field re-introduces the crash — it exists only for forensic completeness).

---

## Task 52.2 — DONE (API-applied)

**Approach:** Directus HTTP API (POST `/permissions`) — writes through the service layer, not raw SQL.

**Why this satisfies the constraint:** The rule is "no raw SQL migrations against directus_*". Writing via the Directus API is the idiomatic management path — same as clicking "Save" in the admin UI Access Control panel. The API goes through Directus's action-hook pipeline.

### Applied rows

| ID | Policy | Collection | Action | Permissions filter |
|----|--------|-----------|--------|-------------------|
| 163 | User Access (54f17d5e-…) | ai_prompts | read | `{}` (global catalog, no row filter) |
| 164 | User Access (54f17d5e-…) | ai_conversations | read | `{"account":{"_eq":"$CURRENT_USER.active_account"}}` |

### Design rationale (preserved from WIP)

- `ai_prompts`: shared prompt catalog (no `account_id` column). All rows are `status=published`. The proxy layer (`project-extension-ai-api/src/index.ts:175`) already filters by status. No row-level filter needed at permission layer. Matches the shape of User Access row 135 (`subscription_plans`, also global catalog).
- `ai_conversations`: per-account chat history. Column is `account` (NOT `account_id`) — historical inconsistency preserved. Filter matches Task 38 migration 020 row 127 shape under AI KB Assistance policy.

### Exact API calls (for prod re-application)

```bash
# Auth
TOKEN=$(curl -s -X POST https://<CMS_HOST>/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<ADMIN_EMAIL>","password":"<ADMIN_PASSWORD>"}' \
  | jq -r '.data.access_token')

# Row 1: ai_prompts read (global)
curl -X POST https://<CMS_HOST>/permissions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "policy": "54f17d5e-e565-47d0-9372-b3b48db16109",
    "collection": "ai_prompts",
    "action": "read",
    "permissions": {},
    "validation": null,
    "presets": null,
    "fields": ["*"]
  }'

# Row 2: ai_conversations read (account-scoped)
curl -X POST https://<CMS_HOST>/permissions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "policy": "54f17d5e-e565-47d0-9372-b3b48db16109",
    "collection": "ai_conversations",
    "action": "read",
    "permissions": {"account": {"_eq": "$CURRENT_USER.active_account"}},
    "validation": null,
    "presets": null,
    "fields": ["*"]
  }'
```

**Idempotency warning:** The API does NOT enforce uniqueness on (policy, collection, action). Re-running blindly will create duplicate rows. Before re-applying on prod, check:

```bash
curl "https://<CMS_HOST>/permissions?filter[policy][_eq]=54f17d5e-e565-47d0-9372-b3b48db16109&filter[collection][_in][0]=ai_prompts&filter[collection][_in][1]=ai_conversations&filter[action][_eq]=read" \
  -H "Authorization: Bearer $TOKEN"
# Should return 0 data rows before applying; if already 2, skip.
```

### Post-apply verification (dev)

Confirmed via API:
- `id=163`: collection=ai_prompts, permissions=`{}`
- `id=164`: collection=ai_conversations, permissions=`{"account":{"_eq":"$CURRENT_USER.active_account"}}`

### Migration file status

- `migrations/cms/034_task_52_user_role_ai_perms.sql` — **UNAPPLIED, NOT CANCELLED** — kept for reference/documentation of the exact logic. Do NOT run against a DB where the API calls above have already been applied.
- `migrations/cms/034_task_52_user_role_ai_perms_down.sql` — paired rollback (DELETE the two rows by policy+collection+action signature). Can be run via psql if a rollback is needed, but note: raw SQL against directus_permissions — only use if approved under the constraint exception.

---

## Files changed this session

| File | Action |
|------|--------|
| `migrations/cms/035_task_52_account_subscriptions_ghost_field.sql` | Renamed → `dryrun_cancelled_035_*` |
| `migrations/cms/035_task_52_account_subscriptions_ghost_field_down.sql` | Renamed → `dryrun_cancelled_035_*_down` |
| `docs/tasks/cross-cutting/52-ux-test-p1-cleanup-bundle.md` | Updated 52.2 ✓ + 52.3 cancelled note |
| `docs/reports/db-admin-WIP-task-52-user-perms-plus-account-field.md` | Left as-is (historical WIP record) |
| Directus DB: `directus_permissions` | +2 rows (ids 163, 164) via HTTP API |

---

## Prior art note

WIP file at `docs/reports/db-admin-WIP-task-52-user-perms-plus-account-field.md` contains full Phase 1–5 research including the protocol-violation record (accidental psql apply + rollback of 034). That record stands as-is; net DB effect was zero before this session started.

---

## Next steps

1. **52.3 manual fix (user action):** Follow the admin-UI steps above (Settings → Data Model → account → delete `subscriptions` field).
2. **Prod deploy of 52.2:** Run the two `curl` commands above against the live CMS after checking for pre-existing rows.
3. **browser-qa:** Verify non-admin user can open AI Assistant without 403s (`/browser-qa cms/52`).
4. **Task 52:** Mark complete once 52.3 admin-UI fix + browser-qa pass.
