-- Restore access control fields to calculator_configs
ALTER TABLE calculator_configs ADD COLUMN IF NOT EXISTS allowed_ips json;
ALTER TABLE calculator_configs ADD COLUMN IF NOT EXISTS allowed_origins json;

-- Restore Directus field metadata
INSERT INTO directus_fields (collection, field, special, interface, options, display, display_options, readonly, hidden, sort, width, translations, note, conditions, required, "group", validation, validation_message, searchable)
VALUES
  ('calculator_configs', 'allowed_ips', NULL, 'tags', NULL, NULL, NULL, false, false, NULL, 'full', NULL, NULL, NULL, false, NULL, NULL, NULL, true),
  ('calculator_configs', 'allowed_origins', NULL, 'tags', NULL, NULL, NULL, false, false, NULL, 'full', NULL, NULL, NULL, false, NULL, NULL, NULL, true)
ON CONFLICT (collection, field) DO NOTHING;
