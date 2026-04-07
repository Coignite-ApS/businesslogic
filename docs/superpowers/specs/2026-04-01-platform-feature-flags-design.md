# Platform Feature Flags — Design Spec

**Date:** 2026-04-01
**Task:** cross-cutting/10-platform-feature-flags.md
**Status:** spec

---

## Goal

Centralized feature flag system: admin can globally enable/disable features, per-account overrides allow beta testing. Gateway enforces flags on all public traffic.

---

## Data Model

CMS-owned tables (Directus-managed), `cms.*` schema.

### `platform_features`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | PK |
| `key` | varchar, unique | e.g. `ai.chat`, `calc.execute`, `widget.builder` |
| `name` | varchar | Human label |
| `description` | text | What this flag controls |
| `enabled` | boolean, default true | Global on/off |
| `category` | varchar | Grouping: `ai`, `calc`, `flow`, `widget`, `platform` |
| `sort` | integer | Display order |
| `date_created` | timestamp | Auto |
| `date_updated` | timestamp | Auto |

### `account_features`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | PK |
| `account` | UUID FK → account | Which account |
| `feature` | UUID FK → platform_features | Which feature |
| `enabled` | boolean | Override value |
| `date_created` | timestamp | Auto |
| `date_updated` | timestamp | Auto |
| | unique(account, feature) | One override per feature per account |

### Resolution Logic

```
allowed = account_override ?? platform_default
```

If feature key not registered → deny (fail-closed).

---

## Redis Cache Layer

CMS pushes flags to Redis on change via Directus hook. Gateway reads from cache only.

### Cache Keys

- `cms:features:{key}` → `"1"` or `"0"` (platform default)
- `cms:features:{accountId}:{key}` → `"1"` or `"0"` (account override)
- `cms:features:_keys` → SET of all feature keys

### Cache Invalidation

- Directus hook on `platform_features` create/update/delete → update `cms:features:{key}` + `cms:features:_keys`
- Directus hook on `account_features` create/update/delete → update `cms:features:{accountId}:{key}`
- On CMS startup: full sync all flags to Redis
- No TTL (explicitly managed). Gateway fallback: if Redis unavailable, deny all gated features (fail-closed).

### Gateway Resolution (per request)

1. Get `accountId` from auth middleware (already in context)
2. `MGET cms:features:{accountId}:{featureKey}, cms:features:{featureKey}`
3. First non-null wins (account override > platform default)
4. Both null → feature not registered → deny

Performance: single `MGET`, ~0.1ms additional latency.

---

## Gateway Enforcement

No new middleware. Extend existing auth flow in `services/gateway/internal/middleware/auth.go`.

### Route-to-Feature Mapping

Config in gateway (Go map), not in Redis:

```
/v1/ai/chat/*       → ai.chat
/v1/ai/kb/*          → ai.kb
/v1/ai/embed/*       → ai.embeddings
/v1/calc/execute/*   → calc.execute
/v1/calc/mcp/*       → calc.mcp
/v1/flow/*           → flow.execute
/v1/widget/*         → widget.render
```

Routes not mapped → no feature check (passthrough).

### Denied Response

```json
{
  "error": "feature_disabled",
  "feature": "ai.chat",
  "message": "This feature is not currently available"
}
```

HTTP 403.

### No Changes to Backend Services

Gateway blocks before traffic reaches formula-api, ai-api, or flow.

---

## Admin UI

New section in existing admin module (`project-extension-admin`).

### Platform Features Tab

- Table: name, key, category, toggle switch
- Grouped by category (AI, Calculators, Flows, Widgets, Platform)
- Toggle flips `enabled`, hook pushes to Redis immediately
- Green/red indicator for current state

### Account Overrides

- Accessed from features section with account filter
- Three states per feature per account: "Platform default" / "Force ON" / "Force OFF"
- "Platform default" = no override row (delete row to reset)
- Shows effective resolved state with source indicator (platform vs override)
- Filter by account, search by feature name

---

## Seed Data

Initial feature flags (all `enabled: true`):

| Key | Name | Category |
|-----|------|----------|
| `ai.chat` | AI Chat | ai |
| `ai.kb` | Knowledge Base | ai |
| `ai.embeddings` | Embeddings API | ai |
| `calc.execute` | Calculator Execution | calc |
| `calc.mcp` | Calculator MCP | calc |
| `flow.execute` | Flow Execution | flow |
| `widget.render` | Widget Rendering | widget |
| `widget.builder` | Widget Layout Builder | widget |

---

## Affected Services

| Service | Change |
|---------|--------|
| **bl-cms** | 2 new collections (Directus schema), 1 new hook (Redis sync), admin module update |
| **bl-gateway** | Feature check in auth flow, route-to-feature config, Redis reads |
| **infrastructure** | No new services, no new ports |

---

## Not In Scope

- Subscription-plan-level feature defaults
- Feature flag scheduling (enable on date X)
- Feature usage analytics
- Service-side SDK for internal checks
- Cedar guardrails (cross-cutting/05, separate)
- Per-API-key feature restrictions (existing permissions v3 handles this)

---

## Success Criteria

1. Admin can toggle a feature globally → all accounts immediately affected
2. Admin can override a feature for specific account → only that account affected
3. Gateway denies requests to disabled features with 403
4. Cache update latency < 1s (hook fires on save)
5. Gateway overhead < 0.5ms per request (single MGET)
6. Fail-closed: unknown features or Redis down → deny gated routes
7. All existing tests pass (no regression)
