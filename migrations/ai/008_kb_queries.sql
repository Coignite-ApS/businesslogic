-- 008_kb_queries.sql
-- Create kb_queries table for KB query tracking (dashboard charts/KPIs)

CREATE TABLE IF NOT EXISTS kb_queries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base  uuid REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    account         uuid REFERENCES account(id) ON DELETE SET NULL,
    query           text NOT NULL,
    type            character varying(255) NOT NULL,
    result_count    integer,
    "timestamp"     timestamp with time zone,
    date_created    timestamp with time zone DEFAULT now()
);

-- Index on knowledge_base for filtering by KB
CREATE INDEX IF NOT EXISTS idx_kb_queries_knowledge_base ON kb_queries(knowledge_base);

-- Index on account for filtering by account
CREATE INDEX IF NOT EXISTS idx_kb_queries_account ON kb_queries(account);

-- Index on date_created for time-range queries
CREATE INDEX IF NOT EXISTS idx_kb_queries_date_created ON kb_queries(date_created);
