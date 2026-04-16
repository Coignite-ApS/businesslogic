CREATE TABLE IF NOT EXISTS gateway.schema_migrations (
    id SERIAL PRIMARY KEY,
    schema_name TEXT NOT NULL,
    filename TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(schema_name, filename)
);
