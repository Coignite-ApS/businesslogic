-- migrations/formula/001_create_calculator_calls.sql
-- Create formula schema + calculator_calls table for direct stats writes from formula-api.
-- Phase 3 of the direct DB migration (task 07).
-- The public.calculator_calls table (owned by bl-cms) remains until Phase 5.

CREATE SCHEMA IF NOT EXISTS formula;

CREATE TABLE IF NOT EXISTS formula.calculator_calls (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calculator_id   VARCHAR NOT NULL,
    account_id      UUID,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cached          BOOLEAN NOT NULL DEFAULT FALSE,
    error           BOOLEAN NOT NULL DEFAULT FALSE,
    error_message   TEXT,
    response_time_ms INTEGER,
    test            BOOLEAN DEFAULT FALSE,
    type            VARCHAR DEFAULT 'calculator'
);

CREATE INDEX IF NOT EXISTS idx_formula_calc_calls_calculator_id ON formula.calculator_calls (calculator_id);
CREATE INDEX IF NOT EXISTS idx_formula_calc_calls_account_id    ON formula.calculator_calls (account_id);
CREATE INDEX IF NOT EXISTS idx_formula_calc_calls_timestamp     ON formula.calculator_calls (timestamp DESC);
