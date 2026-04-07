-- Add encrypted_key column for storing AES-256-GCM encrypted raw keys.
-- Nullable: existing keys won't have it, only new keys going forward.
ALTER TABLE api_keys ADD COLUMN encrypted_key TEXT;
