CREATE TABLE gateway.request_log (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID         NOT NULL,
  api_key_id      UUID,
  method          VARCHAR(10)  NOT NULL,
  path            VARCHAR(500) NOT NULL,
  status_code     INTEGER      NOT NULL,
  latency_ms      INTEGER      NOT NULL,
  request_size    INTEGER,
  response_size   INTEGER,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_request_log_account_month
  ON gateway.request_log (account_id, created_at);
