-- Drop unused access control fields from calculator_configs
-- These fields were never enforced at runtime; gateway handles access control at API key level.
-- Both columns have 0 non-null values across all 24 rows.

ALTER TABLE calculator_configs DROP COLUMN IF EXISTS allowed_ips;
ALTER TABLE calculator_configs DROP COLUMN IF EXISTS allowed_origins;

-- Also remove Directus field metadata
DELETE FROM directus_fields WHERE collection = 'calculator_configs' AND field IN ('allowed_ips', 'allowed_origins');
