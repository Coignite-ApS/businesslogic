-- Migration: Add 'ai' value to module_kind enum
-- Slug: pricing-v2-module-kind-add-ai
-- Date: 2026-04-19
--
-- ALTER TYPE ADD VALUE is non-transactional in Postgres — it cannot run inside
-- a transaction block. This statement is idempotent via IF NOT EXISTS.
--
-- No data-loss risk: enum values are purely additive.
-- Affected: public.usage_events.module, subscription_plans.module,
--           subscriptions.module, subscription_addons.module, feature_quotas.module

ALTER TYPE public.module_kind ADD VALUE IF NOT EXISTS 'ai';
