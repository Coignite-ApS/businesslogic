-- Reverse of 002_pricing_v2_enums.sql
-- Drops module_kind and tier_level enum types.
-- WARNING: will fail if any column anywhere uses these types — drop dependent
-- columns/tables first (003_*_down, 004_*_down, 005_*_down handle this).

DROP TYPE IF EXISTS module_kind;
DROP TYPE IF EXISTS tier_level;
