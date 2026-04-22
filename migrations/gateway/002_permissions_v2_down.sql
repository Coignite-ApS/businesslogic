-- Rollback: 002_permissions_v2
-- Reverts permissions from v2 format back to flat format
-- Converts {"services":{"calc":{"enabled":true,...},...}} -> {"ai":true,"calc":true,"flow":false}

UPDATE api_keys
SET permissions = jsonb_build_object(
    'ai',   COALESCE((permissions->'services'->'ai'->>'enabled')::boolean, false),
    'calc', COALESCE((permissions->'services'->'calc'->>'enabled')::boolean, false),
    'flow', COALESCE((permissions->'services'->'flow'->>'enabled')::boolean, false)
)
WHERE permissions ? 'services';

COMMENT ON COLUMN api_keys.permissions IS NULL;
