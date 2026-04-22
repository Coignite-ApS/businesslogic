-- Migration: Pricing v2 — create enum types module_kind and tier_level
-- Slug: pricing-v2-schema
-- Date: 2026-04-18
--
-- module_kind: which monetizable module a plan/subscription belongs to
-- tier_level:  which tier within a module (starter/growth/scale/enterprise)
--
-- Idempotent via DO-block guards — safe to re-run.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'module_kind') THEN
        CREATE TYPE module_kind AS ENUM ('calculators', 'kb', 'flows');
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tier_level') THEN
        CREATE TYPE tier_level AS ENUM ('starter', 'growth', 'scale', 'enterprise');
    END IF;
END$$;
