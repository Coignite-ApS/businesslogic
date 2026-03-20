import { defineHook } from '@directus/extensions-sdk';
import { FlowTriggerClient, TriggerApiError } from './trigger-client.js';
import type { DB, ValidateRequest } from './types.js';

function requireAuth(req: any, res: any, next: () => void) {
	if (!req.accountability?.user && !req.accountability?.role) {
		return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
	}
	next();
}

export default defineHook(({ init, filter }, { env, logger, database }) => {
	const db: DB = database;
	const triggerUrl = env['FLOW_TRIGGER_URL'] as string | undefined;

	if (!triggerUrl) {
		logger.warn('FLOW_TRIGGER_URL not set — flow hooks disabled');
		return;
	}

	const adminToken = env['FLOW_TRIGGER_ADMIN_TOKEN'] as string | undefined;
	const client = new FlowTriggerClient(triggerUrl, adminToken);

	// ─── Sync node types on startup ─────────────────────────

	init('app.after', async () => {
		try {
			const nodeTypes = await client.getNodeTypes();

			for (const nt of nodeTypes) {
				const row = {
					id: nt.id,
					name: nt.name,
					description: nt.description,
					category: nt.category,
					tier: nt.tier,
					inputs: JSON.stringify(nt.inputs),
					outputs: JSON.stringify(nt.outputs),
					config_schema: JSON.stringify(nt.config_schema),
					estimated_cost_usd: nt.estimated_cost_usd,
					required_role: nt.required_role,
				};

				// Upsert: insert or update on conflict
				await db('bl_node_types')
					.insert(row)
					.onConflict('id')
					.merge();
			}

			logger.info(`Flow hooks: synced ${nodeTypes.length} node types`);
		} catch (err) {
			logger.error(`Flow hooks: failed to sync node types: ${err}`);
		}
	});

	// ─── Proxy routes ───────────────────────────────────────

	init('routes.custom.before', ({ app }) => {

		// GET /flow/trigger-url — expose trigger URL to frontend
		app.get('/flow/trigger-url', requireAuth, (_req: any, res: any) => {
			return res.json({ url: triggerUrl });
		});

		// GET /flow/health — proxy flow-trigger health
		app.get('/flow/health', requireAuth, async (_req: any, res: any) => {
			try {
				const result = await client.getHealth();
				return res.status(result.status).json(result.body);
			} catch (err) {
				return handleError(err, res);
			}
		});

		// POST /flow/validate — proxy graph validation
		app.post('/flow/validate', requireAuth, async (req: any, res: any) => {
			try {
				const result = await client.validate(req.body as ValidateRequest);
				return res.json(result);
			} catch (err) {
				return handleError(err, res);
			}
		});

		// POST /flow/trigger/:flowId — trigger flow execution
		app.post('/flow/trigger/:flowId', requireAuth, async (req: any, res: any) => {
			try {
				// Inject account_id from user's active account
				const user = await db('directus_users')
					.where('id', req.accountability.user)
					.select('active_account')
					.first();
				const accountId = user?.active_account || undefined;

				const result = await client.trigger(req.params.flowId, req.body, accountId);
				return res.status(result.status).json(result.body);
			} catch (err) {
				return handleError(err, res);
			}
		});

		// GET /flow/executions/:id — get execution details
		app.get('/flow/executions/:id', requireAuth, async (req: any, res: any) => {
			try {
				const include = req.query.include as string | undefined;
				const result = await client.getExecution(req.params.id, include);
				return res.status(result.status).json(result.body);
			} catch (err) {
				return handleError(err, res);
			}
		});

		// GET /flow/executions/:id/stream — SSE proxy
		app.get('/flow/executions/:id/stream', requireAuth, async (req: any, res: any) => {
			try {
				const streamUrl = client.streamUrl(req.params.id);
				const upstream = await fetch(streamUrl, {
					headers: adminToken ? { 'X-Admin-Token': adminToken } : {},
				});

				if (!upstream.ok || !upstream.body) {
					return res.status(upstream.status).json({ error: 'SSE connection failed' });
				}

				res.setHeader('Content-Type', 'text/event-stream');
				res.setHeader('Cache-Control', 'no-cache');
				res.setHeader('Connection', 'keep-alive');
				res.flushHeaders();

				const reader = upstream.body.getReader();
				const decoder = new TextDecoder();

				const pump = async () => {
					try {
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							res.write(decoder.decode(value, { stream: true }));
							if (typeof res.flush === 'function') res.flush();
						}
					} catch {
						// client disconnected
					} finally {
						res.end();
					}
				};

				req.on('close', () => {
					reader.cancel().catch(() => {});
				});

				pump();
			} catch (err) {
				return handleError(err, res);
			}
		});

		// GET /flow/flows/:flowId/executions — list executions for a flow
		app.get('/flow/flows/:flowId/executions', requireAuth, async (req: any, res: any) => {
			try {
				const user = await db('directus_users')
					.where('id', req.accountability.user)
					.select('active_account')
					.first();

				const result = await client.getFlowExecutions(req.params.flowId, {
					limit: parseInt(req.query.limit, 10) || undefined,
					offset: parseInt(req.query.offset, 10) || undefined,
					status: req.query.status || undefined,
					account_id: user?.active_account || undefined,
				});
				return res.status(result.status).json(result.body);
			} catch (err) {
				return handleError(err, res);
			}
		});

		logger.info('Flow hooks: proxy routes registered');
	});

	// ─── Filter: validate graph on save ─────────────────────

	filter('bl_flows.items.create', async (payload: any) => {
		if (payload.graph) {
			await validateGraph(payload.graph);
		}
		return payload;
	});

	filter('bl_flows.items.update', async (payload: any) => {
		if (payload.graph) {
			await validateGraph(payload.graph);
		}
		return payload;
	});

	async function validateGraph(graph: any) {
		try {
			const result = await client.validate({ graph, caller_role: 'Admin' });
			if (!result.valid) {
				const { ForbiddenError } = await import('@directus/errors');
				throw new ForbiddenError(result.errors.join('; '));
			}
		} catch (err) {
			if ((err as any)?.name === 'ForbiddenError') throw err;
			// If trigger service is down, allow save (degrade gracefully)
			logger.warn(`Flow hooks: graph validation skipped (trigger unreachable): ${err}`);
		}
	}

	function handleError(err: unknown, res: any) {
		if (err instanceof TriggerApiError) {
			return res.status(err.status).json(err.body);
		}
		logger.error(`Flow hooks: ${err}`);
		return res.status(502).json({ errors: [{ message: 'Flow trigger service unavailable' }] });
	}
});
