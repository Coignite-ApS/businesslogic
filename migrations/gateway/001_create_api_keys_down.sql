-- Rollback: 001_create_api_keys
-- Drops api_keys table and its indexes
-- WARNING: This destroys all API key data.

DROP INDEX IF EXISTS idx_api_keys_account;
DROP INDEX IF EXISTS idx_api_keys_key_hash;
DROP TABLE IF EXISTS api_keys;
