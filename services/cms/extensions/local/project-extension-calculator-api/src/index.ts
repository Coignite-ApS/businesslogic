import { defineHook } from '@directus/extensions-sdk';
import { randomUUID } from 'node:crypto';
import { FormulaApiClient, FormulaApiError, FormulaApiGoneError } from './formula-api.js';
import { requireAuth, requireAdmin, requireCalculatorAccess, requireActiveSubscription, getSubscriptionInfo, parseCalcId } from './auth.js';
import { handleFormulaApiError, buildPayload, buildRecipe, configIsComplete, toSnakeCase, buildMcpInputSchema, buildMcpSnippets, lookupCalculatorConfig } from './helpers.js';
import { registerAdminRoutes } from './admin-routes.js';
import { encrypt, decrypt, isEncrypted } from './crypto.js';
import type { CalculatorConfig, DB } from './types.js';

/** Strip internal fields from describe response (mapping, available_data) */
function stripDescribeInternals(body: unknown): unknown {
	if (!body || typeof body !== 'object') return body;
	const data = body as Record<string, any>;
	const result = { ...data };
	delete result.available_data;
	for (const key of ['expected_input', 'expected_output']) {
		const schema = result[key];
		if (schema?.properties && typeof schema.properties === 'object') {
			const cleaned: Record<string, any> = {};
			for (const [k, v] of Object.entries(schema.properties as Record<string, any>)) {
				const { mapping, ...rest } = v;
				cleaned[k] = rest;
			}
			result[key] = { ...schema, properties: cleaned };
		}
	}
	return result;
}

/** Get config by calculator ID + test_environment */
async function getConfigByCalcId(db: DB, calcId: string): Promise<CalculatorConfig | undefined> {
	const { calculatorId, isTest } = parseCalcId(calcId);
	return db('calculator_configs')
		.where('calculator', calculatorId)
		.where('test_environment', isTest)
		.first();
}

/** Get calculator metadata by calculator ID */
async function getCalculatorMeta(db: DB, calculatorId: string) {
	return db('calculators')
		.where('id', calculatorId)
		.select('id as calculator_id', 'name', 'description', 'account as account_id')
		.first();
}

/** Compute the Formula API calculator ID for a config */
function formulaApiId(calculatorId: string, isTest: boolean): string {
	return isTest ? `${calculatorId}-test` : calculatorId;
}

