-- 032 DOWN: Remove metadata JSONB column from directus_users

ALTER TABLE public.directus_users
  DROP COLUMN IF EXISTS metadata;
