import { query, queryOne, queryAll } from '../db.js';

/**
 * Aggregate a day's metrics into ai_metrics_daily.
 * Idempotent — uses UPSERT.
 * @param {Date} [targetDate] — defaults to yesterday (UTC)
 * @returns {number} accounts processed
 */
export async function aggregateDailyMetrics(targetDate) {
  const date = targetDate || yesterday();
  const dateStr = date.toISOString().split('T')[0];
  const nextDateStr = nextDay(date).toISOString().split('T')[0];

  // All accounts with activity on target date
  const accounts = await queryAll(
    `SELECT DISTINCT account FROM ai_token_usage
     WHERE date_created >= $1 AND date_created < $2`,
    [dateStr, nextDateStr],
  );

  for (const { account } of accounts) {
    // Token usage aggregation
    const usage = await queryOne(
      `SELECT
        COUNT(*)::int AS total_requests,
        COALESCE(SUM(input_tokens), 0)::bigint AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0)::bigint AS total_output_tokens,
        COALESCE(SUM(cost_usd), 0)::float AS total_cost_usd,
        COALESCE(AVG(response_time_ms), 0)::float AS avg_response_time_ms
       FROM ai_token_usage
       WHERE account = $1 AND date_created >= $2 AND date_created < $3`,
      [account, dateStr, nextDateStr],
    );

    // Conversation stats
    const convStats = await queryOne(
      `SELECT
        COUNT(DISTINCT id)::int AS total_conversations,
        COALESCE(AVG(total_input_tokens + total_output_tokens), 0)::float AS avg_tokens_per_conv
       FROM ai_conversations
       WHERE account = $1 AND date_updated >= $2 AND date_updated < $3`,
      [account, dateStr, nextDateStr],
    );

    // Model breakdown
    const modelRows = await queryAll(
      `SELECT model,
        COUNT(*)::int AS calls,
        COALESCE(SUM(input_tokens), 0)::bigint AS tokens,
        COALESCE(SUM(cost_usd), 0)::float AS cost
       FROM ai_token_usage
       WHERE account = $1 AND date_created >= $2 AND date_created < $3
       GROUP BY model`,
      [account, dateStr, nextDateStr],
    );
    const modelBreakdown = {};
    for (const r of modelRows) {
      modelBreakdown[r.model] = { calls: r.calls, tokens: Number(r.tokens), cost: r.cost };
    }

    // Tool breakdown from tool_calls JSONB
    const toolRows = await queryAll(
      `SELECT elem->>'name' AS tool_name,
        COUNT(*)::int AS calls,
        COUNT(*) FILTER (WHERE (elem->>'is_error')::boolean = true)::int AS errors,
        COALESCE(AVG((elem->>'duration_ms')::float), 0)::float AS avg_ms
       FROM ai_token_usage,
       LATERAL jsonb_array_elements(COALESCE(tool_calls, '[]'::jsonb)) AS elem
       WHERE account = $1 AND date_created >= $2 AND date_created < $3
       GROUP BY elem->>'name'`,
      [account, dateStr, nextDateStr],
    );
    const toolBreakdown = {};
    for (const r of toolRows) {
      toolBreakdown[r.tool_name] = { calls: r.calls, errors: r.errors, avg_ms: r.avg_ms };
    }

    // Message count (sum of message array lengths)
    const msgCount = await queryOne(
      `SELECT COALESCE(SUM(jsonb_array_length(messages)), 0)::int AS total
       FROM ai_conversations
       WHERE account = $1 AND date_updated >= $2 AND date_updated < $3`,
      [account, dateStr, nextDateStr],
    );

    const totalToolCalls = Object.values(toolBreakdown).reduce((s, t) => s + t.calls, 0);

    // Upsert into ai_metrics_daily
    await query(
      `INSERT INTO ai_metrics_daily
        (account_id, date, total_conversations, total_messages, total_tool_calls,
         total_input_tokens, total_output_tokens, total_cost_usd,
         avg_conversation_length, avg_response_time_ms, model_breakdown, tool_breakdown)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (account_id, date) DO UPDATE SET
         total_conversations = EXCLUDED.total_conversations,
         total_messages = EXCLUDED.total_messages,
         total_tool_calls = EXCLUDED.total_tool_calls,
         total_input_tokens = EXCLUDED.total_input_tokens,
         total_output_tokens = EXCLUDED.total_output_tokens,
         total_cost_usd = EXCLUDED.total_cost_usd,
         avg_conversation_length = EXCLUDED.avg_conversation_length,
         avg_response_time_ms = EXCLUDED.avg_response_time_ms,
         model_breakdown = EXCLUDED.model_breakdown,
         tool_breakdown = EXCLUDED.tool_breakdown`,
      [
        account, dateStr,
        convStats?.total_conversations || 0,
        msgCount?.total || 0,
        totalToolCalls,
        usage?.total_input_tokens || 0,
        usage?.total_output_tokens || 0,
        usage?.total_cost_usd || 0,
        (convStats?.total_conversations > 0) ? (msgCount?.total || 0) / convStats.total_conversations : 0,
        usage?.avg_response_time_ms || 0,
        JSON.stringify(modelBreakdown),
        JSON.stringify(toolBreakdown),
      ],
    );
  }

  return accounts.length;
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

let aggregationTimer = null;

export function scheduleAggregation() {
  // Run immediately on start (catches yesterday if not yet aggregated)
  aggregateDailyMetrics().catch(err =>
    console.error('[metrics-aggregator] initial run failed:', err.message),
  );

  // Then run daily at 01:00 UTC
  const runDaily = () => {
    const now = new Date();
    const next = new Date(now);
    // If we're already past 01:00 UTC today, schedule for tomorrow
    if (now.getUTCHours() >= 1) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    next.setUTCHours(1, 0, 0, 0);
    const delay = next.getTime() - now.getTime();

    aggregationTimer = setTimeout(() => {
      aggregateDailyMetrics().catch(err =>
        console.error('[metrics-aggregator] daily run failed:', err.message),
      );
      runDaily(); // Schedule next
    }, delay);
  };

  runDaily();
}

export function stopAggregation() {
  if (aggregationTimer) {
    clearTimeout(aggregationTimer);
    aggregationTimer = null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function yesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function nextDay(d) {
  const n = new Date(d);
  n.setUTCDate(n.getUTCDate() + 1);
  return n;
}
