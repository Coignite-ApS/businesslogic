# #28 Cloud File Sync

**Status:** planned
**Phase:** 4 — Calculator Authoring
**Source:** [cloud-sync-directus-extension.md](~/Downloads/cloud-sync-directus-extension.md) (v2.0, March 2026)

## Goal

Let users connect an Excel file from Google Drive, OneDrive, Dropbox, or Box to a calculator. Once connected, a **Sync** button replaces Upload — pulling the latest version from cloud, re-parsing formulas, and updating the config. No re-upload needed.

## Why This Matters

Power users iterate on Excel models frequently. Today they must re-upload manually each time. Cloud sync eliminates that friction and keeps calculators in sync with the source of truth.

## Architecture

**Bundle extension:** interface (Vue 3) + endpoint (Node.js), but integrated into our **existing custom upload component** (`calculator-detail.vue` / `module.vue`), NOT as a standalone Directus file interface.

**External dependency:** [Uppy Companion](https://uppy.io/docs/companion/) server — handles OAuth token exchange and file streaming from cloud providers. Runs as a separate Docker service.

### Key Difference from Spec

The source spec proposes a generic Directus interface extension. Our upload is a custom component that also triggers Formula API parsing (`/parse/xlsx`). Cloud sync must:

1. Download file from cloud via Companion
2. Overwrite the existing Directus file
3. **Re-parse via Formula API** (sheets, formulas, expressions, profile)
4. Update calculator config with new parse results + increment `file_version`

### Data Flow — Sync

```
User clicks "Sync Now"
  → POST /cloud-sync/sync { connectionId }
  → Endpoint decrypts OAuth token, downloads file via Companion
  → Overwrites directus_files entry
  → Returns file buffer
  → Frontend calls /parse/xlsx with buffer
  → Frontend updates calculator_configs (sheets, formulas, file_version++)
```

## Data Model

### Collection: `cloud_connections`

| Field | Type | Notes |
|---|---|---|
| id | UUID (PK) | Auto |
| account | M2O → accounts | **Account-scoped** (mandatory) |
| provider | String | `google_drive`, `onedrive`, `dropbox`, `box` |
| provider_file_id | String | File ID in cloud provider |
| provider_file_name | String | Original filename |
| provider_mime_type | String | MIME type |
| access_token | Text | AES-256-GCM encrypted |
| refresh_token | Text | AES-256-GCM encrypted |
| token_expires_at | Timestamp | For proactive refresh |
| directus_file_id | M2O → directus_files | Synced file |
| target_collection | String | e.g. `calculator_configs` |
| target_field | String | e.g. `excel_file` |
| target_item_id | String | Config ID |
| last_synced | Timestamp | |
| sync_status | String | `idle`, `syncing`, `error` |
| sync_error | Text | Error message if failed |
| created_by | M2O → directus_users | |
| date_created | Timestamp | |

## Scope

### In Scope

- Cloud icon + provider dropdown in calculator upload UI
- OAuth popup flow for Google Drive, OneDrive, Dropbox, Box
- File browser dialog (filter to .xlsx/.xls/.csv)
- Connected state UI (provider icon, filename, last synced, Sync/Disconnect buttons)
- Backend endpoint extension (`/cloud-sync/*` routes)
- Token encryption at rest (AES-256-GCM, `CLOUD_SYNC_ENCRYPTION_KEY`)
- Automatic token refresh on sync
- Re-parse on sync (Formula API integration)
- Account-scoped `cloud_connections` collection
- Companion server in docker-compose

### Out of Scope (Future)

- Scheduled/automatic sync (Directus Flows)
- Webhook-triggered sync (provider push notifications)
- Sync history / diff tracking
- Multi-file connections
- Folder watching

## Key Tasks

1. Deploy Uppy Companion as Docker service (docker-compose.yml)
2. Register OAuth apps with providers (Google, Microsoft, Dropbox, Box)
3. Create `cloud_connections` collection + permissions
4. Scaffold bundle extension (`project-extension-cloud-sync`)
5. Build endpoint routes (auth, browse, connect, sync, disconnect)
6. Build token encryption service
7. Integrate cloud dropdown + connected state into `calculator-detail.vue`
8. Build OAuth popup composable
9. Build file browser dialog component
10. Wire sync to re-parse flow (parse + config update + version bump)
11. Integration testing across providers
12. Error handling (token expiry, revoked access, large files)

## Dependencies

- **#16 Infrastructure** — Companion server needs hosting
- **#04 Formula API Auth** — shares token encryption patterns
- Provider OAuth app registration (external, one-time setup per provider)

## Estimate

~6-8 developer days (per source spec), but add ~1-2 days for Formula API re-parse integration and account scoping.

## Risks

| Risk | Mitigation |
|---|---|
| OAuth tokens expire between syncs | Auto-refresh using refresh tokens + `token_expires_at` |
| Google OAuth verification delays | Use Google Picker API (no verification for non-sensitive scopes) |
| User revokes cloud access | Handle 401/403 gracefully, show "re-authenticate" prompt |
| Companion server adds infra complexity | Bundle in docker-compose, health checks |
| Concurrent sync on same connection | Check `sync_status` before starting, reject if `syncing` |

## Acceptance Criteria

- [ ] User can connect Google Drive / OneDrive / Dropbox / Box file from calculator upload UI
- [ ] Connected state shows provider, filename, last synced time
- [ ] "Sync Now" downloads latest file, overwrites Directus file, re-parses, updates config
- [ ] OAuth tokens encrypted at rest, auto-refreshed on expiry
- [ ] Disconnect removes cloud connection, keeps local file
- [ ] cloud_connections scoped to `$CURRENT_USER.active_account`
- [ ] Companion server running in docker-compose
