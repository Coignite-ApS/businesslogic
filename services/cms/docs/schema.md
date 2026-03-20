# Database Schema

Directus 11.9.3 on PostgreSQL.

## Collections

| Collection | Type | Notes |
|---|---|---|
| **account** | collection | Account/tenant, multi-tenant via active_account |
| **calculators** | sortable | Excel calculators, belongs to account |
| **calculator_configs** | grouped under calculators | API config per calculator |
| **calculator_calls** | collection | Usage tracking per calculator call |
| **subscriptions** | collection | Stripe subscription per account |
| **subscription_plans** | collection | Plan definitions with rate limits |
| **formula_tokens** | collection | Per-account API keys for formula execution |
| **account_directus_users** | junction (hidden) | M2M between account & users |

## Fields

### account (singleton)

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| status | string | draft / published / archived |
| user_created | uuid | FK → directus_users |
| date_created | timestamp | |
| user_updated | uuid | FK → directus_users |
| date_updated | timestamp | |
| calculators | O2M | → calculators |
| users | M2M | → directus_users (via account_directus_users) |

### calculators

| Field | Type | Notes |
|---|---|---|
| id | string | PK, user-defined (e.g. `my-calculator`), set during onboarding |
| status | string | draft / published / archived |
| sort | integer | Manual sort order |
| name | string | Calculator name |
| account | uuid | FK → account (SET NULL on delete) |
| user_created | uuid | FK → directus_users |
| date_created | timestamp | |
| user_updated | uuid | FK → directus_users |
| date_updated | timestamp | |
| activated | boolean | Whether live version is deployed to Formula API |
| onboarded | boolean | Whether onboarding wizard is complete |
| configs | O2M | → calculator_configs |

### calculator_configs

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| description | text | Config description |
| api_key | string | BusinessLogic API key |
| test_environment | boolean | Use test env |
| input | json | Input field mappings |
| output | json | Output field mappings |
| sheets | json | Excel sheet config |
| formulas | json | Formula definitions |
| file_version | integer | Incremented on each Excel upload |
| config_version | string | Incremented on config save |
| excel_file | uuid | FK → directus_files (CASCADE on delete) |
| calculator | string | FK → calculators (CASCADE on delete) |
| user_created | uuid | FK → directus_users |
| date_created | timestamp | |
| user_updated | uuid | FK → directus_users |
| date_updated | timestamp | |

### formula_tokens

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| account | uuid | FK → account |
| label | string | Display name (e.g. "Default API Key") |
| token | string | Encrypted (AES-256-GCM, `v1:` prefix) or plaintext |
| date_created | timestamp | |
| last_used_at | timestamp | Nullable, updated on use |
| revoked | boolean | Soft-delete flag |
| revoked_at | timestamp | Nullable |

Auto-created on account creation with label "Default API Key".

## Relations

```
account ←───── calculators.account      (M2O, on_delete: SET NULL)
account ←───── formula_tokens.account   (M2O)
account ←M2M→  directus_users           (via account_directus_users, CASCADE)
calculators ←── calculator_configs.calculator  (M2O, on_delete: CASCADE)
calculator_configs.excel_file ──→ directus_files  (on_delete: CASCADE)
```

### subscriptions

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| account | uuid | FK → account |
| plan | uuid | FK → subscription_plans |
| status | string | active / trialing / canceled / expired |
| trial_end | timestamp | Trial expiry date |
| stripe_subscription_id | string | Stripe subscription ID |

### subscription_plans

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | string | Plan display name |
| stripe_product_id | string | Stripe product ID |
| calls_per_second | integer | RPS rate limit (null = unlimited) |
| calls_per_month | integer | Monthly call limit (null = unlimited) |
| calculator_limit | integer | Max calculators per account |

### calculator_calls

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| calculator | string | FK → calculators |
| account | uuid | FK → account (direct, avoids join) |
| type | string | `calculator` or `formula` |
| timestamp | timestamp | Call time |
| response_time_ms | integer | Response time in ms |
| error | boolean | Whether call errored |
| error_message | string | Error details |
| cached | boolean | Whether result was cached |
| test | boolean | Whether test environment call |

## Diagram

```
┌──────────────┐       ┌──────────────────┐       ┌─────────────────────┐
│   account    │ 1───M │   calculators    │ 1───M │  calculator_configs │
│              │       │                  │       │                     │
│  status      │       │  name            │       │  api_key            │
│  users (M2M) │       │  status          │       │  test_environment   │
│              │       │  sort            │       │  input/output (json)│
└──┬───┬───┬───┘       └────────┬─────────┘       │  sheets/formulas    │
   │   │   │                    │                 │  excel_file (file)  │
   │   │   │ 1───M              │ 1───M           └─────────────────────┘
   │   │   │               ┌───┴──────────────┐
   │   │   │               │ calculator_calls │
   │   │   │               │                  │
   │   │   │               │  type (calc/form)│
   │   │   │               │  account (FK)    │
   │   │   │               │  timestamp       │
   │   │   │               │  response_time_ms│
   │   │   │               └──────────────────┘
   │   │   │
   │   │   └──────────┐
   │   │ 1───M        │ 1───M
   │ ┌─┴───────────┐ ┌┴───────────────┐
   │ │ subscriptions│ │ formula_tokens │
   │ │              │ │                │
   │ │  status      │ │  label         │
   │ │  trial_end   │ │  token (enc)   │
   │ │  plan (FK)   │ │  revoked       │
   │ └──────┬───────┘ └────────────────┘
   │        │ M───1
   │ ┌──────┴────────────┐
   │ │ subscription_plans│
   │ │                   │
   │ │  calls_per_second │
   │ │  calls_per_month  │
   │ │  calculator_limit │
   │ └───────────────────┘
```