export default defineHook(({ init, action, filter, schedule }, { env, logger, database, services, getSchema }) => {
	const db = database;
	const encryptionKey = env['TOKEN_ENCRYPTION_KEY'] as string | undefined;

	/** Encrypt a token value if encryption key is available */
	function encryptToken(value: string): string {
		if (!encryptionKey) return value;
		if (isEncrypted(value)) return value;
		return encrypt(value, encryptionKey);
	}

	/** Decrypt a token value if it's encrypted */
	function decryptToken(value: string | null | undefined): string | undefined {
		if (!value) return undefined;
		if (!isEncrypted(value)) return value; // plaintext fallback
		if (!encryptionKey) {
			logger.warn('Cannot decrypt token — TOKEN_ENCRYPTION_KEY not set');
			return undefined;
		}
		return decrypt(value, encryptionKey);
	}

	/** Decrypt api_key in a config object for passing to Formula API */
	function withDecryptedKey<T extends { api_key?: string | null }>(config: T): T {
		return { ...config, api_key: decryptToken(config.api_key) || null };
	}

	// ─── Calculator suite routes (stats + recipes + accounts) ──────────

	init('routes.custom.before', ({ app }) => {

		// Register admin dashboard routes
		registerAdminRoutes(app, db, logger);

		// GET /accounts/:accountId — return account rate limits + usage for Formula API
		app.get('/accounts/:accountId', async (req: any, res: any) => {
			if (!req.accountability?.user && !req.accountability?.role) {
				return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
			}

			const { accountId } = req.params;

			try {
				// Verify account exists
				const account = await db('account').where('id', accountId).first('id');
				if (!account) {
					return res.status(404).json({ errors: [{ message: 'Account not found' }] });
				}

				// Fetch subscription plan limits
				const sub = await db('subscriptions as s')
					.join('subscription_plans as sp', 's.plan', 'sp.id')
					.where('s.account', accountId)
					.where('s.status', 'active')
					.first('sp.calls_per_second', 'sp.calls_per_month');

				const rateLimitRps = sub?.calls_per_second ?? null;
				const rateLimitMonthly = sub?.calls_per_month ?? null;

				// Count calculator_calls this month for this account
				const now = new Date();
				const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

				const { count } = await db('calculator_calls')
					.where('account', accountId)
					.where('timestamp', '>=', firstOfMonth)
					.count('* as count')
					.first() as any;

				return res.json({
					rateLimitRps,
					rateLimitMonthly,
					monthlyUsed: parseInt(count, 10) || 0,
				});
			} catch (err: any) {
				logger.error(`Account lookup failed for ${accountId}: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Account lookup failed' }] });
			}
		});

		// GET /management/calc/recipes/:id — return calculator recipe for Formula API restore
		// Uses Directus ItemsService so collection permissions are enforced
		app.get('/management/calc/recipes/:id', async (req: any, res: any) => {
			if (!req.accountability?.user && !req.accountability?.role) {
				return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
			}

			const { id } = req.params;

			try {
				const result = await lookupCalculatorConfig(
					id, services, getSchema, db, req.accountability,
					['sheets', 'formulas', 'input', 'output', 'api_key', 'test_environment', 'config_version', 'file_version', 'expressions'],
				);

				if ('error' in result) {
					return res.status(result.status).json({ error: result.error });
				}

				const { calc, config } = result;
				return res.json(buildRecipe({
					...config,
					api_key: decryptToken(config.api_key) || null,
					calculator_id: calc.id,
					name: calc.name,
					description: calc.description,
					account_id: calc.account,
				}));
			} catch (err: any) {
				if (err.status === 403) {
					return res.status(403).json({ errors: [{ message: 'Access denied' }] });
				}
				logger.error(`Recipe lookup failed for ${id}: ${err}`);
				return res.status(500).json({ error: 'Recipe lookup failed' });
			}
		});

		// GET /management/calc/mcp-config/:id — return MCP configuration for Formula API
		app.get('/management/calc/mcp-config/:id', async (req: any, res: any) => {
			if (!req.accountability?.user && !req.accountability?.role) {
				return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
			}

			const { id } = req.params;

			try {
				const result = await lookupCalculatorConfig(
					id, services, getSchema, db, req.accountability,
					['input', 'mcp'],
				);

				if ('error' in result) {
					return res.status(result.status).json({ error: result.error });
				}

				const { config, isTest } = result;
				const calc = result.calc;
				const calcId = isTest ? `${calc.id}-test` : calc.id;

				if (!config.mcp) {
					return res.json({ calculatorId: calcId, mcp: null });
				}

				if (!config.mcp.enabled) {
					return res.json({ calculatorId: calcId, mcp: { enabled: false } });
				}

				return res.json({
					calculatorId: calcId,
					mcp: {
						enabled: true,
						toolName: config.mcp.toolName,
						toolDescription: config.mcp.toolDescription || null,
						inputSchema: buildMcpInputSchema(config.input as Record<string, unknown>, config.mcp.parameterDescriptions),
						responseTemplate: config.mcp.responseTemplate || null,
					},
				});
			} catch (err: any) {
				if (err.status === 403) {
					return res.status(403).json({ errors: [{ message: 'Access denied' }] });
				}
				logger.error(`MCP config lookup failed for ${id}: ${err}`);
				return res.status(500).json({ error: 'MCP config lookup failed' });
			}
		});

		// POST /management/calc/stats — record calculator call(s)
		app.post('/management/calc/stats', async (req: any, res: any) => {
			if (!req.accountability?.user && !req.accountability?.role) {
				return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
			}

			try {
				const { ItemsService } = services;
				const itemsService = new ItemsService('calculator_calls', {
					schema: await getSchema(),
					accountability: req.accountability,
				});

				const pick = (item: any) => {
					const rawId: string = item.calculator_id || item.calculator || '';
					return {
						calculator: rawId.replace(/-test$/, ''),
						timestamp: item.timestamp,
						response_time_ms: item.response_time_ms,
						error: item.error,
						cached: item.cached,
						error_message: item.error_message,
						test: item.test ?? rawId.endsWith('-test'),
						type: item.type || 'calculator',
						account: item.account || null,
					};
				};

				const items = Array.isArray(req.body) ? req.body : [req.body];
				const keys = await itemsService.createMany(items.map(pick));

				return res.status(201).json({ ids: keys });
			} catch (err: any) {
				const status = err.status || 500;
				const message = err.message || 'Failed to record call';
				return res.status(status).json({ errors: [{ message }] });
			}
		});
	});

	// ─── Formula API proxy ───────────────────────────────────

	const gwUrl = ((env['GATEWAY_URL'] as string) || '').replace(/\/+$/, '');
	const gwSecret = env['GATEWAY_INTERNAL_SECRET'] as string | undefined;
	if (!gwUrl) {
		logger.warn('GATEWAY_URL not set — calculator API proxy disabled');
		return;
	}

	const apiUrl = `${gwUrl}/internal/calc`;
	const client = new FormulaApiClient(apiUrl, gwSecret);

	init('routes.custom.before', ({ app }) => {

		// GET /calc/formula-api-url — expose public Formula API URL to frontend (for code snippets)
		const publicApiUrl = (env['FORMULA_API_PUBLIC_URL'] as string) || (env['FORMULA_API_URL'] as string) || apiUrl;
		app.get('/calc/formula-api-url', requireAuth, (_req: any, res: any) => {
			return res.json({ url: publicApiUrl });
		});

		// GET /calc/health — proxy Formula API health (admin only)
		app.get('/calc/health', requireAuth, requireAdmin, async (_req: any, res: any) => {
			try {
				const result = await client.getHealth();
				return res.status(result.status).json(result.body);
			} catch (err) {
				return handleFormulaApiError(err, res);
			}
		});

		// GET /calc/server-stats — proxy Formula API server stats (admin only, cluster metrics)
		app.get('/calc/server-stats', requireAuth, requireAdmin, async (_req: any, res: any) => {
			try {
				const result = await client.getServerStats();
				return res.status(result.status).json(result.body);
			} catch (err) {
				return handleFormulaApiError(err, res);
			}
		});

		// GET /calc/my-ip — return requester's IP address
		app.get('/calc/my-ip', requireAuth, (req: any, res: any) => {
			const ip = req.ip?.replace(/^::ffff:/, '') || null;
			return res.json({ ip });
		});

		// GET /calc/subscription-info — return calculator limit info for active account
		app.get('/calc/subscription-info', requireAuth, async (req: any, res: any) => {
			try {
				const user = await db('directus_users').where('id', req.accountability.user).select('active_account').first();
				if (!user?.active_account) {
					return res.status(400).json({ errors: [{ message: 'No active account' }] });
				}
				const info = await getSubscriptionInfo(db, user.active_account);
				return res.json(info);
			} catch (err: any) {
				logger.error(`Subscription info failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to fetch subscription info' }] });
			}
		});

		// POST /calc/enable-test/:calcId — enable 6h test window
		app.post('/calc/enable-test/:calcId', requireAuth, requireCalculatorAccess(db), async (req: any, res: any) => {
			const { calcId } = req.params;
			const { calculatorId } = parseCalcId(calcId);
			try {
				const now = new Date();
				const expiresAt = new Date(now.getTime() + 6 * 60 * 60 * 1000);

				await db('calculators').where('id', calculatorId).update({
					test_enabled_at: now.toISOString(),
					test_expires_at: expiresAt.toISOString(),
				});

				// Deploy test config if complete
				const config = await getConfigByCalcId(db, `${calculatorId}-test`);
				if (config && configIsComplete(config)) {
					const meta = await getCalculatorMeta(db, calculatorId);
					let uf: any = null;
					try {
						const result = await client.updateCalculator(`${calculatorId}-test`, buildPayload(withDecryptedKey(config), meta));
						const body = result.body as any;
						if (body?.profile) await db('calculator_configs').where('id', config.id).update({ profile: JSON.stringify(body.profile) });
						uf = body?.unresolvedFunctions || null;
					} catch (err) {
						if (err instanceof FormulaApiGoneError) {
							const createResult = await client.createCalculator(buildPayload(withDecryptedKey(config), meta));
							if (createResult.profile) await db('calculator_configs').where('id', config.id).update({ profile: JSON.stringify(createResult.profile) });
							uf = (createResult as any).unresolvedFunctions || null;
						} else throw err;
					}
					await db('calculator_configs').where('id', config.id).update({ unresolved_functions: uf ? JSON.stringify(uf) : null });
					client.refreshMcpCache(`${calculatorId}-test`).catch(() => {});
				}

				return res.json({ test_expires_at: expiresAt.toISOString() });
			} catch (err: any) {
				if (err instanceof FormulaApiError) return handleFormulaApiError(err, res);
				logger.error(`Enable test failed for ${calculatorId}: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to enable test' }] });
			}
		});

		// POST /calc/disable-test/:calcId — disable test, remove from Formula API
		app.post('/calc/disable-test/:calcId', requireAuth, requireCalculatorAccess(db), async (req: any, res: any) => {
			const { calcId } = req.params;
			const { calculatorId } = parseCalcId(calcId);
			try {
				await db('calculators').where('id', calculatorId).update({
					test_enabled_at: null,
					test_expires_at: null,
				});

				client.deleteCalculator(`${calculatorId}-test`).catch(() => {});

				return res.json({ disabled: true });
			} catch (err: any) {
				if (err instanceof FormulaApiError) return handleFormulaApiError(err, res);
				logger.error(`Disable test failed for ${calculatorId}: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to disable test' }] });
			}
		});

		// POST /calc/activate/:calcId — activate with subscription limit check
		app.post('/calc/activate/:calcId', requireAuth, requireCalculatorAccess(db), async (req: any, res: any) => {
			const { calcId } = req.params;
			const { calculatorId } = parseCalcId(calcId);
			try {
				// Get account
				const calc = await db('calculators').where('id', calculatorId).select('account').first();
				if (!calc?.account) {
					return res.status(400).json({ errors: [{ message: 'Calculator has no account' }] });
				}

				const info = await getSubscriptionInfo(db, calc.account);

				let overLimit = false;
				let activationExpiresAt: string | null = null;

				if (!info.exempt && info.calculator_limit !== null && info.active_count >= info.calculator_limit) {
					// Over limit — check if another over-limit calc already exists
					const existingOverLimit = await db('calculators')
						.where('account', calc.account)
						.where('activated', true)
						.where('over_limit', true)
						.whereNot('id', calculatorId)
						.first();

					if (existingOverLimit) {
						return res.status(403).json({
							errors: [{ message: 'Only one over-limit calculator allowed. Deactivate the other or upgrade.' }],
						});
					}

					overLimit = true;
					activationExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
				}

				// Deploy to Formula API
				const config = await getConfigByCalcId(db, calculatorId);
				if (!config || !configIsComplete(config)) {
					return res.status(400).json({ errors: [{ message: 'Config incomplete — cannot activate' }] });
				}
				const meta = await getCalculatorMeta(db, calculatorId);
				let uf: any = null;
				try {
					const result = await client.updateCalculator(calculatorId, buildPayload(withDecryptedKey(config), meta));
					const body = result.body as any;
					if (body?.profile) await db('calculator_configs').where('id', config.id).update({ profile: JSON.stringify(body.profile) });
					uf = body?.unresolvedFunctions || null;
				} catch (err) {
					if (err instanceof FormulaApiGoneError) {
						const createResult = await client.createCalculator(buildPayload(withDecryptedKey(config), meta));
						if (createResult.profile) await db('calculator_configs').where('id', config.id).update({ profile: JSON.stringify(createResult.profile) });
						uf = (createResult as any).unresolvedFunctions || null;
					} else throw err;
				}
				await db('calculator_configs').where('id', config.id).update({ unresolved_functions: uf ? JSON.stringify(uf) : null });
				client.refreshMcpCache(calculatorId).catch(() => {});

				// Update DB
				await db('calculators').where('id', calculatorId).update({
					activated: true,
					over_limit: overLimit,
					activation_expires_at: activationExpiresAt,
				});

				return res.json({ activated: true, over_limit: overLimit, activation_expires_at: activationExpiresAt });
			} catch (err: any) {
				if (err instanceof FormulaApiError) return handleFormulaApiError(err, res);
				logger.error(`Activate failed for ${calculatorId}: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Activation failed' }] });
			}
		});

		// POST /parse/xlsx — proxy multipart upload
		app.post('/parse/xlsx', requireAuth, async (req: any, res: any) => {
			try {
				const chunks: Buffer[] = [];
				for await (const chunk of req) {
					chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
				}
				const body = Buffer.concat(chunks);
				const contentType = req.headers['content-type'] || 'application/octet-stream';

				const result = await client.parseXlsx(body, contentType);
				return res.status(result.status).json(result.body);
			} catch (err) {
				return handleFormulaApiError(err, res);
			}
		});

		// GET /calc/status/:calcId — get calculator info from Formula API
		app.get('/calc/status/:calcId', requireAuth, requireCalculatorAccess(db), async (req: any, res: any) => {
			const { calcId } = req.params;
			try {
				try {
					const result = await client.getCalculator(calcId);
					return res.status(result.status).json(result.body);
				} catch (err) {
					if (err instanceof FormulaApiGoneError) {
						return await selfHeal(client, db, calcId, (fid) => client.getCalculator(fid), res);
					}
					throw err;
				}
			} catch (err) {
				return handleFormulaApiError(err, res);
			}
		});

		// POST /calc/deploy/:calcId — deploy calculator to Formula API
		app.post('/calc/deploy/:calcId', requireAuth, requireCalculatorAccess(db), async (req: any, res: any) => {
			const { calcId } = req.params;
			try {
				const { calculatorId, isTest } = parseCalcId(calcId);

				// For test deploys, check test window expiry (exempt accounts bypass)
				if (isTest) {
					const calc = await db('calculators').where('id', calculatorId).select('account', 'test_expires_at').first();
					if (calc) {
						const account = await db('account').where('id', calc.account).select('exempt_from_subscription').first();
						if (!account?.exempt_from_subscription) {
							if (!calc.test_expires_at || new Date(calc.test_expires_at) < new Date()) {
								return res.status(403).json({ errors: [{ message: 'Test window expired. Enable test mode to deploy.' }] });
							}
						}
					}
				}

				const config = await getConfigByCalcId(db, calcId);
				if (!config || !configIsComplete(config)) {
					return res.status(400).json({ errors: [{ message: 'Config incomplete — needs sheets, formulas, input, output' }] });
				}

				const meta = await getCalculatorMeta(db, calculatorId);

				// Try update first (calculator may already exist)
				const decrypted = withDecryptedKey(config);
				try {
					const result = await client.updateCalculator(calcId, buildPayload(decrypted, meta));
					const body = result.body as any;
					const profile = body?.profile;
					const uf = body?.unresolvedFunctions || null;
					if (profile || uf !== undefined) await db('calculator_configs').where('id', config.id).update({
						...(profile && { profile: JSON.stringify(profile) }),
						unresolved_functions: uf ? JSON.stringify(uf) : null,
					});
					client.refreshMcpCache(calcId).catch(() => {});
					return res.status(result.status).json(result.body);
				} catch (err) {
					if (!(err instanceof FormulaApiGoneError)) throw err;
					// 410/404 — fall through to create
				}

				// Create
				const createResult = await client.createCalculator(buildPayload(decrypted, meta));
				const createUf = (createResult as any).unresolvedFunctions || null;
				await db('calculator_configs').where('id', config.id).update({
					...(createResult.profile && { profile: JSON.stringify(createResult.profile) }),
					unresolved_functions: createUf ? JSON.stringify(createUf) : null,
				});
				client.refreshMcpCache(calcId).catch(() => {});
				return res.status(201).json({ calculatorId: calcId });
			} catch (err) {
				return handleFormulaApiError(err, res);
			}
		});

		// PATCH /calc/sync/:calcId — update calculator on Formula API from stored config
		app.patch('/calc/sync/:calcId', requireAuth, requireCalculatorAccess(db), async (req: any, res: any) => {
			const { calcId } = req.params;
			try {
				const config = await getConfigByCalcId(db, calcId);
				if (!config || !configIsComplete(config)) {
					return res.status(400).json({ errors: [{ message: 'Config incomplete — needs sheets, formulas, input, output' }] });
				}

				const { calculatorId } = parseCalcId(calcId);
				const meta = await getCalculatorMeta(db, calculatorId);
				const decrypted = withDecryptedKey(config);

				try {
					const result = await client.updateCalculator(calcId, buildPayload(decrypted, meta));
					const body = result.body as any;
					const profile = body?.profile;
					const uf = body?.unresolvedFunctions || null;
					if (profile || uf !== undefined) await db('calculator_configs').where('id', config.id).update({
						...(profile && { profile: JSON.stringify(profile) }),
						unresolved_functions: uf ? JSON.stringify(uf) : null,
					});
					client.refreshMcpCache(calcId).catch(() => {});
					return res.status(result.status).json(result.body);
				} catch (err) {
					if (err instanceof FormulaApiGoneError) {
						// Self-heal: recreate then return
						const createResult = await client.createCalculator(buildPayload(decrypted, meta));
						const createUf = (createResult as any).unresolvedFunctions || null;
						await db('calculator_configs').where('id', config.id).update({
							...(createResult.profile && { profile: JSON.stringify(createResult.profile) }),
							unresolved_functions: createUf ? JSON.stringify(createUf) : null,
						});
						client.refreshMcpCache(calcId).catch(() => {});
						return res.status(200).json({ calculatorId: calcId, recreated: true });
					}
					throw err;
				}
			} catch (err) {
				return handleFormulaApiError(err, res);
			}
		});

		// PATCH /calc/access/:calcId — update allowedIps/allowedOrigins on Formula API
		app.patch('/calc/access/:calcId', requireAuth, requireCalculatorAccess(db), async (req: any, res: any) => {
			const { calcId } = req.params;
			try {
				const config = await getConfigByCalcId(db, calcId);
				if (!config) {
					return res.status(404).json({ errors: [{ message: 'Config not found' }] });
				}

				const allowedIps = config.allowed_ips?.length ? config.allowed_ips : null;
				const allowedOrigins = config.allowed_origins?.length ? config.allowed_origins : null;

				const result = await client.patchAllowlist(calcId, allowedIps, allowedOrigins);
				return res.status(result.status).json(result.body);
			} catch (err) {
				if (err instanceof FormulaApiGoneError) {
					return res.status(404).json({ errors: [{ message: 'Calculator not deployed' }] });
				}
				return handleFormulaApiError(err, res);
			}
		});

		// DELETE /calc/remove/:calcId — remove calculator from Formula API
		app.delete('/calc/remove/:calcId', requireAuth, requireCalculatorAccess(db), async (req: any, res: any) => {
			const { calcId } = req.params;
			try {
				await client.deleteCalculator(calcId);
				return res.status(204).send();
			} catch (err) {
				return handleFormulaApiError(err, res);
			}
		});

		// POST /calc/execute/:calcId
		app.post('/calc/execute/:calcId', requireAuth, requireCalculatorAccess(db), requireActiveSubscription(db), async (req: any, res: any) => {
			const { calcId } = req.params;
			try {
				const { calculatorId, isTest } = parseCalcId(calcId);
				const config = await db('calculator_configs')
					.where('calculator', calculatorId)
					.where('test_environment', isTest)
					.select('api_key')
					.first();
				if (!config) {
					return res.status(404).json({ errors: [{ message: 'Config not found' }] });
				}
				const token = decryptToken(config.api_key);

				try {
					const result = await client.executeCalculator(calcId, req.body, token);
					return res.status(result.status).json(result.body);
				} catch (err) {
					if (err instanceof FormulaApiGoneError) {
						return await selfHeal(client, db, calcId, (fid) => client.executeCalculator(fid, req.body, token), res);
					}
					throw err;
				}
			} catch (err) {
				return handleFormulaApiError(err, res);
			}
		});

		// POST /calc/generate-xlsx — generate annotated Excel from config
		app.post('/calc/generate-xlsx', requireAuth, async (req: any, res: any) => {
			const { config_id } = req.body || {};
			if (!config_id) {
				return res.status(400).json({ errors: [{ message: 'Missing config_id' }] });
			}

			try {
				const { ItemsService } = services;
				const schema = await getSchema();
				const configService = new ItemsService('calculator_configs', { schema, accountability: req.accountability });
				const calcService = new ItemsService('calculators', { schema, accountability: req.accountability });

				let config: any;
				try {
					config = await configService.readOne(config_id, {
						fields: ['id', 'calculator', 'sheets', 'formulas', 'input', 'output', 'test_environment', 'config_version', 'file_version', 'expressions', 'unresolved_functions'],
					});
				} catch {
					return res.status(404).json({ errors: [{ message: 'Config not found' }] });
				}

				if (!config.sheets || !config.formulas) {
					return res.status(400).json({ errors: [{ message: 'Config has no sheets/formulas' }] });
				}

				let calc: any;
				try {
					calc = await calcService.readOne(config.calculator, { fields: ['id', 'name'] });
				} catch {
					return res.status(404).json({ errors: [{ message: 'Calculator not found' }] });
				}

				// Build annotations from input/output mappings
				const toApiKey = (mapping: string) => {
					// Only quote the sheet name if not already quoted
					return mapping.replace(/^([^'!][^!]*)!/, "'$1'!");
				};
				const highlights: Record<string, string> = {};
				const comments: Record<string, string> = {};
				const formats: Record<string, string> = {};

				const inputProps = (config.input as any)?.properties || {};
				for (const [, param] of Object.entries(inputProps) as [string, any][]) {
					if (!param.mapping) continue;
					const key = toApiKey(param.mapping);
					highlights[key] = '#2196F3';
					const typeStr = param.type ? ` (${param.type})` : '';
					comments[key] = `Input: ${param.title || ''}${typeStr}` + (param.description ? `\n${param.description}` : '');
					if (param.transform === 'percentage') formats[key] = '0.00%';
				}

				const outputProps = (config.output as any)?.properties || {};
				for (const [, param] of Object.entries(outputProps) as [string, any][]) {
					if (!param.mapping) continue;
					const key = toApiKey(param.mapping);
					highlights[key] = '#4CAF50';
					const typeStr = param.type ? ` (${param.type})` : '';
					comments[key] = `Output: ${param.title || ''}${typeStr}` + (param.description ? `\n${param.description}` : '');
					if (param.transform === 'percentage') formats[key] = '0.00%';
				}

				// Red highlights for unresolved functions
				const unresolvedFns = config.unresolved_functions;
				if (Array.isArray(unresolvedFns)) {
					for (const fn of unresolvedFns) {
						for (const ref of ((fn as any).references || [])) {
							const key = toApiKey(ref);
							highlights[key] = '#FF0000';
							comments[key] = `Unsupported function: ${(fn as any).name}`;
						}
					}
				}

				const xlsxBuf = await client.generateXlsx({
					sheets: config.sheets,
					formulas: config.formulas,
					highlights,
					comments,
					formats,
					...(config.expressions?.length && { expressions: config.expressions }),
				});

				const env = config.test_environment ? 'test' : 'live';
				const version = `${config.config_version || '0'}.${config.file_version || 0}`;
				const filename = `${calc.id}-${env}-v${version}.xlsx`;

				res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
				res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
				return res.send(xlsxBuf);
			} catch (err: any) {
				if (err instanceof FormulaApiError) return handleFormulaApiError(err, res);
				logger.error(`Generate XLSX failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to generate Excel' }] });
			}
		});

		// GET /calc/describe/:calcId
		app.get('/calc/describe/:calcId', requireAuth, requireCalculatorAccess(db), async (req: any, res: any) => {
			const { calcId } = req.params;
			try {
				const { calculatorId, isTest } = parseCalcId(calcId);
				const config = await db('calculator_configs')
					.where('calculator', calculatorId)
					.where('test_environment', isTest)
					.select('api_key')
					.first();
				if (!config) {
					return res.status(404).json({ errors: [{ message: 'Config not found' }] });
				}
				const token = decryptToken(config.api_key);

				try {
					const result = await client.describeCalculator(calcId, token);
					return res.status(result.status).json(stripDescribeInternals(result.body));
				} catch (err) {
					if (err instanceof FormulaApiGoneError) {
						return await selfHeal(client, db, calcId, (fid) => client.describeCalculator(fid, token), res, stripDescribeInternals);
					}
					throw err;
				}
			} catch (err) {
				return handleFormulaApiError(err, res);
			}
		});

		// GET /calc/mcp/:calcId — return MCP config + snippets for a calculator
		app.get('/calc/mcp/:calcId', requireAuth, requireCalculatorAccess(db), async (req: any, res: any) => {
			const { calcId } = req.params;
			try {
				const config = await getConfigByCalcId(db, calcId);
				if (!config) {
					return res.status(404).json({ errors: [{ message: 'Config not found' }] });
				}

				const mcp = config.mcp;
				if (!mcp?.enabled) {
					return res.json({ enabled: false });
				}

				const mcpUrl = `${apiUrl}/mcp/calculator/${calcId}`;
				const token = decryptToken(config.api_key) || '';

				const inputSchema = buildMcpInputSchema(
					config.input as Record<string, unknown>,
					mcp.parameterDescriptions,
				);

				const snippets = buildMcpSnippets({
					toolName: mcp.toolName,
					mcpUrl,
					token,
				});

				return res.json({
					enabled: true,
					url: mcpUrl,
					transport: 'sse',
					auth: token ? { type: 'bearer', token } : null,
					tool: {
						name: mcp.toolName,
						description: mcp.toolDescription,
						inputSchema,
					},
					snippets,
				});
			} catch (err) {
				return handleFormulaApiError(err, res);
			}
		});

		// ─── A6: GET /calc/api-key/:configId — decrypt and return api_key ───

		app.get('/calc/api-key/:configId', requireAuth, async (req: any, res: any) => {
			const { configId } = req.params;
			const userId = req.accountability?.user;

			try {
				const config = await db('calculator_configs').where('id', configId).select('api_key', 'calculator').first();
				if (!config) {
					return res.status(404).json({ errors: [{ message: 'Config not found' }] });
				}

				// Verify ownership: calculator → account → user's accounts
				if (!req.accountability.admin) {
					const row = await db('calculators as c')
						.join('account_directus_users as adu', 'adu.account_id', 'c.account')
						.where('c.id', config.calculator)
						.andWhere('adu.directus_users_id', userId)
						.select(db.raw('1'))
						.first();
					if (!row) {
						return res.status(403).json({ errors: [{ message: 'Access denied' }] });
					}
				}

				const plaintext = decryptToken(config.api_key) || null;
				return res.json({ api_key: plaintext });
			} catch (err: any) {
				logger.error(`Decrypt api_key failed for config ${configId}: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to decrypt API key' }] });
			}
		});

		// ─── A13: Formula token CRUD ────────────────────────────

		app.post('/calc/formula-tokens', requireAuth, async (req: any, res: any) => {
			const userId = req.accountability?.user;
			try {
				const user = await db('directus_users').where('id', userId).select('active_account').first();
				if (!user?.active_account) {
					return res.status(400).json({ errors: [{ message: 'No active account' }] });
				}

				const { label } = req.body || {};
				const tokenValue = randomUUID();
				const encryptedToken = encryptionKey ? encryptToken(tokenValue) : tokenValue;

				const id = randomUUID();
				await db('formula_tokens').insert({
					id,
					account: user.active_account,
					label: label || 'API Key',
					token: encryptedToken,
					date_created: new Date().toISOString(),
					revoked: false,
				});

				// Return plaintext token — shown once only
				return res.status(201).json({ id, label: label || 'API Key', token: tokenValue });
			} catch (err: any) {
				logger.error(`Create formula token failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to create token' }] });
			}
		});

		app.get('/calc/formula-tokens', requireAuth, async (req: any, res: any) => {
			const userId = req.accountability?.user;
			try {
				const user = await db('directus_users').where('id', userId).select('active_account').first();
				if (!user?.active_account) {
					return res.status(400).json({ errors: [{ message: 'No active account' }] });
				}

				const tokens = await db('formula_tokens')
					.where('account', user.active_account)
					.select('id', 'label', 'date_created', 'last_used_at', 'revoked', 'revoked_at')
					.orderBy('date_created', 'desc');

				return res.json({ data: tokens });
			} catch (err: any) {
				logger.error(`List formula tokens failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to list tokens' }] });
			}
		});

		app.delete('/calc/formula-tokens/:id', requireAuth, async (req: any, res: any) => {
			const userId = req.accountability?.user;
			const tokenId = req.params.id;
			try {
				const user = await db('directus_users').where('id', userId).select('active_account').first();
				if (!user?.active_account) {
					return res.status(400).json({ errors: [{ message: 'No active account' }] });
				}

				const token = await db('formula_tokens').where('id', tokenId).select('account').first();
				if (!token || token.account !== user.active_account) {
					return res.status(404).json({ errors: [{ message: 'Token not found' }] });
				}

				await db('formula_tokens').where('id', tokenId).update({
					revoked: true,
					revoked_at: new Date().toISOString(),
				});

				return res.json({ revoked: true });
			} catch (err: any) {
				logger.error(`Revoke formula token failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to revoke token' }] });
			}
		});

		// ─── B1: Token validation endpoint (for Formula API) ────

		app.get('/management/calc/validate-token', async (req: any, res: any) => {
			// Auth: role-based (same as /management/calc/recipes)
			if (!req.accountability?.user && !req.accountability?.role) {
				return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
			}

			const tokenValue = req.query.token as string;
			if (!tokenValue) {
				return res.json({ valid: false });
			}

			try {
				const tokens = await db('formula_tokens')
					.where('revoked', false)
					.select('id', 'account', 'label', 'token');

				// Must decrypt each to compare (cannot query encrypted values)
				for (const row of tokens) {
					const plain = decryptToken(row.token);
					if (plain === tokenValue) {
						// Update last_used_at
						db('formula_tokens').where('id', row.id).update({ last_used_at: new Date().toISOString() }).catch(() => {});
						return res.json({ valid: true, account_id: row.account, label: row.label });
					}
				}

				return res.json({ valid: false });
			} catch (err: any) {
				logger.error(`Token validation failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Token validation failed' }] });
			}
		});

		// GET /calc/formula-token-value — returns decrypted first non-revoked token
		app.get('/calc/formula-token-value', requireAuth, async (req: any, res: any) => {
			const userId = req.accountability?.user;
			try {
				const user = await db('directus_users').where('id', userId).select('active_account').first();
				if (!user?.active_account) {
					return res.status(400).json({ errors: [{ message: 'No active account' }] });
				}
				const row = await db('formula_tokens')
					.where('account', user.active_account)
					.where('revoked', false)
					.orderBy('date_created', 'asc')
					.select('token')
					.first();
				if (!row) {
					return res.status(404).json({ errors: [{ message: 'No API key found' }] });
				}
				const value = decryptToken(row.token);
				return res.json({ data: value });
			} catch (err: any) {
				logger.error(`Get formula token value failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to get token value' }] });
			}
		});

		// ─── Formula execute proxy routes ────────────────────
		// These proxy /execute, /execute/batch, /execute/sheet to Formula API
		// using the user's first non-revoked formula token for auth.

		async function getActiveAccount(userId: string): Promise<string | null> {
			const user = await db('directus_users').where('id', userId).select('active_account').first();
			return user?.active_account || null;
		}

		async function getFormulaToken(accountId: string, res: any): Promise<string | null> {
			const row = await db('formula_tokens')
				.where('account', accountId)
				.where('revoked', false)
				.orderBy('date_created', 'asc')
				.select('token')
				.first();
			if (!row) {
				res.status(400).json({ errors: [{ message: 'No API key found. Create one in Account settings.' }] });
				return null;
			}
			return decryptToken(row.token) || null;
		}

		app.post('/calc/formula/execute', requireAuth, async (req: any, res: any) => {
			try {
				const accountId = await getActiveAccount(req.accountability?.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });
				const token = await getFormulaToken(accountId, res);
				if (!token) return;
				const result = await client.executeFormula(req.body, token);
				return res.status(result.status).json(result.body);
			} catch (err: any) {
				logger.error(`Formula execute failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Formula execution failed' }] });
			}
		});

		app.post('/calc/formula/execute-batch', requireAuth, async (req: any, res: any) => {
			try {
				const accountId = await getActiveAccount(req.accountability?.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });
				const token = await getFormulaToken(accountId, res);
				if (!token) return;
				const result = await client.executeFormulaBatch(req.body, token);
				return res.status(result.status).json(result.body);
			} catch (err: any) {
				logger.error(`Formula batch execute failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Formula batch execution failed' }] });
			}
		});

		app.post('/calc/formula/execute-sheet', requireAuth, async (req: any, res: any) => {
			try {
				const accountId = await getActiveAccount(req.accountability?.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });
				const token = await getFormulaToken(accountId, res);
				if (!token) return;
				const result = await client.executeFormulaSheet(req.body, token);
				return res.status(result.status).json(result.body);
			} catch (err: any) {
				logger.error(`Formula sheet execute failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Formula sheet execution failed' }] });
			}
		});

		logger.info('Calculator API proxy routes registered');
	});

	// ─── Self-heal: recreate calculator from stored config ────

	async function selfHeal(
		client: FormulaApiClient,
		db: DB,
		calcId: string,
		retryFn: (fid: string) => Promise<{ status: number; body: unknown }>,
		res: any,
		transformBody?: (body: unknown) => unknown,
	) {
		const config = await getConfigByCalcId(db, calcId);
		if (!config || !configIsComplete(config)) {
			return res.status(503).json({ errors: [{ message: 'Could not recreate calculator' }] });
		}

		try {
			const { calculatorId, isTest } = parseCalcId(calcId);

			// Check expiry before recreating
			const calc = await db('calculators').where('id', calculatorId).select('account', 'test_expires_at', 'activation_expires_at', 'over_limit', 'activated').first();
			if (calc) {
				const acct = await db('account').where('id', calc.account).select('exempt_from_subscription').first();
				if (!acct?.exempt_from_subscription) {
					if (isTest && (!calc.test_expires_at || new Date(calc.test_expires_at) < new Date())) {
						return res.status(503).json({ errors: [{ message: 'Test window expired — cannot recreate' }] });
					}
					if (!isTest && calc.activation_expires_at && new Date(calc.activation_expires_at) < new Date()) {
						return res.status(503).json({ errors: [{ message: 'Activation expired — cannot recreate' }] });
					}
				}
			}

			const meta = await getCalculatorMeta(db, calculatorId);
			const createResult = await client.createCalculator(buildPayload(withDecryptedKey(config), meta));
			const createUf = (createResult as any).unresolvedFunctions || null;
			await db('calculator_configs').where('id', config.id).update({
				...(createResult.profile && { profile: JSON.stringify(createResult.profile) }),
				unresolved_functions: createUf ? JSON.stringify(createUf) : null,
			});
			const result = await retryFn(calcId);
			const body = transformBody ? transformBody(result.body) : result.body;
			return res.status(result.status).json(body);
		} catch {
			return res.status(503).json({ errors: [{ message: 'Could not recreate calculator' }] });
		}
	}

	// ─── Lifecycle: auto-sync on config create/update ────────

	async function syncConfig(configKey: string) {
		try {
			const config = await db('calculator_configs').where('id', configKey).first();
			if (!config || !configIsComplete(config)) return;

			const calculator = await db('calculators').where('id', config.calculator).first();
			if (!calculator) return;

			// Skip sync for expired test/live configs (exempt accounts bypass)
			const acct = await db('account').where('id', calculator.account).select('exempt_from_subscription').first();
			if (!acct?.exempt_from_subscription) {
				if (config.test_environment) {
					if (!calculator.test_expires_at || new Date(calculator.test_expires_at) < new Date()) return;
				} else {
					if (!calculator.activated) return;
					if (calculator.activation_expires_at && new Date(calculator.activation_expires_at) < new Date()) return;
				}
			}

			const calcId = formulaApiId(calculator.id, !!config.test_environment);
			const meta = { calculator_id: calculator.id, name: calculator.name, description: calculator.description, account_id: calculator.account };
			const decryptedConfig = { ...config, api_key: decryptToken(config.api_key) || null };

			// Try update first
			try {
				const result = await client.updateCalculator(calcId, buildPayload(decryptedConfig, meta));
				const body = result.body as any;
				const profile = body?.profile;
				const uf = body?.unresolvedFunctions || null;
				if (profile || uf !== undefined) await db('calculator_configs').where('id', config.id).update({
					...(profile && { profile: JSON.stringify(profile) }),
					unresolved_functions: uf ? JSON.stringify(uf) : null,
				});
				client.refreshMcpCache(calcId).catch(() => {});
				return;
			} catch (err) {
				if (!(err instanceof FormulaApiGoneError)) throw err;
				// 410/404 — fall through to create
			}

			// Create new
			const createResult = await client.createCalculator(buildPayload(decryptedConfig, meta));
			const createUf = (createResult as any).unresolvedFunctions || null;
			await db('calculator_configs').where('id', config.id).update({
				...(createResult.profile && { profile: JSON.stringify(createResult.profile) }),
				unresolved_functions: createUf ? JSON.stringify(createUf) : null,
			});
			client.refreshMcpCache(calcId).catch(() => {});
		} catch (err) {
			const detail = err instanceof FormulaApiError ? JSON.stringify(err.body) : '';
			logger.error(`Failed to sync config ${configKey} to Formula API: ${err}${detail ? ' — ' + detail : ''}`);
		}
	}

	// ─── A4 + A9: Startup migration (encrypt tokens + backfill calls) ───

	init('app.after', async () => {
		// A4: Encrypt existing plaintext api_keys
		if (!encryptionKey) {
			logger.warn('TOKEN_ENCRYPTION_KEY not set — tokens stored in plaintext');
		} else {
			try {
				const configs = await db('calculator_configs')
					.whereNotNull('api_key')
					.where('api_key', '!=', '')
					.select('id', 'api_key');

				let migrated = 0;
				for (const row of configs) {
					if (!isEncrypted(row.api_key)) {
						await db('calculator_configs')
							.where('id', row.id)
							.update({ api_key: encrypt(row.api_key, encryptionKey) });
						migrated++;
					}
				}
				if (migrated > 0) logger.info(`Encrypted ${migrated} plaintext api_key(s)`);
			} catch (err) {
				logger.error(`Token encryption migration failed: ${err}`);
			}
		}

		// A9: Backfill calculator_calls.account from calculators
		try {
			const result = await db.raw(`
				UPDATE calculator_calls SET account = c.account
				FROM calculators c
				WHERE calculator_calls.calculator = c.id
				AND calculator_calls.account IS NULL
			`);
			const count = result?.rowCount ?? result?.[0]?.rowCount ?? 0;
			if (count > 0) logger.info(`Backfilled account on ${count} calculator_call(s)`);
		} catch (err) {
			logger.error(`Backfill calculator_calls.account failed: ${err}`);
		}

		// A9: Backfill calculator_calls.type
		try {
			const result = await db.raw(`
				UPDATE calculator_calls SET type = 'calculator'
				WHERE type IS NULL
			`);
			const count = result?.rowCount ?? result?.[0]?.rowCount ?? 0;
			if (count > 0) logger.info(`Backfilled type on ${count} calculator_call(s)`);
		} catch (err) {
			logger.error(`Backfill calculator_calls.type failed: ${err}`);
		}

		// Startup bulk sync: deploy all active calculator configs to Formula API
		try {
			const configs = await db('calculator_configs')
				.whereNotNull('sheets')
				.whereNotNull('formulas')
				.select('id');

			if (configs.length > 0) {
				logger.info(`Syncing ${configs.length} calculator config(s) to Formula API...`);
				let synced = 0;
				let failed = 0;
				for (const row of configs) {
					try {
						await syncConfig(row.id);
						synced++;
					} catch {
						failed++;
					}
				}
				logger.info(`Calculator sync complete: ${synced} synced, ${failed} failed`);
			}
		} catch (err) {
			logger.error(`Startup calculator sync failed: ${err}`);
		}
	});

	// ─── A3: Encrypt api_key on write ───────────────────────

	filter('calculator_configs.items.create', (payload: any) => {
		if (payload.api_key && encryptionKey && !isEncrypted(payload.api_key)) {
			payload.api_key = encryptToken(payload.api_key);
		}
		return payload;
	});

	filter('calculator_configs.items.update', (payload: any) => {
		if (payload.api_key && encryptionKey && !isEncrypted(payload.api_key)) {
			payload.api_key = encryptToken(payload.api_key);
		}
		return payload;
	});

	action('calculator_configs.items.create', async ({ key }) => {
		await syncConfig(key as string);
	});

	action('calculator_configs.items.update', async ({ keys }) => {
		for (const key of keys as string[]) {
			await syncConfig(key);
		}
	});

	// ─── Cron: expire test windows + over-limit activations ──

	schedule('*/5 * * * *', async () => {
		try {
			const now = new Date().toISOString();

			// 1. Expired tests: clear timestamps, delete from Formula API
			const expiredTests = await db('calculators')
				.whereNotNull('test_expires_at')
				.where('test_expires_at', '<', now)
				.select('id');

			for (const calc of expiredTests) {
				client.deleteCalculator(`${calc.id}-test`).catch(() => {});
				await db('calculators').where('id', calc.id).update({
					test_enabled_at: null,
					test_expires_at: null,
				});
			}

			if (expiredTests.length) {
				logger.info(`Cron: expired ${expiredTests.length} test window(s)`);
			}

			// 2. Expired over-limit: deactivate + delete from Formula API
			const expiredOverLimit = await db('calculators')
				.where('activated', true)
				.where('over_limit', true)
				.whereNotNull('activation_expires_at')
				.where('activation_expires_at', '<', now)
				.select('id');

			for (const calc of expiredOverLimit) {
				client.deleteCalculator(calc.id).catch(() => {});
				await db('calculators').where('id', calc.id).update({
					activated: false,
					over_limit: false,
					activation_expires_at: null,
				});
			}

			if (expiredOverLimit.length) {
				logger.info(`Cron: deactivated ${expiredOverLimit.length} over-limit calculator(s)`);
			}

			// 3. Migration: find accounts where active count > limit, mark excess as over-limit
			const accounts = await db('calculators')
				.where('activated', true)
				.groupBy('account')
				.select('account')
				.count('* as cnt');

			for (const row of accounts) {
				const accountId = row.account;
				if (!accountId) continue;

				const acct = await db('account').where('id', accountId).select('exempt_from_subscription').first();
				if (acct?.exempt_from_subscription) continue;

				const sub = await db('subscriptions as s')
					.join('subscription_plans as sp', 'sp.id', 's.plan')
					.where('s.account', accountId)
					.whereNotIn('s.status', ['canceled', 'expired'])
					.select('sp.calculator_limit')
					.first();

				const limit = sub?.calculator_limit;
				if (!limit) continue;

				const activeCount = parseInt(row.cnt as string, 10) || 0;
				if (activeCount <= limit) continue;

				// Mark excess calcs (newest first, skip already-marked)
				const excess = await db('calculators')
					.where('account', accountId)
					.where('activated', true)
					.where('over_limit', false)
					.orderBy('date_created', 'desc')
					.select('id')
					.limit(activeCount - limit);

				for (const calc of excess) {
					await db('calculators').where('id', calc.id).update({
						over_limit: true,
						activation_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
					});
				}

				if (excess.length) {
					logger.info(`Cron: marked ${excess.length} excess calculator(s) as over-limit for account ${accountId}`);
				}
			}
		} catch (err) {
			logger.error(`Cron expiry cleanup failed: ${err}`);
		}
	});

	// ─── Cron: health snapshots ──────────────────────────────

	const snapshotIntervalMin = parseInt(env['HEALTH_SNAPSHOT_INTERVAL_MINUTES'] as string, 10) || 5;
	const retentionDays = parseInt(env['HEALTH_SNAPSHOT_RETENTION_DAYS'] as string, 10) || 7;

	schedule(`*/${snapshotIntervalMin} * * * *`, async () => {
		try {
			const start = Date.now();
			const result = await client.getServerStats();
			const elapsed = Date.now() - start;
			const body = result.body as Record<string, any>;

			// Extract cluster-level metrics from /server/stats response
			const cluster = body.cluster || {};
			const instances = body.instances || {};
			const instanceCount = cluster.instances ?? Object.keys(instances).length;

			// Aggregate queue from all instances
			let totalQueuePending = cluster.totalQueuePending ?? 0;
			let totalQueueMax = cluster.totalQueueMax ?? 0;
			let totalCacheSize = 0;

			for (const inst of Object.values(instances) as any[]) {
				totalCacheSize += inst?.cache?.lru?.size ?? 0;
			}

			await db('system_health_snapshots').insert({
				id: crypto.randomUUID(),
				date_created: new Date().toISOString(),
				status: (body.status as string) || (result.status < 300 ? 'ok' : 'error'),
				response_time_ms: elapsed,
				heap_used_mb: Math.round(cluster.totalHeapUsedMB ?? 0),
				queue_pending: totalQueuePending,
				queue_max: totalQueueMax,
				worker_count: cluster.totalWorkers ?? null,
				cache_size: totalCacheSize || null,
				instance_count: instanceCount,
				total_calculators: cluster.totalCalculators ?? null,
				response: JSON.stringify(body),
			});

			// Cleanup old snapshots
			const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
			await db('system_health_snapshots').where('date_created', '<', cutoff).delete();
		} catch (err) {
			logger.error(`Health snapshot failed: ${err}`);
		}
	});

	// ─── Lifecycle: cleanup on calculator delete ─────────────

	filter('calculators.items.delete', async (keys: string[]) => {
		for (const calcId of keys) {
			// Delete both test and live from Formula API
			client.deleteCalculator(`${calcId}-test`).catch(() => {});
			client.deleteCalculator(calcId).catch(() => {});
		}
		return keys;
	});

	// ─── A14: API Key management (proxy to gateway) ───────

	const gatewayUrl = ((env['GATEWAY_URL'] as string) || '').replace(/\/+$/, '');
	const gatewayInternalSecret = (env['GATEWAY_INTERNAL_SECRET'] as string) || '';

	if (gatewayUrl && gatewayInternalSecret) {
		const gwFetch = async (path: string, method: string, body?: unknown) => {
			const opts: RequestInit = {
				method,
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': gatewayInternalSecret,
				},
			};
			if (body) opts.body = JSON.stringify(body);
			const res = await fetch(`${gatewayUrl}${path}`, opts);
			const text = await res.text();
			return { status: res.status, data: text ? JSON.parse(text) : null };
		};

		// List API keys for active account
		app.get('/calc/api-keys', requireAuth, async (req: any, res: any) => {
			const userId = req.accountability?.user;
			try {
				const user = await db('directus_users').where('id', userId).select('active_account').first();
				if (!user?.active_account) return res.status(400).json({ errors: [{ message: 'No active account' }] });
				const gw = await gwFetch(`/internal/api-keys/?account_id=${user.active_account}`, 'GET');
				return res.status(gw.status).json({ data: gw.data });
			} catch (err: any) {
				logger.error(`List API keys failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to list keys' }] });
			}
		});

		// Create API key
		app.post('/calc/api-keys', requireAuth, async (req: any, res: any) => {
			const userId = req.accountability?.user;
			try {
				const user = await db('directus_users').where('id', userId).select('active_account').first();
				if (!user?.active_account) return res.status(400).json({ errors: [{ message: 'No active account' }] });
				const gw = await gwFetch('/internal/api-keys/', 'POST', {
					account_id: user.active_account,
					...req.body,
				});
				return res.status(gw.status).json(gw.data);
			} catch (err: any) {
				logger.error(`Create API key failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to create key' }] });
			}
		});

		// Get single API key
		app.get('/calc/api-keys/:id', requireAuth, async (req: any, res: any) => {
			try {
				const gw = await gwFetch(`/internal/api-keys/${req.params.id}`, 'GET');
				return res.status(gw.status).json(gw.data);
			} catch (err: any) {
				logger.error(`Get API key failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to get key' }] });
			}
		});

		// Update API key
		app.patch('/calc/api-keys/:id', requireAuth, async (req: any, res: any) => {
			try {
				const gw = await gwFetch(`/internal/api-keys/${req.params.id}`, 'PATCH', req.body);
				return res.status(gw.status).json(gw.data);
			} catch (err: any) {
				logger.error(`Update API key failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to update key' }] });
			}
		});

		// Revoke API key
		app.delete('/calc/api-keys/:id', requireAuth, async (req: any, res: any) => {
			try {
				const gw = await gwFetch(`/internal/api-keys/${req.params.id}`, 'DELETE');
				return res.status(gw.status).json(gw.data);
			} catch (err: any) {
				logger.error(`Revoke API key failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to revoke key' }] });
			}
		});

		// Rotate API key
		app.post('/calc/api-keys/:id/rotate', requireAuth, async (req: any, res: any) => {
			try {
				const gw = await gwFetch(`/internal/api-keys/${req.params.id}/rotate`, 'POST');
				return res.status(gw.status).json(gw.data);
			} catch (err: any) {
				logger.error(`Rotate API key failed: ${err}`);
				return res.status(500).json({ errors: [{ message: 'Failed to rotate key' }] });
			}
		});
	}
});
