# 22. API Key Management UI

**Service:** cms
**Status:** planned
**Depends on:** GW-02 (API Key Management Endpoints)

---

## Goal

Replace the per-calculator formula token UI with a full API key management interface. Users create account-level API keys with fine-grained resource permissions (per-calculator, per-KB).

---

## Key Tasks

- [ ] New Directus module: `project-extension-api-keys`
- [ ] List view: all API keys for current account (name, status, created, last used)
- [ ] Create dialog: name, select resources + actions via resource picker
- [ ] Resource picker component: tree of calculators/KBs with action checkboxes
- [ ] Key detail view: edit name, permissions; rotate; revoke
- [ ] Show raw key only once on creation (copy-to-clipboard)
- [ ] Masked key display after creation (last 4 chars visible)
- [ ] Rotate flow: confirm dialog, show new key, warn about 24h grace
- [ ] Revoke flow: confirm dialog, immediate effect
- [ ] Deprecation banner on old formula token UI → points to new key mgmt
- [ ] Unit tests for resource picker component
- [ ] E2E test: create key → use key → revoke key

---

## Key Files

- `services/cms/extensions/local/project-extension-api-keys/` (new module)
- `services/cms/extensions/local/project-extension-account/` (add link)
