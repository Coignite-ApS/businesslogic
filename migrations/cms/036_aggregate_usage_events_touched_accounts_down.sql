-- Migration 036 rollback: revert aggregate_usage_events to pre-036 shape
-- Removes touched_accounts field; restores migration-033 function body exactly.

CREATE OR REPLACE FUNCTION public.aggregate_usage_events(p_batch_size int DEFAULT 100000)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_events_aggregated bigint := 0;
  v_accounts_touched  bigint := 0;
  v_periods_touched   bigint := 0;
  v_lag_seconds       numeric := 0;
  v_oldest_unagg      timestamptz;
BEGIN
  -- I1: Block concurrent invocations for the duration of this transaction
  PERFORM pg_advisory_xact_lock(hashtext('aggregate_usage_events'));

  -- Capture lag before we mark rows as aggregated (reflects oldest event in remaining backlog)
  SELECT MIN(occurred_at) INTO v_oldest_unagg
  FROM public.usage_events
  WHERE aggregated_at IS NULL;

  IF v_oldest_unagg IS NOT NULL THEN
    v_lag_seconds := EXTRACT(EPOCH FROM (NOW() - v_oldest_unagg));
  END IF;

  -- I3: Limit source rows before GROUP BY to cap memory per batch
  WITH events_to_agg AS (
    SELECT id, account_id, occurred_at, event_kind, quantity, cost_eur, metadata
    FROM public.usage_events
    WHERE aggregated_at IS NULL
    ORDER BY occurred_at
    LIMIT p_batch_size
  ),
  new_events AS (
    SELECT
      account_id,
      to_char(occurred_at, 'YYYYMM')::int AS period_yyyymm,
      COUNT(*) FILTER (WHERE event_kind = 'calc.call')                              AS calc_calls,
      COUNT(*) FILTER (WHERE event_kind = 'kb.search')                              AS kb_searches,
      COUNT(*) FILTER (WHERE event_kind = 'kb.ask')                                AS kb_asks,
      COALESCE(SUM(quantity) FILTER (WHERE event_kind = 'embed.tokens'), 0)        AS kb_embed_tokens,
      COUNT(*) FILTER (WHERE event_kind = 'ai.message')                            AS ai_messages,
      COALESCE(SUM(
        CASE
          WHEN metadata ? 'input_tokens'
           AND metadata->>'input_tokens' ~ '^[0-9]+$'
          THEN (metadata->>'input_tokens')::bigint
          ELSE 0
        END
      ) FILTER (WHERE event_kind = 'ai.message'), 0)                               AS ai_input_tokens,
      COALESCE(SUM(
        CASE
          WHEN metadata ? 'output_tokens'
           AND metadata->>'output_tokens' ~ '^[0-9]+$'
          THEN (metadata->>'output_tokens')::bigint
          ELSE 0
        END
      ) FILTER (WHERE event_kind = 'ai.message'), 0)                               AS ai_output_tokens,
      COALESCE(SUM(cost_eur) FILTER (WHERE event_kind IN ('ai.message', 'embed.tokens')), 0) AS ai_cost_eur,
      COUNT(*) FILTER (WHERE event_kind = 'flow.execution')                        AS flow_executions,
      COUNT(*) FILTER (WHERE event_kind = 'flow.step')                             AS flow_steps,
      COUNT(*) FILTER (WHERE event_kind = 'flow.failed')                           AS flow_failed,
      COALESCE(SUM(cost_eur), 0)                                                   AS total_cost_eur,
      array_agg(id)                                                                AS event_ids
    FROM events_to_agg
    GROUP BY account_id, to_char(occurred_at, 'YYYYMM')::int
  ),
  upserted AS (
    INSERT INTO public.monthly_aggregates (
      account_id, period_yyyymm,
      calc_calls,
      kb_searches, kb_asks, kb_embed_tokens,
      ai_messages, ai_input_tokens, ai_output_tokens, ai_cost_eur,
      flow_executions, flow_steps, flow_failed,
      total_cost_eur,
      refreshed_at, date_updated
    )
    SELECT
      account_id, period_yyyymm,
      calc_calls,
      kb_searches, kb_asks, kb_embed_tokens,
      ai_messages, ai_input_tokens, ai_output_tokens, ai_cost_eur,
      flow_executions, flow_steps, flow_failed,
      total_cost_eur,
      NOW(), NOW()
    FROM new_events
    ON CONFLICT (account_id, period_yyyymm) DO UPDATE SET
      calc_calls              = monthly_aggregates.calc_calls              + EXCLUDED.calc_calls,
      kb_searches             = monthly_aggregates.kb_searches             + EXCLUDED.kb_searches,
      kb_asks                 = monthly_aggregates.kb_asks                 + EXCLUDED.kb_asks,
      kb_embed_tokens         = monthly_aggregates.kb_embed_tokens         + EXCLUDED.kb_embed_tokens,
      ai_messages             = monthly_aggregates.ai_messages             + EXCLUDED.ai_messages,
      ai_input_tokens         = monthly_aggregates.ai_input_tokens         + EXCLUDED.ai_input_tokens,
      ai_output_tokens        = monthly_aggregates.ai_output_tokens        + EXCLUDED.ai_output_tokens,
      ai_cost_eur             = monthly_aggregates.ai_cost_eur             + EXCLUDED.ai_cost_eur,
      flow_executions         = monthly_aggregates.flow_executions         + EXCLUDED.flow_executions,
      flow_steps              = monthly_aggregates.flow_steps              + EXCLUDED.flow_steps,
      flow_failed             = monthly_aggregates.flow_failed             + EXCLUDED.flow_failed,
      total_cost_eur          = monthly_aggregates.total_cost_eur          + EXCLUDED.total_cost_eur,
      refreshed_at            = NOW(),
      date_updated            = NOW()
    RETURNING account_id, period_yyyymm
  ),
  marked AS (
    UPDATE public.usage_events
    SET aggregated_at = NOW()
    WHERE id = ANY(
      ARRAY(
        SELECT unnest(event_ids)
        FROM new_events
      )::bigint[]
    )
    RETURNING id
  )
  SELECT
    (SELECT COUNT(*) FROM marked),
    (SELECT COUNT(DISTINCT account_id) FROM upserted),
    (SELECT COUNT(*) FROM upserted)
  INTO v_events_aggregated, v_accounts_touched, v_periods_touched;

  RETURN jsonb_build_object(
    'events_aggregated', v_events_aggregated,
    'accounts_touched',  v_accounts_touched,
    'periods_touched',   v_periods_touched,
    'lag_seconds',       v_lag_seconds
  );
END;
$$;
