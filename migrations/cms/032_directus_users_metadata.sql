-- 032: Add metadata JSONB column to directus_users
-- Purpose: per-user JSONB store for extensible metadata (e.g. onboarding_state)
-- Idempotent: safe to re-run

ALTER TABLE public.directus_users
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
