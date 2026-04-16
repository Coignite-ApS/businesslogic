-- Rollback: 005_fix_permissions_default
-- Restores permissions column default to v2 format (pre-kb service key)

ALTER TABLE api_keys ALTER COLUMN permissions
SET DEFAULT '{"services":{"calc":{"enabled":true,"resources":[],"actions":[]},"ai":{"enabled":true,"resources":[],"actions":[]},"flow":{"enabled":false,"resources":[],"actions":[]}}}';
