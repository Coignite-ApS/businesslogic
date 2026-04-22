-- Fix permissions column default from old flat format to v3
ALTER TABLE api_keys ALTER COLUMN permissions
SET DEFAULT '{"services":{"calc":{"enabled":true,"resources":["*"],"actions":["execute","describe"]},"kb":{"enabled":true,"resources":["*"],"actions":["search","ask"]},"flow":{"enabled":true,"resources":["*"],"actions":["trigger"]}}}';
