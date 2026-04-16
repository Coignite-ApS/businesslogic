-- Rollback: 002_drop_cms_calculator_calls
-- Recreates public.calculator_calls table that was dropped
-- WARNING: Data is NOT restored. Only schema is recreated.
-- Restore data from backup or formula.calculator_calls if needed.

CREATE TABLE IF NOT EXISTS public.calculator_calls (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calculator      VARCHAR,
    account         UUID,
    timestamp       TIMESTAMPTZ DEFAULT NOW(),
    cached          BOOLEAN DEFAULT FALSE,
    error           BOOLEAN DEFAULT FALSE,
    error_message   TEXT,
    response_time_ms INTEGER,
    test            BOOLEAN DEFAULT FALSE,
    type            VARCHAR DEFAULT 'calculator'
);
