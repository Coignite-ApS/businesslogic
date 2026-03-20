import { defineHook } from '@directus/extensions-sdk';
import { requireAuth, requireAdmin, requireActiveSubscription, requireAiQuota, getActiveAccount } from './auth.js';
import type { AiQuota } from './auth.js';
import { AiClient } from './ai-client.js';
import { resolveModel } from './model-router.js';
import { AI_TOOLS, executeTool } from './tools.js';
import { DEFAULT_SYSTEM_PROMPT } from './system-prompt.js';
import { createRateLimitMiddleware } from './rate-limit.js';
import { createSanitizeMiddleware } from './sanitize.js';
import type { ChatRequest, ConversationMessage, ContentBlock, DB } from './types.js';

function calculateCost(model: string, input: number, output: number): number {
	const rates: Record<string, { input: number; output: number }> = {
		'claude-sonnet-4-6': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
		'claude-opus-4-6': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
		'claude-haiku-4-5-20251001': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
	};
	const r = rates[model] || rates['claude-sonnet-4-6'];
	return +(input * r.input + output * r.output).toFixed(6);
}

export default defineHook(({ init }, { env, logger, database, services, getSchema }) => {
	const db: DB = database;

	const apiKey = env['ANTHROPIC_API_KEY'] as string | undefined;
	const aiEnabled = env['AI_ASSISTANT_ENABLED'] !== 'false';
	const maxToolRounds = parseInt(env['AI_MAX_TOOL_ROUNDS'] as string, 10) || 5;
	const maxConversationMessages = parseInt(env['AI_MAX_CONVERSATION_MESSAGES'] as string, 10) || 50;
	const formulaApiUrl = (env['FORMULA_API_URL'] as string || '').replace(/\/+$/, '');
	const formulaApiAdminToken = env['FORMULA_API_ADMIN_TOKEN'] as string || '';
	const encryptionKey = env['TOKEN_ENCRYPTION_KEY'] as string | undefined;
	const rateLimitPerMinute = parseInt(env['AI_RATE_LIMIT_PER_MINUTE'] as string, 10) || 20;
	const maxMessageLength = parseInt(env['AI_MAX_MESSAGE_LENGTH'] as string, 10) || 10_000;
	const maxConversations = parseInt(env['AI_MAX_CONVERSATIONS'] as string, 10) || 50;

	init('routes.custom.before', ({ app }: any) => {
		if (!aiEnabled) {
			logger.info('AI Assistant disabled');
			return;
		}

		if (!apiKey) {
			logger.warn('AI Assistant: ANTHROPIC_API_KEY not set — chat endpoint disabled');
		}

		const subMiddleware = requireActiveSubscription(db);
		const quotaMiddleware = requireAiQuota(db);
		const rateLimitMiddleware = createRateLimitMiddleware(rateLimitPerMinute);
		const sanitizeMiddleware = createSanitizeMiddleware(maxMessageLength);

		// ─── Conversation CRUD ─────────────────────────────────────────
		app.get('/assistant/conversations', requireAuth, subMiddleware, async (req: any, res: any) => {
			try {
				const schema = await getSchema();
				const { ItemsService } = services;
				const svc = new ItemsService('ai_conversations', { schema, accountability: req.accountability });
				const items = await svc.readByQuery({
					sort: ['-date_updated'],
					limit: 50,
					fields: ['id', 'title', 'status', 'model', 'total_input_tokens', 'total_output_tokens', 'date_created', 'date_updated'],
					filter: { status: { _neq: 'archived' } },
				});
				res.json({ data: items });
			} catch (err: any) {
				logger.error(`GET /ai/conversations: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to list conversations' }] });
			}
		});

		app.post('/assistant/conversations', requireAuth, subMiddleware, async (req: any, res: any) => {
			try {
				const schema = await getSchema();
				const { ItemsService } = services;
				const svc = new ItemsService('ai_conversations', { schema, accountability: req.accountability });

				// Check max active conversations (non-admin only)
				if (!req.accountability.admin) {
					const active = await svc.readByQuery({
						filter: { status: { _neq: 'archived' } },
						aggregate: { count: ['id'] },
					});
					const count = parseInt(active?.[0]?.count?.id || '0', 10);
					if (count >= maxConversations) {
						return res.status(429).json({
							errors: [{ message: `Conversation limit reached (${maxConversations}). Archive old conversations to continue.` }],
						});
					}
				}

				const id = await svc.createOne({
					title: req.body.title || null,
					messages: [],
					status: 'active',
					total_input_tokens: 0,
					total_output_tokens: 0,
				});
				const item = await svc.readOne(id);
				res.json({ data: item });
			} catch (err: any) {
				logger.error(`POST /ai/conversations: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to create conversation' }] });
			}
		});

		app.get('/assistant/conversations/:id', requireAuth, subMiddleware, async (req: any, res: any) => {
			try {
				const schema = await getSchema();
				const { ItemsService } = services;
				const svc = new ItemsService('ai_conversations', { schema, accountability: req.accountability });
				const item = await svc.readOne(req.params.id);
				res.json({ data: item });
			} catch (err: any) {
				if (err.status === 403) return res.status(403).json({ errors: [{ message: 'Access denied' }] });
				logger.error(`GET /ai/conversations/:id: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to get conversation' }] });
			}
		});

		app.patch('/assistant/conversations/:id', requireAuth, subMiddleware, async (req: any, res: any) => {
			try {
				const schema = await getSchema();
				const { ItemsService } = services;
				const svc = new ItemsService('ai_conversations', { schema, accountability: req.accountability });
				const allowed: Record<string, any> = {};
				if (req.body.title !== undefined) allowed.title = req.body.title;
				if (req.body.status !== undefined) allowed.status = req.body.status;
				await svc.updateOne(req.params.id, allowed);
				const item = await svc.readOne(req.params.id);
				res.json({ data: item });
			} catch (err: any) {
				if (err.status === 403) return res.status(403).json({ errors: [{ message: 'Access denied' }] });
				logger.error(`PATCH /ai/conversations/:id: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to update conversation' }] });
			}
		});

		app.delete('/assistant/conversations/:id', requireAuth, subMiddleware, async (req: any, res: any) => {
			try {
				const schema = await getSchema();
				const { ItemsService } = services;
				const svc = new ItemsService('ai_conversations', { schema, accountability: req.accountability });
				await svc.updateOne(req.params.id, { status: 'archived' });
				res.json({ data: { id: req.params.id, status: 'archived' } });
			} catch (err: any) {
				if (err.status === 403) return res.status(403).json({ errors: [{ message: 'Access denied' }] });
				logger.error(`DELETE /ai/conversations/:id: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to archive conversation' }] });
			}
		});

		// ─── Prompts ───────────────────────────────────────────────────
		app.get('/assistant/prompts', requireAuth, async (req: any, res: any) => {
			try {
				const schema = await getSchema();
				const { ItemsService } = services;
				const svc = new ItemsService('ai_prompts', { schema, accountability: req.accountability });
				const items = await svc.readByQuery({
					filter: { status: { _eq: 'published' } },
					sort: ['sort', 'name'],
					fields: ['id', 'name', 'description', 'icon', 'user_prompt_template', 'category'],
				});
				res.json({ data: items });
			} catch (err: any) {
				logger.error(`GET /ai/prompts: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to list prompts' }] });
			}
		});

		// ─── Model config (admin) ──────────────────────────────────────
		app.get('/assistant/model-config', requireAuth, requireAdmin, async (req: any, res: any) => {
			try {
				const schema = await getSchema();
				const { ItemsService } = services;
				const svc = new ItemsService('ai_model_config', { schema, accountability: req.accountability });
				const items = await svc.readByQuery({ sort: ['task_category'] });
				res.json({ data: items });
			} catch (err: any) {
				res.status(500).json({ errors: [{ message: 'Failed to list model config' }] });
			}
		});

		app.patch('/assistant/model-config/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
			try {
				const schema = await getSchema();
				const { ItemsService } = services;
				const svc = new ItemsService('ai_model_config', { schema, accountability: req.accountability });
				await svc.updateOne(req.params.id, req.body);
				const item = await svc.readOne(req.params.id);
				res.json({ data: item });
			} catch (err: any) {
				res.status(500).json({ errors: [{ message: 'Failed to update model config' }] });
			}
		});

		// ─── Usage ────────────────────────────────────────────────────
		app.get('/assistant/usage', requireAuth, subMiddleware, quotaMiddleware, async (req: any, res: any) => {
			try {
				const userId = req.accountability.user;
				const accountId = await getActiveAccount(db, userId);
				if (!accountId) {
					return res.status(403).json({ errors: [{ message: 'No active account' }] });
				}

				const quota: AiQuota = req.aiQuota;
				const periodStart = quota.periodStart.toISOString();

				// Aggregate token usage for current period
				const agg = await db('ai_token_usage')
					.where('account', accountId)
					.where('date_created', '>=', periodStart)
					.select(
						db.raw('COUNT(*) as query_count'),
						db.raw('COALESCE(SUM(input_tokens), 0) as total_input'),
						db.raw('COALESCE(SUM(output_tokens), 0) as total_output'),
						db.raw('COALESCE(SUM(cost_usd), 0) as total_cost'),
					)
					.first();

				res.json({
					data: {
						queries_used: parseInt(agg?.query_count || '0', 10),
						queries_limit: quota.queriesLimit,
						tokens_used: {
							input: parseInt(agg?.total_input || '0', 10),
							output: parseInt(agg?.total_output || '0', 10),
						},
						cost_usd: parseFloat(agg?.total_cost || '0'),
						period_start: quota.periodStart.toISOString(),
						period_end: quota.periodEnd.toISOString(),
					},
				});
			} catch (err: any) {
				logger.error(`GET /assistant/usage: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to get usage' }] });
			}
		});

		// ─── Chat (SSE) ────────────────────────────────────────────────
		app.post('/assistant/chat', requireAuth, subMiddleware, quotaMiddleware, rateLimitMiddleware, sanitizeMiddleware, async (req: any, res: any) => {
			if (!apiKey) {
				return res.status(503).json({ errors: [{ message: 'AI Assistant not configured' }] });
			}

			const { conversation_id, message, prompt_id } = req.body as ChatRequest;
			if (!message?.trim()) {
				return res.status(400).json({ errors: [{ message: 'Message is required' }] });
			}

			const userId = req.accountability.user;
			const accountId = await getActiveAccount(db, userId);
			if (!accountId) {
				return res.status(403).json({ errors: [{ message: 'No active account' }] });
			}

			// Set SSE headers
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
				'X-Accel-Buffering': 'no',
			});

			const sendSSE = (event: string, data: any) => {
				res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
				if (typeof res.flush === 'function') res.flush();
			};

			// Abort handling
			const abortController = new AbortController();
			let clientDisconnected = false;
			req.on('close', () => {
				clientDisconnected = true;
				abortController.abort();
			});

			try {
				const schema = await getSchema();
				const { ItemsService } = services;

				// Load or create conversation
				let conversationId = conversation_id;
				let messages: ConversationMessage[] = [];

				if (conversationId) {
					const convSvc = new ItemsService('ai_conversations', { schema, accountability: req.accountability });
					try {
						const conv = await convSvc.readOne(conversationId);
						messages = conv.messages || [];
					} catch {
						return sendSSE('error', { message: 'Conversation not found' }), res.end();
					}
				} else {
					// Create new conversation
					const convSvc = new ItemsService('ai_conversations', { schema, accountability: req.accountability });
					conversationId = await convSvc.createOne({
						title: message.slice(0, 100),
						messages: [],
						status: 'active',
						total_input_tokens: 0,
						total_output_tokens: 0,
					});
					sendSSE('conversation_created', { id: conversationId });
				}

				// Load system prompt (from ai_prompts or default)
				let systemPrompt = DEFAULT_SYSTEM_PROMPT;
				if (prompt_id) {
					try {
						const promptSvc = new ItemsService('ai_prompts', { schema, accountability: req.accountability });
						const prompt = await promptSvc.readOne(prompt_id);
						if (prompt?.system_prompt) {
							systemPrompt = prompt.system_prompt;
						}
					} catch {
						// Use default
					}
				}

				// Add user message
				messages.push({ role: 'user', content: message });

				// Trim to max
				if (messages.length > maxConversationMessages) {
					messages = messages.slice(-maxConversationMessages);
				}

				// Resolve model
				const modelConfig = await resolveModel(db, 'execute', {
					defaultModel: env['AI_DEFAULT_MODEL'] as string,
					allowedModels: env['AI_ALLOWED_MODELS'] as string,
				});

				// Plan-based model restriction
				const quota: AiQuota | undefined = req.aiQuota;
				if (quota?.allowedModels && quota.allowedModels.length > 0) {
					if (!quota.allowedModels.includes(modelConfig.model)) {
						const original = modelConfig.model;
						modelConfig.model = quota.allowedModels[0];
						logger.info(`AI model downgrade: ${original} → ${modelConfig.model} (plan restriction)`);
					}
				}

				const client = new AiClient(apiKey);
				const authToken = req.headers.authorization || '';
				let totalInputTokens = 0;
				let totalOutputTokens = 0;

				// Tool loop
				for (let round = 0; round < maxToolRounds; round++) {
					if (clientDisconnected) break;

					let assistantText = '';
					let toolUses: { id: string; name: string; input: any }[] = [];
					let currentToolJson = '';
					let currentToolInfo: { id: string; name: string } | null = null;
					let stopReason: string | null = null;

					const stream = client.streamChat({
						model: modelConfig.model,
						systemPrompt,
						messages,
						tools: AI_TOOLS,
						maxOutputTokens: modelConfig.maxOutputTokens,
						signal: abortController.signal,
					});

					for await (const event of stream) {
						if (clientDisconnected) break;

						switch (event.type) {
							case 'text_delta':
								assistantText += event.data.text;
								sendSSE('text_delta', { text: event.data.text });
								break;

							case 'tool_use_start':
								currentToolInfo = event.data;
								currentToolJson = '';
								sendSSE('tool_use_start', { name: event.data.name });
								break;

							case 'tool_use_delta':
								currentToolJson += event.data.partial_json;
								break;

							case 'tool_use_stop':
								// Handled via message_stop content
								break;

							case 'usage':
								totalInputTokens += event.data.input_tokens || 0;
								totalOutputTokens += event.data.output_tokens || 0;
								break;

							case 'message_stop':
								stopReason = event.data.stop_reason;
								// Extract tool_use blocks from final content
								const content = event.data.content || [];
								for (const block of content) {
									if (block.type === 'tool_use') {
										toolUses.push({ id: block.id, name: block.name, input: block.input });
									}
								}
								break;

							case 'error':
								sendSSE('error', { message: event.data.message });
								break;
						}
					}

					if (clientDisconnected) break;

					// Build assistant message content
					const assistantContent: ContentBlock[] = [];
					if (assistantText) {
						assistantContent.push({ type: 'text', text: assistantText });
					}
					for (const tu of toolUses) {
						assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
					}

					if (assistantContent.length > 0) {
						messages.push({ role: 'assistant', content: assistantContent });
					}

					// If no tool calls or stop reason isn't tool_use, we're done
					if (toolUses.length === 0 || stopReason !== 'tool_use') {
						break;
					}

					// Execute tools and add results
					const toolResults: ContentBlock[] = [];
					for (const tu of toolUses) {
						sendSSE('tool_executing', { name: tu.name, id: tu.id });

						const { result, isError } = await executeTool(tu.name, tu.input, {
							db,
							accountId,
							formulaApiUrl,
							formulaApiAdminToken,
							encryptionKey,
							authToken,
							logger,
						});

						const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
						toolResults.push({
							type: 'tool_result',
							tool_use_id: tu.id,
							content: resultStr,
							is_error: isError,
						});

						sendSSE('tool_result', {
							name: tu.name,
							id: tu.id,
							result,
							is_error: isError,
						});
					}

					messages.push({ role: 'user', content: toolResults });
				}

				// Save conversation
				if (!clientDisconnected) {
					try {
						// Use admin service to bypass permissions for message saving
						const adminSvc = new ItemsService('ai_conversations', { schema, knex: db });
						// Read current totals first to avoid db.raw() circular reference issue with Redis pub/sub
						const current = await adminSvc.readOne(conversationId, { fields: ['total_input_tokens', 'total_output_tokens'] });
						await adminSvc.updateOne(conversationId, {
							messages,
							model: modelConfig.model,
							total_input_tokens: (current.total_input_tokens || 0) + totalInputTokens,
							total_output_tokens: (current.total_output_tokens || 0) + totalOutputTokens,
						});
					} catch (err: any) {
						logger.error(`Failed to save conversation: ${err.message}`);
					}

					// Insert token usage
					try {
						const usageSvc = new ItemsService('ai_token_usage', { schema, knex: db });
						await usageSvc.createOne({
							account: accountId,
							conversation: conversationId,
							model: modelConfig.model,
							task_category: 'execute',
							input_tokens: totalInputTokens,
							output_tokens: totalOutputTokens,
							cost_usd: calculateCost(modelConfig.model, totalInputTokens, totalOutputTokens),
						});
					} catch (err: any) {
						logger.error(`Failed to record token usage: ${err.message}`);
					}

					sendSSE('done', {
						conversation_id: conversationId,
						usage: {
							input_tokens: totalInputTokens,
							output_tokens: totalOutputTokens,
							model: modelConfig.model,
						},
					});
				}
			} catch (err: any) {
				logger.error(`POST /ai/chat: ${err.message}`);
				if (!clientDisconnected) {
					sendSSE('error', { message: 'An unexpected error occurred' });
				}
			} finally {
				if (!clientDisconnected) {
					res.end();
				}
			}
		});

		// ─── Admin Dashboard API ──────────────────────────────────────
		app.get('/assistant/admin/overview', requireAuth, requireAdmin, async (_req: any, res: any) => {
			try {
				const now = new Date();
				const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
				const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
				const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

				// Queries today
				const [todayAgg] = await db('ai_token_usage')
					.where('date_created', '>=', todayStart)
					.select(db.raw('COUNT(*) as cnt'));
				const queriesToday = parseInt(todayAgg?.cnt || '0', 10);

				// Queries + cost this month
				const [monthAgg] = await db('ai_token_usage')
					.where('date_created', '>=', monthStart)
					.select(
						db.raw('COUNT(*) as cnt'),
						db.raw('COALESCE(SUM(input_tokens), 0) as input_tokens'),
						db.raw('COALESCE(SUM(output_tokens), 0) as output_tokens'),
						db.raw('COALESCE(SUM(cost_usd), 0) as cost'),
					);

				// Top models
				const topModels = await db('ai_token_usage')
					.where('date_created', '>=', monthStart)
					.groupBy('model')
					.select(
						'model',
						db.raw('COUNT(*) as queries'),
						db.raw('COALESCE(SUM(cost_usd), 0) as cost'),
					)
					.orderBy('queries', 'desc')
					.limit(10);

				// Queries per day (30 days)
				const perDay = await db('ai_token_usage')
					.where('date_created', '>=', thirtyDaysAgo)
					.select(
						db.raw("DATE(date_created) as date"),
						db.raw('COUNT(*) as queries'),
						db.raw('COALESCE(SUM(cost_usd), 0) as cost'),
					)
					.groupByRaw('DATE(date_created)')
					.orderBy('date', 'asc');

				res.json({
					queries_today: queriesToday,
					queries_month: parseInt(monthAgg?.cnt || '0', 10),
					cost_month: parseFloat(monthAgg?.cost || '0'),
					tokens_month: {
						input: parseInt(monthAgg?.input_tokens || '0', 10),
						output: parseInt(monthAgg?.output_tokens || '0', 10),
					},
					period_start: monthStart,
					top_models: topModels.map((m: any) => ({
						model: m.model,
						queries: parseInt(m.queries, 10),
						cost: parseFloat(m.cost),
					})),
					queries_per_day: perDay.map((d: any) => ({
						date: d.date,
						queries: parseInt(d.queries, 10),
						cost: parseFloat(d.cost),
					})),
				});
			} catch (err: any) {
				logger.error(`GET /assistant/admin/overview: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to load AI overview' }] });
			}
		});

		app.get('/assistant/admin/accounts', requireAuth, requireAdmin, async (_req: any, res: any) => {
			try {
				const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

				const rows = await db('ai_token_usage as u')
					.leftJoin('account as a', 'a.id', 'u.account')
					.where('u.date_created', '>=', monthStart)
					.groupBy('u.account', 'a.name')
					.select(
						'u.account as account_id',
						'a.name as account_name',
						db.raw('COUNT(*) as queries'),
						db.raw('COALESCE(SUM(u.input_tokens), 0) as input_tokens'),
						db.raw('COALESCE(SUM(u.output_tokens), 0) as output_tokens'),
						db.raw('COALESCE(SUM(u.cost_usd), 0) as cost'),
					)
					.orderBy('queries', 'desc')
					.limit(50);

				res.json(rows.map((r: any) => ({
					account_id: r.account_id,
					account_name: r.account_name || r.account_id,
					queries: parseInt(r.queries, 10),
					input_tokens: parseInt(r.input_tokens, 10),
					output_tokens: parseInt(r.output_tokens, 10),
					cost: parseFloat(r.cost),
				})));
			} catch (err: any) {
				logger.error(`GET /assistant/admin/accounts: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to load AI account usage' }] });
			}
		});

		logger.info('AI Assistant routes registered');
	});
});
