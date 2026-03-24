# 22. API Key Management UI

**Service:** cms
**Status:** completed
**Depends on:** GW-02 (API Key Management Endpoints)

---

## Goal

Replace the per-calculator formula token UI with a full API key management interface. Users create account-level API keys with fine-grained resource permissions (per-calculator, per-KB).

---

## Current State

Basic CRUD is already implemented in `project-extension-account`:
- List keys (name, prefix, environment, created)
- Create key (name + environment selector)
- Rotate key (generates new key, revokes old)
- Revoke key
- Raw key shown once on creation with copy button
- Legacy formula tokens shown with deprecation label

**Missing:** resource-level permissions. Keys are created with hardcoded blanket permissions (`module.vue:345`). No UI to select which calculators/KBs the key can access.

---

## Key Tasks

- [x] List view: all API keys for current account (name, status, created, last used)
- [x] Create flow: name + environment, returns raw key once
- [x] Show raw key only once on creation (copy-to-clipboard)
- [x] Rotate flow: new key generated, old revoked
- [x] Revoke flow: immediate soft delete
- [x] Deprecation banner on old formula token UI
- [x] Resource picker component: tree of account's calculators with action checkboxes (execute, describe)
- [x] KB picker: list of account's knowledge bases with action checkboxes (search, ask)
- [x] Wire resource picker into create flow — send permissions to gateway
- [x] Key detail/edit view: show current permissions, allow editing
- [x] Permissions display in key list (e.g. "3 calculators, 1 KB" summary)
- [x] Wildcard option: "All calculators" / "All KBs" toggle
- [x] Unit tests for resource picker component (14 tests in permissions.test.ts)

---

## Key Files

- `services/cms/extensions/local/project-extension-account/src/routes/module.vue` — existing key UI
- `services/cms/extensions/local/project-extension-account/src/composables/use-account.ts` — API calls
- `services/gateway/internal/handler/apikeys.go` — gateway CRUD (already supports permissions JSONB)
- `services/gateway/internal/service/permissions.go` — ResourcePermissions model

## Design Notes

- Gateway already stores and enforces `permissions` JSONB with per-resource grants
- Current hardcoded permissions at `module.vue:345`: `{ services: { calc: { enabled: true, resources: [], actions: ['execute', 'describe'] } } }`
- Resource picker needs to fetch calculators from CMS (`calculators` collection) and KBs from AI schema (`knowledge_bases`)
- Empty `resources: []` currently means no resource-level restriction — gateway treats it as "all resources"
