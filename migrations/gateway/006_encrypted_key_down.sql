-- Rollback: 006_encrypted_key
-- Removes encrypted_key column from api_keys

ALTER TABLE api_keys DROP COLUMN IF EXISTS encrypted_key;
