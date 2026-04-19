-- Migration 030 DOWN: drop aggregate_usage_events function
DROP FUNCTION IF EXISTS public.aggregate_usage_events();
