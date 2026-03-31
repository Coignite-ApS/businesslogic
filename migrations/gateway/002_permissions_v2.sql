-- Permissions v2: resource-level grants
-- No column changes — permissions is already JSONB
-- This migration converts any existing flat-format keys to v2 with empty resources (= no access)
--
-- New format:
-- {
--   "services": {
--     "calc": {
--       "enabled": true,
--       "resources": ["calc-uuid-1"],  -- REQUIRED, empty = NO access
--       "actions": ["execute", "describe"]  -- REQUIRED, empty = NO access
--     },
--     "ai": { "enabled": true, "resources": ["kb-uuid-1"], "actions": ["chat", "search"] },
--     "flow": { "enabled": false }
--   }
-- }
--
-- Old flat format {"ai": true, "calc": true} → converted to v2 with empty resources (deny by default)

UPDATE api_keys
SET permissions = jsonb_build_object(
  'services', jsonb_build_object(
    'calc', jsonb_build_object('enabled', COALESCE((permissions->>'calc')::boolean, false), 'resources', '[]'::jsonb, 'actions', '[]'::jsonb),
    'ai',   jsonb_build_object('enabled', COALESCE((permissions->>'ai')::boolean, false),   'resources', '[]'::jsonb, 'actions', '[]'::jsonb),
    'flow', jsonb_build_object('enabled', COALESCE((permissions->>'flow')::boolean, false),  'resources', '[]'::jsonb, 'actions', '[]'::jsonb)
  )
)
WHERE permissions->>'services' IS NULL;

COMMENT ON COLUMN api_keys.permissions IS 'v2 resource-level permissions: {"services":{"calc":{"enabled":true,"resources":["uuid"],"actions":["execute"]}}}';
