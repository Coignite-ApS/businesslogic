import type { DB } from './types.js';
import { AI_TOOLS } from './tools.js';

export function registerObservatoryRoutes(app: any, db: DB, env: any, logger: any, proxyToAiApi: any, requireAuth: any, requireAdmin: any) {

	app.get('/assistant/admin/cost-details', requireAuth, requireAdmin, async (_req: any, res: any) => {
		const proxied = await proxyToAiApi(_req, res, env, logger);
		if (proxied) return;
		try {
			const days = Math.min(Math.max(parseInt(_req.query?.days || '30', 10), 1), 365);
			const sinceDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

			// Daily cost breakdown
			const dailyCost = await db('ai_token_usage')
				.where(db.raw("DATE(date_created)"), '>=', sinceDate)
				.select(
					db.raw("DATE(date_created) as date"),
					db.raw('COALESCE(SUM(cost_usd), 0) as total_cost_usd'),
					db.raw('COALESCE(SUM(input_tokens), 0) as total_input_tokens'),
					db.raw('COALESCE(SUM(output_tokens), 0) as total_output_tokens'),
				)
				.groupByRaw('DATE(date_created)')
				.orderBy('date', 'asc');

			// Per-model daily cost breakdown
			const modelDailyCost = await db('ai_token_usage')
				.where(db.raw("DATE(date_created)"), '>=', sinceDate)
				.select(
					db.raw("DATE(date_created) as date"),
					'model',
					db.raw('COALESCE(SUM(cost_usd), 0) as cost'),
				)
				.groupByRaw("DATE(date_created), model")
				.orderBy('date', 'asc');

			// Cost per conversation percentiles via PostgreSQL PERCENTILE_CONT
			const convPercentiles = await db.raw(`
				SELECT
					PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_cost) as p50,
					PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_cost) as p95,
					MAX(total_cost) as max,
					AVG(total_cost) as avg,
					COUNT(*) as sample_size
				FROM (
					SELECT conversation, SUM(cost_usd) as total_cost
					FROM ai_token_usage
					WHERE date_created >= ? AND conversation IS NOT NULL
					GROUP BY conversation
				) conv_costs
			`, [sinceDate + 'T00:00:00.000Z']);

			const pr = convPercentiles.rows?.[0] || {};
			const p50 = parseFloat(pr.p50) || 0;
			const p95 = parseFloat(pr.p95) || 0;
			const max = parseFloat(pr.max) || 0;
			const avg = parseFloat(pr.avg) || 0;
			const sampleSize = parseInt(pr.sample_size, 10) || 0;

			// Token efficiency (output / input ratio)
			const tokenAgg = await db('ai_token_usage')
				.where(db.raw("DATE(date_created)"), '>=', sinceDate)
				.select(
					db.raw('COALESCE(SUM(input_tokens), 0) as total_input'),
					db.raw('COALESCE(SUM(output_tokens), 0) as total_output'),
				)
				.first();
			const totalInput = parseInt(tokenAgg?.total_input || '0', 10);
			const totalOutput = parseInt(tokenAgg?.total_output || '0', 10);
			const tokenEfficiency = totalInput > 0 ? +(totalOutput / totalInput).toFixed(3) : 0;

			// Budget utilization per account
			const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
			const monthlyLimit = parseFloat(env['MONTHLY_BUDGET_USD'] as string || '1000');
			const accountSpend = await db('ai_token_usage as u')
				.leftJoin('account as a', 'a.id', 'u.account')
				.where('u.date_created', '>=', monthStart)
				.groupBy('u.account', 'a.name')
				.select(
					'u.account as account_id',
					'a.name as account_name',
					db.raw('COALESCE(SUM(u.cost_usd), 0) as spent'),
				)
				.orderBy('spent', 'desc')
				.limit(20);

			// Top spenders
			const topSpenders = await db('ai_token_usage')
				.where('date_created', '>=', sinceDate + 'T00:00:00.000Z')
				.groupBy('account')
				.select('account as account_id', db.raw('COALESCE(SUM(cost_usd), 0) as total_cost'))
				.orderBy('total_cost', 'desc')
				.limit(10);

			res.json({
				daily_cost: dailyCost.map((d: any) => ({
					date: d.date,
					total_cost_usd: parseFloat(d.total_cost_usd) || 0,
					total_input_tokens: parseInt(d.total_input_tokens, 10) || 0,
					total_output_tokens: parseInt(d.total_output_tokens, 10) || 0,
				})),
				model_daily_cost: modelDailyCost.map((d: any) => ({
					date: d.date,
					model: d.model || 'unknown',
					cost: parseFloat(d.cost) || 0,
				})),
				cost_per_conversation: { p50, p95, max, avg: +avg.toFixed(6), sample_size: sampleSize },
				token_efficiency: tokenEfficiency,
				budget_utilization: accountSpend.map((r: any) => {
					const spent = parseFloat(r.spent) || 0;
					return {
						account_id: r.account_id,
						account_name: r.account_name || r.account_id,
						spent,
						limit: monthlyLimit,
						utilization_pct: monthlyLimit > 0 ? +(spent / monthlyLimit * 100).toFixed(1) : 0,
					};
				}),
				top_spenders: topSpenders.map((r: any) => ({
					account_id: r.account_id,
					total_cost: parseFloat(r.total_cost) || 0,
				})),
			});
		} catch (err: any) {
			logger.error(`GET /assistant/admin/cost-details: ${err.message}`);
			res.status(500).json({ errors: [{ message: 'Failed to fetch cost details' }] });
		}
	});

	app.get('/assistant/admin/quality-metrics', requireAuth, requireAdmin, async (_req: any, res: any) => {
		const proxied = await proxyToAiApi(_req, res, env, logger);
		if (proxied) return;
		try {
			const days = Math.min(Math.max(parseInt(_req.query?.days || '30', 10), 1), 365);
			const sinceDate = new Date(Date.now() - days * 86400000).toISOString();

			// Conversations by outcome
			const outcomes = await db('ai_conversations')
				.where('date_created', '>=', sinceDate)
				.groupBy('outcome')
				.select('outcome', db.raw('COUNT(*) as count'));

			// Daily conversation volume
			const dailyConvs = await db('ai_conversations')
				.where('date_created', '>=', sinceDate)
				.select(db.raw("DATE(date_created) as date"), db.raw('COUNT(*) as count'))
				.groupByRaw('DATE(date_created)')
				.orderBy('date', 'asc');

			// Response time percentiles via PostgreSQL PERCENTILE_CONT
			const rtPercentiles = await db.raw(`
				SELECT
					PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_time_ms) as p50,
					PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95,
					PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) as p99,
					COUNT(*) as sample_size
				FROM ai_token_usage
				WHERE response_time_ms IS NOT NULL AND date_created >= ?
			`, [sinceDate]);

			const rtp = rtPercentiles.rows?.[0] || {};
			const rtP50 = parseFloat(rtp.p50) || 0;
			const rtP95 = parseFloat(rtp.p95) || 0;
			const rtP99 = parseFloat(rtp.p99) || 0;
			const rtSampleSize = parseInt(rtp.sample_size, 10) || 0;

			// Tool call success rate
			const toolStats = await db('ai_token_usage')
				.whereNotNull('tool_calls')
				.where('date_created', '>=', sinceDate)
				.select('tool_calls');

			let totalCalls = 0;
			let errorCalls = 0;
			for (const row of toolStats) {
				const calls = typeof row.tool_calls === 'string' ? JSON.parse(row.tool_calls) : row.tool_calls;
				if (Array.isArray(calls)) {
					totalCalls += calls.length;
					errorCalls += calls.filter((c: any) => c.is_error).length;
				}
			}

			// Avg conversation length
			const convLengths = await db('ai_conversations')
				.where('date_created', '>=', sinceDate)
				.whereNotNull('messages')
				.select(db.raw("jsonb_array_length(messages::jsonb) as msg_count"));

			const msgCounts = convLengths.map((r: any) => parseInt(r.msg_count, 10) || 0).filter((n: number) => n > 0);
			const avgConvLength = msgCounts.length ? +(msgCounts.reduce((s: number, v: number) => s + v, 0) / msgCounts.length).toFixed(1) : 0;

			res.json({
				outcomes: outcomes.reduce((acc: any, o: any) => {
					acc[o.outcome || 'active'] = parseInt(o.count, 10);
					return acc;
				}, {}),
				daily_conversations: dailyConvs.map((d: any) => ({ date: d.date, count: parseInt(d.count, 10) })),
				response_time: { p50: rtP50, p95: rtP95, p99: rtP99, sample_size: rtSampleSize },
				tool_success: {
					total: totalCalls,
					errors: errorCalls,
					rate: totalCalls ? ((totalCalls - errorCalls) / totalCalls * 100).toFixed(1) : '100.0',
				},
				avg_conversation_length: avgConvLength,
			});
		} catch (err: any) {
			logger.error(`GET /assistant/admin/quality-metrics: ${err.message}`);
			res.status(500).json({ errors: [{ message: 'Failed to fetch quality metrics' }] });
		}
	});

	app.get('/assistant/admin/tool-analytics', requireAuth, requireAdmin, async (_req: any, res: any) => {
		const proxied = await proxyToAiApi(_req, res, env, logger);
		if (proxied) return;
		try {
			const days = Math.min(Math.max(parseInt(_req.query?.days || '30', 10), 1), 365);
			const sinceDate = new Date(Date.now() - days * 86400000).toISOString();

			const toolRows = await db('ai_token_usage')
				.whereNotNull('tool_calls')
				.where('date_created', '>=', sinceDate)
				.select('tool_calls');

			const toolMap: Record<string, { calls: number; errors: number; total_ms: number; durations: number[] }> = {};
			const cooccurrence: Record<string, number> = {};

			for (const row of toolRows) {
				const calls = typeof row.tool_calls === 'string' ? JSON.parse(row.tool_calls) : row.tool_calls;
				if (!Array.isArray(calls)) continue;

				for (const call of calls) {
					if (!toolMap[call.name]) toolMap[call.name] = { calls: 0, errors: 0, total_ms: 0, durations: [] };
					toolMap[call.name].calls++;
					if (call.is_error) toolMap[call.name].errors++;
					if (call.duration_ms) {
						toolMap[call.name].total_ms += call.duration_ms;
						toolMap[call.name].durations.push(call.duration_ms);
					}
				}

				// Sequential pairs (preserve call order)
				if (calls.length >= 2) {
					for (let i = 0; i < calls.length - 1; i++) {
						const key = `${calls[i].name} → ${calls[i + 1].name}`;
						cooccurrence[key] = (cooccurrence[key] || 0) + 1;
					}
				}
			}

			const tools = Object.entries(toolMap).map(([name, stats]) => {
				const sorted = [...stats.durations].sort((a, b) => a - b);
				return {
					name,
					calls: stats.calls,
					errors: stats.errors,
					error_rate: stats.calls ? (stats.errors / stats.calls * 100).toFixed(1) : '0.0',
					avg_ms: stats.calls ? Math.round(stats.total_ms / stats.calls) : 0,
					p95_ms: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
				};
			}).sort((a, b) => b.calls - a.calls);

			const topChains = Object.entries(cooccurrence)
				.map(([chain, count]) => ({ chain, count }))
				.sort((a, b) => b.count - a.count)
				.slice(0, 10);

			// TODO: derive from AI_TOOLS when available — keep in sync with ai-api/src/services/tools.js
			const allToolNames = AI_TOOLS.map((t: any) => t.name);
			const usedToolNames = new Set(Object.keys(toolMap));
			const unused = allToolNames.filter((t: string) => !usedToolNames.has(t));

			res.json({ tools, top_chains: topChains, unused_tools: unused });
		} catch (err: any) {
			logger.error(`GET /assistant/admin/tool-analytics: ${err.message}`);
			res.status(500).json({ errors: [{ message: 'Failed to fetch tool analytics' }] });
		}
	});

	app.get('/assistant/admin/model-performance', requireAuth, requireAdmin, async (_req: any, res: any) => {
		const proxied = await proxyToAiApi(_req, res, env, logger);
		if (proxied) return;
		try {
			const days = Math.min(Math.max(parseInt(_req.query?.days || '30', 10), 1), 365);
			const sinceDate = new Date(Date.now() - days * 86400000).toISOString();

			// Per-model aggregate stats
			const modelStats = await db('ai_token_usage')
				.where('date_created', '>=', sinceDate)
				.groupBy('model')
				.select(
					'model',
					db.raw('COUNT(*) as calls'),
					db.raw('COALESCE(SUM(input_tokens), 0) as input_tokens'),
					db.raw('COALESCE(SUM(output_tokens), 0) as output_tokens'),
					db.raw('COALESCE(SUM(cost_usd), 0) as cost_usd'),
					db.raw('COALESCE(AVG(response_time_ms), 0) as avg_response_ms'),
				)
				.orderBy('calls', 'desc');

			// Per-model latency percentiles
			const modelLatency = await db.raw(`
				SELECT
					model,
					PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_time_ms) as p50,
					PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95,
					PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) as p99
				FROM ai_token_usage
				WHERE response_time_ms IS NOT NULL AND date_created >= ?
				GROUP BY model
			`, [sinceDate]);

			const latencyByModel: Record<string, { p50: number; p95: number; p99: number }> = {};
			for (const r of (modelLatency.rows || [])) {
				latencyByModel[r.model] = {
					p50: parseFloat(r.p50) || 0,
					p95: parseFloat(r.p95) || 0,
					p99: parseFloat(r.p99) || 0,
				};
			}

			// Per-model task-type breakdown (derive from tool_calls)
			const toolRows = await db('ai_token_usage')
				.where('date_created', '>=', sinceDate)
				.select('model', 'tool_calls', 'cost_usd');

			const taskMap: Record<string, Record<string, { calls: number; cost: number }>> = {};
			const KB_TOOLS = new Set(['search_knowledge_base', 'ask_knowledge_base', 'kb_search', 'kb_ask']);
			const CALC_TOOLS = new Set(['execute_formula', 'execute_calculator', 'evaluate_formula', 'run_calculator']);

			for (const row of toolRows) {
				const model = row.model || 'unknown';
				if (!taskMap[model]) taskMap[model] = {};

				let taskType = 'general_chat';
				if (row.tool_calls) {
					const calls = typeof row.tool_calls === 'string' ? JSON.parse(row.tool_calls) : row.tool_calls;
					if (Array.isArray(calls) && calls.length > 0) {
						const toolNames = calls.map((c: any) => c.name || '');
						if (toolNames.some((n: string) => KB_TOOLS.has(n))) {
							taskType = 'knowledge';
						} else if (toolNames.some((n: string) => CALC_TOOLS.has(n))) {
							taskType = 'calculator';
						} else {
							taskType = 'tool_use';
						}
					}
				}

				if (!taskMap[model][taskType]) taskMap[model][taskType] = { calls: 0, cost: 0 };
				taskMap[model][taskType].calls++;
				taskMap[model][taskType].cost += parseFloat(row.cost_usd) || 0;
			}

			const taskBreakdown: Array<{ model: string; task_type: string; calls: number; cost_usd: number }> = [];
			for (const [model, types] of Object.entries(taskMap)) {
				for (const [task_type, stats] of Object.entries(types)) {
					taskBreakdown.push({ model, task_type, calls: stats.calls, cost_usd: +stats.cost.toFixed(6) });
				}
			}

			// Build models array with cost efficiency
			const models = modelStats.map((r: any) => {
				const calls = parseInt(r.calls, 10) || 0;
				const inputTokens = parseInt(r.input_tokens, 10) || 0;
				const outputTokens = parseInt(r.output_tokens, 10) || 0;
				const totalTokens = inputTokens + outputTokens;
				const costUsd = parseFloat(r.cost_usd) || 0;
				const lt = latencyByModel[r.model] || { p50: 0, p95: 0, p99: 0 };
				return {
					model: r.model || 'unknown',
					calls,
					input_tokens: inputTokens,
					output_tokens: outputTokens,
					total_tokens: totalTokens,
					cost_usd: +costUsd.toFixed(6),
					cost_per_1k_tokens: totalTokens > 0 ? +(costUsd / totalTokens * 1000).toFixed(6) : 0,
					avg_response_ms: Math.round(parseFloat(r.avg_response_ms) || 0),
					p50_ms: Math.round(lt.p50),
					p95_ms: Math.round(lt.p95),
					p99_ms: Math.round(lt.p99),
				};
			});

			// Summary
			const totalCalls = models.reduce((s: number, m: any) => s + m.calls, 0);
			const withCost = models.filter((m: any) => m.cost_per_1k_tokens > 0);
			const bestCostEfficiency = withCost.length
				? withCost.reduce((best: any, m: any) => m.cost_per_1k_tokens < best.cost_per_1k_tokens ? m : best).model
				: (models[0]?.model || 'none');
			const withLatency = models.filter((m: any) => m.p50_ms > 0);
			const fastestP50 = withLatency.length
				? withLatency.reduce((best: any, m: any) => m.p50_ms < best.p50_ms ? m : best).model
				: (models[0]?.model || 'none');

			res.json({
				models,
				task_breakdown: taskBreakdown,
				summary: {
					total_calls: totalCalls,
					models_used: models.length,
					best_cost_efficiency: bestCostEfficiency,
					fastest_model_p50: fastestP50,
				},
			});
		} catch (err: any) {
			logger.error(`GET /assistant/admin/model-performance: ${err.message}`);
			res.status(500).json({ errors: [{ message: 'Failed to fetch model performance' }] });
		}
	});

	app.get('/assistant/admin/retrieval-metrics', requireAuth, requireAdmin, async (_req: any, res: any) => {
		const proxied = await proxyToAiApi(_req, res, env, logger);
		if (proxied) return;
		try {
			const days = Math.min(Math.max(parseInt(_req.query?.days || '30', 10), 1), 365);
			const sinceDate = new Date(Date.now() - days * 86400000).toISOString();

			// Aggregate KPIs
			const kpis = await db.raw(`
				SELECT
					COUNT(*) FILTER (WHERE query_type = 'search') as total_searches,
					COUNT(*) FILTER (WHERE query_type = 'ask') as total_asks,
					AVG(avg_similarity) as avg_similarity,
					AVG(utilization_rate) FILTER (WHERE query_type = 'ask') as avg_utilization,
					AVG(CASE WHEN curated_answer_matched THEN 1.0 ELSE 0.0 END)
						FILTER (WHERE query_type = 'ask') as curated_hit_rate
				FROM ai_retrieval_quality
				WHERE created_at >= ?
			`, [sinceDate]);

			const k = kpis.rows?.[0] || {};

			// Daily volume
			const dailyVolume = await db.raw(`
				SELECT DATE(created_at) as date,
					COUNT(*) FILTER (WHERE query_type = 'search') as searches,
					COUNT(*) FILTER (WHERE query_type = 'ask') as asks
				FROM ai_retrieval_quality
				WHERE created_at >= ?
				GROUP BY DATE(created_at)
				ORDER BY date ASC
			`, [sinceDate]);

			// Similarity distribution (8 buckets: 0.2-0.3, 0.3-0.4, ..., 0.9-1.0)
			const simDist = await db.raw(`
				SELECT
					width_bucket(avg_similarity, 0.2, 1.0, 8) as bucket,
					COUNT(*) as count
				FROM ai_retrieval_quality
				WHERE avg_similarity IS NOT NULL AND created_at >= ?
				GROUP BY bucket
				ORDER BY bucket
			`, [sinceDate]);

			const bucketLabels = ['<0.2', '0.2-0.3', '0.3-0.4', '0.4-0.5', '0.5-0.6', '0.6-0.7', '0.7-0.8', '0.8-0.9', '0.9-1.0', '>1.0'];
			const similarityDistribution = (simDist.rows || []).map((r: any) => ({
				bucket: bucketLabels[parseInt(r.bucket, 10)] || `bucket-${r.bucket}`,
				count: parseInt(r.count, 10),
			}));

			// Confidence breakdown (ask only)
			const confRows = await db('ai_retrieval_quality')
				.where('query_type', 'ask')
				.where('created_at', '>=', sinceDate)
				.whereNotNull('confidence')
				.groupBy('confidence')
				.select('confidence', db.raw('COUNT(*) as count'));

			const confidenceBreakdown: Record<string, number> = {};
			for (const r of confRows) {
				confidenceBreakdown[r.confidence] = parseInt(r.count, 10);
			}

			// Per-KB performance
			const kbPerf = await db.raw(`
				SELECT
					rq.knowledge_base_id as kb_id,
					kb.name as kb_name,
					COUNT(*) FILTER (WHERE rq.query_type = 'search') as search_count,
					COUNT(*) FILTER (WHERE rq.query_type = 'ask') as ask_count,
					AVG(rq.avg_similarity) as avg_similarity,
					AVG(rq.utilization_rate) FILTER (WHERE rq.query_type = 'ask') as avg_utilization,
					AVG(CASE WHEN rq.curated_answer_matched THEN 1.0 ELSE 0.0 END)
						FILTER (WHERE rq.query_type = 'ask') as curated_hit_rate,
					AVG(rq.search_latency_ms) as avg_search_latency_ms
				FROM ai_retrieval_quality rq
				LEFT JOIN knowledge_bases kb ON kb.id = rq.knowledge_base_id
				WHERE rq.created_at >= ? AND rq.knowledge_base_id IS NOT NULL
				GROUP BY rq.knowledge_base_id, kb.name
				ORDER BY (COUNT(*) FILTER (WHERE rq.query_type = 'search') + COUNT(*) FILTER (WHERE rq.query_type = 'ask')) DESC
				LIMIT 20
			`, [sinceDate]);

			// Curated answer stats
			const curatedStats = await db.raw(`
				SELECT
					(SELECT COUNT(*) FROM kb_curated_answers) as total_curated,
					COUNT(*) FILTER (WHERE curated_answer_matched) as total_hits,
					COUNT(*) FILTER (WHERE curated_answer_mode = 'override') as override_count,
					COUNT(*) FILTER (WHERE curated_answer_mode = 'boost') as boost_count
				FROM ai_retrieval_quality
				WHERE created_at >= ? AND query_type = 'ask'
			`, [sinceDate]);

			const cs = curatedStats.rows?.[0] || {};

			// Search latency percentiles
			const latency = await db.raw(`
				SELECT
					PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY search_latency_ms) as p50,
					PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY search_latency_ms) as p95,
					PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY search_latency_ms) as p99,
					COUNT(*) as sample_size
				FROM ai_retrieval_quality
				WHERE search_latency_ms IS NOT NULL AND created_at >= ?
			`, [sinceDate]);

			const lt = latency.rows?.[0] || {};

			res.json({
				total_searches: parseInt(k.total_searches, 10) || 0,
				total_asks: parseInt(k.total_asks, 10) || 0,
				avg_similarity: parseFloat(k.avg_similarity) || 0,
				avg_context_utilization: parseFloat(k.avg_utilization) || 0,
				curated_hit_rate: parseFloat(k.curated_hit_rate) || 0,
				daily_volume: (dailyVolume.rows || []).map((r: any) => ({
					date: r.date,
					searches: parseInt(r.searches, 10) || 0,
					asks: parseInt(r.asks, 10) || 0,
				})),
				similarity_distribution: similarityDistribution,
				confidence_breakdown: confidenceBreakdown,
				kb_performance: (kbPerf.rows || []).map((r: any) => ({
					kb_id: r.kb_id,
					kb_name: r.kb_name || r.kb_id,
					search_count: parseInt(r.search_count, 10) || 0,
					ask_count: parseInt(r.ask_count, 10) || 0,
					avg_similarity: parseFloat(r.avg_similarity) || 0,
					avg_utilization: parseFloat(r.avg_utilization) || 0,
					curated_hit_rate: parseFloat(r.curated_hit_rate) || 0,
					avg_search_latency_ms: Math.round(parseFloat(r.avg_search_latency_ms) || 0),
				})),
				curated_stats: {
					total_curated: parseInt(cs.total_curated, 10) || 0,
					total_hits: parseInt(cs.total_hits, 10) || 0,
					override_count: parseInt(cs.override_count, 10) || 0,
					boost_count: parseInt(cs.boost_count, 10) || 0,
				},
				search_latency: {
					p50: parseFloat(lt.p50) || 0,
					p95: parseFloat(lt.p95) || 0,
					p99: parseFloat(lt.p99) || 0,
					sample_size: parseInt(lt.sample_size, 10) || 0,
				},
			});
		} catch (err: any) {
			logger.error(`GET /assistant/admin/retrieval-metrics: ${err.message}`);
			res.status(500).json({ errors: [{ message: 'Failed to fetch retrieval metrics' }] });
		}
	});
}
