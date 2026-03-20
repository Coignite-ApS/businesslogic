-- Gateway API Key Management
-- Used by bl-gateway for authentication, rate limiting, and access control
-- References cms.account for ownership

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,  -- First 8 chars for identification: "bl_acc12"
  account_id UUID NOT NULL REFERENCES account(id),
  environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live', 'test', 'dev')),
  name TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{"ai": true, "calc": true, "flow": false}',
  allowed_ips TEXT[],
  allowed_origins TEXT[],
  rate_limit_rps INT,
  monthly_quota INT,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys (account_id);
