import { createDecipheriv, randomUUID } from 'node:crypto';
import type { ToolDefinition, DB } from './types.js';

export const AI_TOOLS: ToolDefinition[] = [
	{
		name: 'list_calculators',
		description: 'List all calculators available in the user\'s account. Returns calculator ID, name, description, and status.',
		input_schema: {
			type: 'object',
			properties: {},
			required: [],
		},
	},
	{
		name: 'describe_calculator',
		description: 'Get detailed information about a specific calculator including its expected inputs, outputs, and description. Use this before executing a calculator to understand what inputs are needed.',
		input_schema: {
			type: 'object',
			properties: {
				calculator_id: {
					type: 'string',
					description: 'The calculator ID (e.g. "my-calculator")',
				},
			},
			required: ['calculator_id'],
		},
	},
	{
		name: 'execute_calculator',
		description: 'Execute a calculator with the given inputs and return the results. Always describe the calculator first to know the required inputs.',
		input_schema: {
			type: 'object',
			properties: {
				calculator_id: {
					type: 'string',
					description: 'The calculator ID (e.g. "my-calculator")',
				},
				inputs: {
					type: 'object',
					description: 'Input values as key-value pairs matching the calculator\'s expected input schema',
				},
				test: {
					type: 'boolean',
					description: 'If true, execute against the test environment. Defaults to false (live).',
				},
			},
			required: ['calculator_id', 'inputs'],
		},
	},
	{
		name: 'create_calculator',
		description: 'Create a new calculator in the user\'s account. This creates the calculator record and both test and live configurations with empty config. After creating, help the user configure inputs/outputs or tell them to upload an Excel file in the Calculators module.',
		input_schema: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					description: 'Unique calculator ID. Must be lowercase alphanumeric with hyphens, 2-50 chars (e.g. "roi-calculator")',
				},
				name: {
					type: 'string',
					description: 'Human-readable name for the calculator',
				},
				description: {
					type: 'string',
					description: 'Optional description of what this calculator does',
				},
			},
			required: ['id', 'name'],
		},
	},
	{
		name: 'update_calculator',
		description: 'Update a calculator\'s name or description.',
		input_schema: {
			type: 'object',
			properties: {
				calculator_id: {
					type: 'string',
					description: 'The calculator ID to update',
				},
				name: {
					type: 'string',
					description: 'New name for the calculator',
				},
				description: {
					type: 'string',
					description: 'New description for the calculator',
				},
			},
			required: ['calculator_id'],
		},
	},
	{
		name: 'get_calculator_config',
		description: 'Get the full configuration of a calculator including input/output schemas with mappings, sheet data, and formulas. Use this to inspect available cells before configuring inputs/outputs. Defaults to test environment.',
		input_schema: {
			type: 'object',
			properties: {
				calculator_id: {
					type: 'string',
					description: 'The calculator ID',
				},
				test: {
					type: 'boolean',
					description: 'If true, get test config. Defaults to true (test).',
				},
			},
			required: ['calculator_id'],
		},
	},
	{
		name: 'configure_calculator',
		description: 'Configure a calculator\'s input and/or output schema (test environment by default). Every field MUST include a \'mapping\' cell reference (e.g. \'Sheet1\'!A1). Use get_calculator_config first to inspect sheets and formulas for available cells. Uses partial merge — set a field to null to remove it.',
		input_schema: {
			type: 'object',
			properties: {
				calculator_id: {
					type: 'string',
					description: 'The calculator ID to configure',
				},
				test: {
					type: 'boolean',
					description: 'If true, configure the test environment config. Defaults to true (test).',
				},
				input: {
					type: 'object',
					description: 'Input schema. Object with "properties" key containing field definitions. Each field: { title, type, description?, mapping?, default?, transform? }',
				},
				output: {
					type: 'object',
					description: 'Output schema. Same structure as input.',
				},
			},
			required: ['calculator_id'],
		},
	},
	{
		name: 'deploy_calculator',
		description: 'Deploy a calculator to the Formula API (test environment by default). For test: enables a 6-hour test window. For live: requires an active test deployment first — deploy to test, execute to verify, then deploy live.',
		input_schema: {
			type: 'object',
			properties: {
				calculator_id: {
					type: 'string',
					description: 'The calculator ID to deploy',
				},
				test: {
					type: 'boolean',
					description: 'If true, deploy to test environment (6h window). Defaults to true (test).',
				},
			},
			required: ['calculator_id'],
		},
	},
	{
		name: 'search_knowledge',
		description: 'Search the user\'s knowledge bases for relevant document chunks using semantic similarity. Returns matching text passages with confidence scores and source metadata.',
		input_schema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'The search query to find relevant document chunks',
				},
				knowledge_base_id: {
					type: 'string',
					description: 'Optional: specific knowledge base ID to search. If omitted, searches all knowledge bases.',
				},
				limit: {
					type: 'number',
					description: 'Max number of results to return (default: 5)',
				},
			},
			required: ['query'],
		},
	},
	{
		name: 'ask_knowledge',
		description: 'Ask a question and get a cited answer generated from the user\'s knowledge base documents. The answer includes source references and a confidence level.',
		input_schema: {
			type: 'object',
			properties: {
				question: {
					type: 'string',
					description: 'The question to answer from knowledge base documents',
				},
				knowledge_base_id: {
					type: 'string',
					description: 'Optional: specific knowledge base ID to query. If omitted, searches all knowledge bases.',
				},
			},
			required: ['question'],
		},
	},
	{
		name: 'list_knowledge_bases',
		description: 'List all knowledge bases in the user\'s account with document counts and status.',
		input_schema: {
			type: 'object',
			properties: {},
			required: [],
		},
	},
	{
		name: 'create_knowledge_base',
		description: 'Create a new knowledge base in the user\'s account. An appropriate icon is automatically selected based on the name/description.',
		input_schema: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'Name for the knowledge base',
				},
				description: {
					type: 'string',
					description: 'Optional description of the knowledge base',
				},
			},
			required: ['name'],
		},
	},
	{
		name: 'get_knowledge_base',
		description: 'Get detailed information about a specific knowledge base including its documents, indexing status, and chunk counts. Lookup by ID or name.',
		input_schema: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					description: 'Knowledge base ID (exact match)',
				},
				name: {
					type: 'string',
					description: 'Knowledge base name (partial match, case-insensitive)',
				},
			},
			required: [],
		},
	},
	{
		name: 'upload_to_knowledge_base',
		description: 'Upload a file to a knowledge base for indexing. The file must already be uploaded to Directus (use the file_id from the upload). Triggers automatic chunking and embedding.',
		input_schema: {
			type: 'object',
			properties: {
				knowledge_base_id: {
					type: 'string',
					description: 'The knowledge base ID to upload to',
				},
				file_id: {
					type: 'string',
					description: 'The Directus file ID (UUID) of the already-uploaded file',
				},
				title: {
					type: 'string',
					description: 'Optional title for the document (defaults to filename)',
				},
			},
			required: ['knowledge_base_id', 'file_id'],
		},
	},
];

export interface ToolExecutorDeps {
	db: DB;
	accountId: string;
	gatewayCalcUrl: string;
	internalSecret: string;
	encryptionKey?: string;
	authToken?: string;
	logger: any;
	accountability?: any;
	schema?: any;
	services?: any;
}

export async function executeTool(
	toolName: string,
	toolInput: any,
	deps: ToolExecutorDeps,
): Promise<{ result: unknown; isError?: boolean }> {
	const { db, accountId, gatewayCalcUrl, internalSecret, encryptionKey, authToken, logger, accountability, schema, services } = deps;

	try {
		switch (toolName) {
			case 'list_calculators':
				return await listCalculators(db, accountId);
			case 'describe_calculator':
				return await describeCalculator(db, accountId, toolInput.calculator_id, gatewayCalcUrl, internalSecret, encryptionKey);
			case 'execute_calculator':
				return await executeCalculator(db, accountId, toolInput.calculator_id, toolInput.inputs, toolInput.test ?? false, gatewayCalcUrl, internalSecret, encryptionKey);
			case 'create_calculator':
				return await createCalculator(db, accountId, toolInput);
			case 'update_calculator':
				return await updateCalculator(db, accountId, toolInput);
			case 'get_calculator_config':
				return await getCalculatorConfig(db, accountId, toolInput.calculator_id, toolInput.test ?? true);
			case 'configure_calculator':
				return await configureCalculator(db, accountId, toolInput, { accountability, schema, services });
			case 'deploy_calculator':
				return await deployCalculator(db, accountId, toolInput.calculator_id, toolInput.test ?? true, gatewayCalcUrl, internalSecret, encryptionKey, logger, accountability);
			case 'search_knowledge':
				return await searchKnowledge(db, accountId, toolInput.query, toolInput.knowledge_base_id, toolInput.limit, authToken);
			case 'ask_knowledge':
				return await askKnowledge(db, accountId, toolInput.question, toolInput.knowledge_base_id, logger, authToken);
			case 'list_knowledge_bases':
				return await listKnowledgeBases(db, accountId);
			case 'create_knowledge_base':
				return await createKnowledgeBase(db, accountId, toolInput);
			case 'get_knowledge_base':
				return await getKnowledgeBase(db, accountId, toolInput);
			case 'upload_to_knowledge_base':
				return await uploadToKnowledgeBase(db, accountId, toolInput, authToken, logger);
			default:
				return { result: `Unknown tool: ${toolName}`, isError: true };
		}
	} catch (err: any) {
		logger.error(`Tool ${toolName} failed: ${err.message}`);
		return { result: `Tool error: ${err.message}`, isError: true };
	}
}

async function listCalculators(db: DB, accountId: string) {
	const calcs = await db('calculators')
		.where('account', accountId)
		.select('id', 'name', 'description', 'activated', 'over_limit', 'test_enabled_at', 'test_expires_at')
		.orderBy('name');

	const list = calcs.map((c: any) => ({
		id: c.id,
		name: c.name,
		description: c.description,
		status: c.activated ? (c.over_limit ? 'over_limit' : 'live') : 'inactive',
		test_available: !!(c.test_enabled_at && c.test_expires_at && new Date(c.test_expires_at) > new Date()),
	}));

	return { result: { calculators: list, count: list.length } };
}

async function describeCalculator(
	db: DB,
	accountId: string,
	calculatorId: string,
	gatewayCalcUrl: string,
	internalSecret: string,
	encryptionKey?: string,
) {
	const calc = await db('calculators')
		.where('id', calculatorId)
		.where('account', accountId)
		.first();

	if (!calc) {
		return { result: `Calculator "${calculatorId}" not found in your account.`, isError: true };
	}

	const config = await db('calculator_configs')
		.where('calculator', calculatorId)
		.where('test_environment', false)
		.first();

	if (!config) {
		return { result: `Calculator "${calculatorId}" has no live configuration.`, isError: true };
	}

	try {
		const res = await fetch(`${gatewayCalcUrl}/calculator/${encodeURIComponent(calculatorId)}/describe`, {
			headers: {
				...(internalSecret ? { 'X-Internal-Secret': internalSecret } : {}),
			},
		});

		if (res.ok) {
			const data = await res.json();
			return {
				result: {
					id: calculatorId,
					name: calc.name,
					description: calc.description,
					...data,
				},
			};
		}
	} catch {
		// Fall back to stored config
	}

	return {
		result: {
			id: calculatorId,
			name: calc.name,
			description: calc.description,
			input: config.input,
			output: config.output,
		},
	};
}

async function executeCalculator(
	db: DB,
	accountId: string,
	calculatorId: string,
	inputs: unknown,
	test: boolean,
	gatewayCalcUrl: string,
	internalSecret: string,
	encryptionKey?: string,
) {
	const calc = await db('calculators')
		.where('id', calculatorId)
		.where('account', accountId)
		.first();

	if (!calc) {
		return { result: `Calculator "${calculatorId}" not found in your account.`, isError: true };
	}

	const formulaId = test ? `${calculatorId}-test` : calculatorId;

	const config = await db('calculator_configs')
		.where('calculator', calculatorId)
		.where('test_environment', test)
		.first();

	if (!config) {
		return { result: `Calculator "${calculatorId}" has no ${test ? 'test' : 'live'} configuration.`, isError: true };
	}

	const res = await fetch(`${gatewayCalcUrl}/execute/calculator/${encodeURIComponent(formulaId)}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(internalSecret ? { 'X-Internal-Secret': internalSecret } : {}),
		},
		body: JSON.stringify(inputs),
	});

	const data = await res.json();

	if (!res.ok) {
		return { result: `Execution failed: ${JSON.stringify(data)}`, isError: true };
	}

	return { result: data };
}

// ─── Validation helpers ──────────────────────────────────────────

const CALC_ID_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;
const VALID_TYPES = new Set(['string', 'number', 'integer', 'boolean']);
const MAPPING_RE = /^'[^']+'![A-Z]+[0-9]+$/;

function validateCalcId(id: string): string | null {
	if (!id || id.length < 2 || id.length > 50) return 'Calculator ID must be 2-50 characters';
	if (!CALC_ID_RE.test(id)) return 'Calculator ID must be lowercase alphanumeric with hyphens, cannot start/end with hyphen';
	return null;
}

function validateSchemaProperties(props: Record<string, any>): string | null {
	for (const [key, val] of Object.entries(props)) {
		if (val === null) continue; // null = remove field
		if (!val || typeof val !== 'object') return `Field "${key}" must be an object or null`;
		if (val.type && !VALID_TYPES.has(val.type)) return `Field "${key}" has invalid type "${val.type}". Must be: string, number, integer, or boolean`;
		if (val.mapping && !MAPPING_RE.test(val.mapping)) return `Field "${key}" has invalid mapping "${val.mapping}". Must be 'SheetName'!CellRef (e.g. 'Sheet1'!A1)`;
	}
	return null;
}

// ─── Create calculator ───────────────────────────────────────────

async function createCalculator(db: DB, accountId: string, input: { id: string; name: string; description?: string }) {
	const idError = validateCalcId(input.id);
	if (idError) return { result: idError, isError: true };

	// Check uniqueness within account
	const existing = await db('calculators').where('id', input.id).first('id');
	if (existing) return { result: `Calculator "${input.id}" already exists.`, isError: true };

	// Check subscription calculator limit
	const account = await db('account').where('id', accountId).select('exempt_from_subscription').first();
	if (!account?.exempt_from_subscription) {
		const sub = await db('subscriptions as s')
			.join('subscription_plans as sp', 'sp.id', 's.plan')
			.where('s.account', accountId)
			.whereNotIn('s.status', ['canceled', 'expired'])
			.select('sp.calculator_limit')
			.first();

		if (sub?.calculator_limit !== null && sub?.calculator_limit !== undefined) {
			const { count } = await db('calculators')
				.where('account', accountId)
				.count('* as count')
				.first() as any;
			const total = parseInt(count, 10) || 0;
			if (total >= sub.calculator_limit) {
				return { result: `Calculator limit reached (${sub.calculator_limit}). Upgrade your plan to create more.`, isError: true };
			}
		}
	}

	// Create calculator
	await db('calculators').insert({
		id: input.id,
		name: input.name,
		description: input.description || null,
		account: accountId,
		activated: false,
		over_limit: false,
	});

	// Create both configs (test + live)
	for (const isTest of [false, true]) {
		await db('calculator_configs').insert({
			id: randomUUID(),
			calculator: input.id,
			test_environment: isTest,
			input: JSON.stringify({}),
			output: JSON.stringify({}),
			config_version: 1,
		});
	}

	return {
		result: {
			id: input.id,
			name: input.name,
			description: input.description || null,
			message: 'Created. Upload an Excel file in the Calculators module, or tell me the inputs/outputs to configure manually.',
		},
	};
}

// ─── Update calculator ───────────────────────────────────────────

async function updateCalculator(db: DB, accountId: string, input: { calculator_id: string; name?: string; description?: string }) {
	const calc = await db('calculators').where('id', input.calculator_id).where('account', accountId).first();
	if (!calc) return { result: `Calculator "${input.calculator_id}" not found in your account.`, isError: true };

	const updates: Record<string, any> = {};
	if (input.name !== undefined) updates.name = input.name;
	if (input.description !== undefined) updates.description = input.description;

	if (Object.keys(updates).length === 0) return { result: 'No changes provided.', isError: true };

	await db('calculators').where('id', input.calculator_id).update(updates);

	return {
		result: {
			id: input.calculator_id,
			...updates,
			message: 'Calculator updated.',
		},
	};
}

// ─── Get calculator config ───────────────────────────────────────

async function getCalculatorConfig(db: DB, accountId: string, calculatorId: string, test: boolean) {
	const calc = await db('calculators').where('id', calculatorId).where('account', accountId).first();
	if (!calc) return { result: `Calculator "${calculatorId}" not found in your account.`, isError: true };

	const config = await db('calculator_configs')
		.where('calculator', calculatorId)
		.where('test_environment', test)
		.first();

	if (!config) return { result: `No ${test ? 'test' : 'live'} config found for "${calculatorId}".`, isError: true };

	const inputSchema = typeof config.input === 'string' ? JSON.parse(config.input) : (config.input || {});
	const outputSchema = typeof config.output === 'string' ? JSON.parse(config.output) : (config.output || {});
	const inputProps = inputSchema.properties || {};
	const outputProps = outputSchema.properties || {};

	const sheets = config.sheets ? (typeof config.sheets === 'string' ? JSON.parse(config.sheets) : config.sheets) : [];
	const formulas = config.formulas ? (typeof config.formulas === 'string' ? JSON.parse(config.formulas) : config.formulas) : [];

	return {
		result: {
			calculator_id: calculatorId,
			environment: test ? 'test' : 'live',
			input_fields: Object.keys(inputProps).length,
			output_fields: Object.keys(outputProps).length,
			input: inputSchema,
			output: outputSchema,
			sheets,
			formulas,
			has_sheets: sheets.length > 0,
			has_formulas: formulas.length > 0,
			is_complete: !!(sheets.length > 0 && formulas.length > 0 && Object.keys(inputProps).length > 0 && Object.keys(outputProps).length > 0),
			config_version: config.config_version || 1,
		},
	};
}

// ─── Configure calculator ────────────────────────────────────────

async function configureCalculator(
	db: DB,
	accountId: string,
	input: { calculator_id: string; test?: boolean; input?: any; output?: any },
	ctx: { accountability?: any; schema?: any; services?: any },
) {
	const calc = await db('calculators').where('id', input.calculator_id).where('account', accountId).first();
	if (!calc) return { result: `Calculator "${input.calculator_id}" not found in your account.`, isError: true };

	const isTest = input.test ?? true;
	const config = await db('calculator_configs')
		.where('calculator', input.calculator_id)
		.where('test_environment', isTest)
		.first();

	if (!config) return { result: `No ${isTest ? 'test' : 'live'} config found for "${input.calculator_id}".`, isError: true };

	if (!input.input && !input.output) return { result: 'Provide input and/or output schema to configure.', isError: true };

	const updates: Record<string, any> = {};

	// Partial merge for input schema
	if (input.input?.properties) {
		const err = validateSchemaProperties(input.input.properties);
		if (err) return { result: err, isError: true };

		const existing = typeof config.input === 'string' ? JSON.parse(config.input) : (config.input || {});
		const merged = deepMergeSchema(existing, input.input);
		updates.input = JSON.stringify(merged);
	}

	// Partial merge for output schema
	if (input.output?.properties) {
		const err = validateSchemaProperties(input.output.properties);
		if (err) return { result: err, isError: true };

		const existing = typeof config.output === 'string' ? JSON.parse(config.output) : (config.output || {});
		const merged = deepMergeSchema(existing, input.output);
		updates.output = JSON.stringify(merged);
	}

	if (Object.keys(updates).length > 0) {
		// AI live config: only allowed after a successful test deploy (active test window)
		if (ctx.accountability && !ctx.accountability.admin && !isTest) {
			if (!calc.test_enabled_at || !calc.test_expires_at || new Date(calc.test_expires_at) < new Date()) {
				return { result: 'Configure and deploy to test first, then verify results before configuring live. Set test=true.', isError: true };
			}
		}

		await db('calculator_configs').where('id', config.id).update(updates);
	}

	// Return updated counts
	const inputSchema = updates.input ? JSON.parse(updates.input) : (typeof config.input === 'string' ? JSON.parse(config.input) : (config.input || {}));
	const outputSchema = updates.output ? JSON.parse(updates.output) : (typeof config.output === 'string' ? JSON.parse(config.output) : (config.output || {}));

	return {
		result: {
			calculator_id: input.calculator_id,
			environment: isTest ? 'test' : 'live',
			input_fields: Object.keys(inputSchema.properties || {}).length,
			output_fields: Object.keys(outputSchema.properties || {}).length,
			message: 'Configuration updated.',
		},
	};
}

function deepMergeSchema(existing: any, incoming: any): any {
	const result = { ...existing };
	if (!result.properties) result.properties = {};

	for (const [key, val] of Object.entries(incoming.properties || {})) {
		if (val === null) {
			delete result.properties[key];
		} else {
			result.properties[key] = { ...(result.properties[key] || {}), ...(val as any) };
		}
	}

	return result;
}

// ─── Deploy calculator ───────────────────────────────────────────

async function deployCalculator(
	db: DB,
	accountId: string,
	calculatorId: string,
	test: boolean,
	gatewayCalcUrl: string,
	internalSecret: string,
	encryptionKey: string | undefined,
	logger: any,
	accountability?: any,
) {
	const calc = await db('calculators').where('id', calculatorId).where('account', accountId).first();
	if (!calc) return { result: `Calculator "${calculatorId}" not found in your account.`, isError: true };

	// AI live deploy: only allowed after a successful test deploy (active test window)
	if (accountability && !accountability.admin && !test) {
		if (!calc.test_enabled_at || !calc.test_expires_at || new Date(calc.test_expires_at) < new Date()) {
			return { result: 'Deploy to test first and verify results before deploying live. Use deploy_calculator with test=true.', isError: true };
		}
	}

	const config = await db('calculator_configs')
		.where('calculator', calculatorId)
		.where('test_environment', test)
		.first();

	if (!config) return { result: `No ${test ? 'test' : 'live'} config found for "${calculatorId}".`, isError: true };

	// Check completeness
	const sheets = config.sheets && (typeof config.sheets === 'string' ? JSON.parse(config.sheets) : config.sheets);
	const formulas = config.formulas && (typeof config.formulas === 'string' ? JSON.parse(config.formulas) : config.formulas);
	const inputSchema = typeof config.input === 'string' ? JSON.parse(config.input) : (config.input || {});
	const outputSchema = typeof config.output === 'string' ? JSON.parse(config.output) : (config.output || {});

	if (!sheets || !formulas || !Object.keys(inputSchema.properties || {}).length || !Object.keys(outputSchema.properties || {}).length) {
		return { result: 'Config incomplete — needs sheets, formulas, input, and output. Upload an Excel file in the Calculators module first.', isError: true };
	}

	const formulaId = test ? `${calculatorId}-test` : calculatorId;

	if (test) {
		// Enable test window (6h)
		const now = new Date();
		const expiresAt = new Date(now.getTime() + 6 * 60 * 60 * 1000);
		await db('calculators').where('id', calculatorId).update({
			test_enabled_at: now.toISOString(),
			test_expires_at: expiresAt.toISOString(),
		});
	} else {
		// Live: check subscription limits
		const account = await db('account').where('id', accountId).select('exempt_from_subscription').first();
		if (!account?.exempt_from_subscription) {
			const sub = await db('subscriptions as s')
				.join('subscription_plans as sp', 'sp.id', 's.plan')
				.where('s.account', accountId)
				.whereNotIn('s.status', ['canceled', 'expired'])
				.select('sp.calculator_limit')
				.first();

			if (sub?.calculator_limit !== null && sub?.calculator_limit !== undefined) {
				const { count } = await db('calculators')
					.where('account', accountId)
					.where('activated', true)
					.whereNot('id', calculatorId)
					.count('* as count')
					.first() as any;
				const activeCount = parseInt(count, 10) || 0;

				if (activeCount >= sub.calculator_limit) {
					// Check if another over-limit calc exists
					const existingOverLimit = await db('calculators')
						.where('account', accountId)
						.where('activated', true)
						.where('over_limit', true)
						.whereNot('id', calculatorId)
						.first();

					if (existingOverLimit) {
						return { result: 'Only one over-limit calculator allowed. Deactivate the other or upgrade your plan.', isError: true };
					}

					// Allow as over-limit with 1h expiry
					const activationExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
					await db('calculators').where('id', calculatorId).update({
						activated: true,
						over_limit: true,
						activation_expires_at: activationExpiresAt,
					});
				} else {
					await db('calculators').where('id', calculatorId).update({
						activated: true,
						over_limit: false,
						activation_expires_at: null,
					});
				}
			} else {
				await db('calculators').where('id', calculatorId).update({
					activated: true,
					over_limit: false,
					activation_expires_at: null,
				});
			}
		} else {
			await db('calculators').where('id', calculatorId).update({
				activated: true,
				over_limit: false,
				activation_expires_at: null,
			});
		}
	}

	// Build payload and deploy to Formula API
	const token = decryptApiKey(config.api_key, encryptionKey);
	const payload: Record<string, any> = {
		calculatorId: formulaId,
		name: formulaId,
		description: calc.description ?? undefined,
		version: String(config.config_version ?? 1),
		token: token || undefined,
		test,
		accountId: accountId,
		sheets,
		formulas,
		input: inputSchema,
		output: outputSchema,
	};

	if (config.allowed_ips?.length) payload.allowedIps = config.allowed_ips;
	if (config.allowed_origins?.length) payload.allowedOrigins = config.allowed_origins;
	if (config.expressions?.length) payload.expressions = config.expressions;

	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (internalSecret) headers['X-Internal-Secret'] = internalSecret;

	// Try update first, then create on 410/404
	let deployed = false;
	try {
		const res = await fetch(`${gatewayCalcUrl}/calculator/${encodeURIComponent(formulaId)}`, {
			method: 'PATCH',
			headers,
			body: JSON.stringify(payload),
		});

		if (res.status === 410 || res.status === 404) {
			// Fall through to create
		} else if (res.ok) {
			const body = await res.json().catch(() => null) as any;
			if (body?.profile) await db('calculator_configs').where('id', config.id).update({ profile: JSON.stringify(body.profile) });
			const uf = body?.unresolvedFunctions || null;
			await db('calculator_configs').where('id', config.id).update({ unresolved_functions: uf ? JSON.stringify(uf) : null });
			deployed = true;
		} else {
			const err = await res.json().catch(() => null);
			return { result: `Deploy failed: ${JSON.stringify(err)}`, isError: true };
		}
	} catch {
		// Network error — try create
	}

	if (!deployed) {
		const res = await fetch(`${gatewayCalcUrl}/calculator`, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
		});

		if (!res.ok) {
			const err = await res.json().catch(() => null);
			return { result: `Deploy failed: ${JSON.stringify(err)}`, isError: true };
		}

		const body = await res.json().catch(() => null) as any;
		if (body?.profile) await db('calculator_configs').where('id', config.id).update({ profile: JSON.stringify(body.profile) });
		const uf = body?.unresolvedFunctions || null;
		await db('calculator_configs').where('id', config.id).update({ unresolved_functions: uf ? JSON.stringify(uf) : null });
	}

	// Refresh MCP cache (fire-and-forget)
	fetch(`${gatewayCalcUrl}/cache/refresh-mcp/${encodeURIComponent(formulaId)}`, {
		method: 'POST',
		headers: internalSecret ? { 'X-Internal-Secret': internalSecret } : {},
	}).catch(() => {});

	return {
		result: {
			deployed: true,
			environment: test ? 'test' : 'live',
			formula_api_id: formulaId,
			message: test
				? `Deployed to test. Test window active for 6 hours. Use execute_calculator with test=true to try it.`
				: `Deployed to live. Calculator is now active and accessible via API.`,
		},
	};
}

function decryptApiKey(encrypted: string | null | undefined, encryptionKey?: string): string | undefined {
	if (!encrypted) return undefined;
	if (!encrypted.startsWith('v1:')) return encrypted;
	if (!encryptionKey) return undefined;

	try {
		const keyBuf = Buffer.from(encryptionKey, 'hex');
		const parts = encrypted.slice(3).split(':');
		if (parts.length !== 3) return undefined;
		const iv = Buffer.from(parts[0], 'base64');
		const tag = Buffer.from(parts[1], 'base64');
		const ciphertext = Buffer.from(parts[2], 'base64');
		const decipher = createDecipheriv('aes-256-gcm', keyBuf, iv);
		decipher.setAuthTag(tag);
		return decipher.update(ciphertext) + decipher.final('utf8');
	} catch {
		return undefined;
	}
}

// ─── Knowledge Base tools ────────────────────────────────────────

async function listKnowledgeBases(db: DB, accountId: string) {
	const kbs = await db('knowledge_bases')
		.where('account', accountId)
		.select('id', 'name', 'description', 'document_count', 'chunk_count', 'status', 'last_indexed')
		.orderBy('name');

	return {
		result: {
			knowledge_bases: kbs.map((kb: any) => ({
				id: kb.id,
				name: kb.name,
				description: kb.description,
				document_count: kb.document_count,
				chunk_count: kb.chunk_count,
				status: kb.status,
				last_indexed: kb.last_indexed,
			})),
			count: kbs.length,
		},
	};
}

async function searchKnowledge(db: DB, accountId: string, query: string, kbId?: string, limit?: number, authToken?: string) {
	if (!query?.trim()) return { result: 'Query is required.', isError: true };

	// Check if pgvector extension and kb_chunks table exist
	try {
		const tableCheck = await db.raw(`
			SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'kb_chunks') as exists
		`);
		if (!tableCheck.rows?.[0]?.exists) {
			return { result: 'Knowledge base not set up yet. Upload documents first.', isError: true };
		}
	} catch {
		return { result: 'Knowledge base not available.', isError: true };
	}

	// Verify KB ownership if specified
	if (kbId) {
		const kb = await db('knowledge_bases').where('id', kbId).where('account', accountId).first();
		if (!kb) return { result: `Knowledge base "${kbId}" not found in your account.`, isError: true };
	}

	// Call the KB search endpoint internally via HTTP
	try {
		const searchLimit = Math.min(limit || 5, 20);

		// Use internal fetch to KB API (same server)
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (authToken) headers['Authorization'] = authToken;
		const response = await fetch(`http://localhost:8055/kb/search`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ query, knowledge_base_id: kbId, limit: searchLimit, grouped: !kbId }),
		});

		// If KB API isn't available, fall back to direct DB query
		if (!response.ok) {
			throw new Error('KB API unavailable');
		}

		const data = await response.json();

		// When results are grouped by KB, format for Claude
		if (data.data?.results_by_kb) {
			return {
				result: {
					note: 'Results grouped by knowledge base. Attribute citations to their source KB.',
					results_by_kb: data.data.results_by_kb.map((group: any) => ({
						knowledge_base: group.knowledge_base.name,
						knowledge_base_id: group.knowledge_base.id,
						chunks: group.chunks.map((c: any) => ({
							content: c.content,
							metadata: c.metadata,
							similarity: c.similarity,
						})),
					})),
				},
			};
		}

		// Single KB — add KB name header if available
		const results = data.data;
		if (kbId && Array.isArray(results) && results.length > 0 && results[0].knowledge_base_name) {
			return {
				result: {
					knowledge_base: results[0].knowledge_base_name,
					chunks: results.map((c: any) => ({
						content: c.content,
						metadata: c.metadata,
						similarity: c.similarity,
					})),
				},
			};
		}

		return { result: results };
	} catch {
		// Fallback: direct DB query (no embedding — just text search)
		const results = await db('kb_chunks')
			.where('account_id', accountId)
			.modify((qb: any) => { if (kbId) qb.where('knowledge_base', kbId); })
			.whereRaw('content ILIKE ?', [`%${query.trim().split(/\s+/).join('%')}%`])
			.select('id', 'content', 'metadata', 'token_count')
			.limit(limit || 5);

		if (results.length === 0) {
			return { result: 'No matching documents found. The knowledge base may be empty or the search terms too specific.' };
		}

		return {
			result: {
				chunks: results.map((r: any) => ({
					content: r.content,
					metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
					note: 'Text search fallback (embedding search unavailable)',
				})),
			},
		};
	}
}

async function askKnowledge(db: DB, accountId: string, question: string, kbId?: string, logger?: any, authToken?: string) {
	if (!question?.trim()) return { result: 'Question is required.', isError: true };

	// Verify KB ownership if specified
	if (kbId) {
		const kb = await db('knowledge_bases').where('id', kbId).where('account', accountId).first();
		if (!kb) return { result: `Knowledge base "${kbId}" not found in your account.`, isError: true };
	}

	try {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (authToken) headers['Authorization'] = authToken;
		const response = await fetch(`http://localhost:8055/kb/ask`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ question, knowledge_base_id: kbId }),
		});

		if (!response.ok) {
			const err = await response.json().catch(() => null);
			return { result: err?.errors?.[0]?.message || 'Knowledge base query failed.', isError: true };
		}

		const data = await response.json();
		const result = data.data;

		return {
			result: {
				answer: result.answer,
				confidence: result.confidence,
				source_count: result.sources?.length || 0,
				sources: result.sources?.map((s: any) => ({
					file: s.metadata?.source_file,
					page: s.metadata?.page_number,
					section: s.metadata?.section_heading,
					similarity: s.similarity,
					knowledge_base: s.knowledge_base_name,
				})),
				cached: result.cached,
			},
		};
	} catch (err: any) {
		if (logger) logger.error(`ask_knowledge tool failed: ${err.message}`);
		return { result: 'Knowledge base service unavailable. Make sure documents are uploaded and indexed.', isError: true };
	}
}

// ─── KB icon auto-selection ──────────────────────────────────────

const KB_ICON_MAP: [string, string[]][] = [
	['gavel', ['legal', 'law', 'compliance', 'contract']],
	['account_balance', ['finance', 'banking', 'accounting', 'tax']],
	['science', ['research', 'science', 'lab']],
	['engineering', ['engineering', 'technical', 'infrastructure']],
	['health_and_safety', ['health', 'safety', 'medical']],
	['school', ['training', 'education', 'learning', 'course', 'onboarding']],
	['business', ['business', 'company', 'corporate', 'strategy']],
	['support_agent', ['support', 'help', 'customer', 'service', 'faq']],
	['inventory', ['inventory', 'product', 'catalog']],
	['security', ['security', 'cyber', 'privacy']],
	['policy', ['policy', 'procedure', 'guideline', 'handbook', 'manual']],
	['receipt_long', ['invoice', 'billing', 'receipt', 'pricing']],
	['analytics', ['analytics', 'data', 'metrics', 'report']],
	['code', ['code', 'api', 'developer', 'software', 'documentation']],
	['design_services', ['design', 'brand', 'creative', 'ux']],
];

function selectKbIcon(name: string, description?: string): string {
	const text = `${name} ${description || ''}`.toLowerCase();
	for (const [icon, keywords] of KB_ICON_MAP) {
		if (keywords.some((kw) => text.includes(kw))) return icon;
	}
	return 'menu_book';
}

// ─── Create knowledge base ───────────────────────────────────────

async function createKnowledgeBase(db: DB, accountId: string, input: { name: string; description?: string }) {
	if (!input.name?.trim()) return { result: 'Name is required.', isError: true };

	// Check KB limit
	const account = await db('account').where('id', accountId).select('exempt_from_subscription').first();
	if (!account?.exempt_from_subscription) {
		const sub = await db('subscriptions as s')
			.join('subscription_plans as sp', 'sp.id', 's.plan')
			.where('s.account', accountId)
			.whereNotIn('s.status', ['canceled', 'expired'])
			.select('sp.kb_limit')
			.first();

		if (sub?.kb_limit !== null && sub?.kb_limit !== undefined) {
			const { count } = await db('knowledge_bases')
				.where('account', accountId)
				.count('* as count')
				.first() as any;
			const total = parseInt(count, 10) || 0;
			if (total >= sub.kb_limit) {
				return { result: `Knowledge base limit reached (${sub.kb_limit}). Upgrade your plan to create more.`, isError: true };
			}
		}
	}

	const icon = selectKbIcon(input.name, input.description);
	const id = randomUUID();

	await db('knowledge_bases').insert({
		id,
		name: input.name.trim(),
		description: input.description?.trim() || null,
		icon,
		account: accountId,
		document_count: 0,
		chunk_count: 0,
		embedding_model: 'text-embedding-3-small',
		status: 'active',
	});

	return {
		result: {
			id,
			name: input.name.trim(),
			description: input.description?.trim() || null,
			icon,
			message: 'Knowledge base created. Upload documents to start indexing.',
		},
	};
}

// ─── Get knowledge base details ──────────────────────────────────

async function getKnowledgeBase(db: DB, accountId: string, input: { id?: string; name?: string }) {
	if (!input.id && !input.name) return { result: 'Provide id or name to look up a knowledge base.', isError: true };

	let kb: any;
	if (input.id) {
		kb = await db('knowledge_bases').where('id', input.id).where('account', accountId).first();
	} else {
		kb = await db('knowledge_bases')
			.where('account', accountId)
			.whereRaw('LOWER(name) LIKE ?', [`%${input.name!.toLowerCase()}%`])
			.first();
	}

	if (!kb) return { result: `Knowledge base not found in your account.`, isError: true };

	// Fetch documents
	const docs = await db('kb_documents')
		.where('knowledge_base', kb.id)
		.select('id', 'title', 'file_type', 'indexing_status', 'chunk_count')
		.orderBy('date_created', 'desc');

	return {
		result: {
			id: kb.id,
			name: kb.name,
			description: kb.description,
			icon: kb.icon,
			status: kb.status,
			document_count: kb.document_count,
			chunk_count: kb.chunk_count,
			embedding_model: kb.embedding_model,
			last_indexed: kb.last_indexed,
			documents: docs.map((d: any) => ({
				id: d.id,
				title: d.title,
				file_type: d.file_type,
				indexing_status: d.indexing_status,
				chunk_count: d.chunk_count,
			})),
		},
	};
}

// ─── Upload to knowledge base ────────────────────────────────────

async function uploadToKnowledgeBase(
	db: DB,
	accountId: string,
	input: { knowledge_base_id: string; file_id: string; title?: string },
	authToken?: string,
	logger?: any,
) {
	// Verify KB ownership
	const kb = await db('knowledge_bases').where('id', input.knowledge_base_id).where('account', accountId).first();
	if (!kb) return { result: `Knowledge base "${input.knowledge_base_id}" not found in your account.`, isError: true };

	// Verify file exists
	const file = await db('directus_files').where('id', input.file_id).first('id', 'filename_download', 'type');
	if (!file) return { result: `File "${input.file_id}" not found. Upload the file to Directus first.`, isError: true };

	// Call internal KB upload endpoint
	try {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (authToken) headers['Authorization'] = authToken;

		const response = await fetch(`http://localhost:8055/kb/${input.knowledge_base_id}/upload`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				file_id: input.file_id,
				title: input.title || file.filename_download,
			}),
		});

		if (!response.ok) {
			const err = await response.json().catch(() => null);
			return { result: err?.errors?.[0]?.message || 'Upload failed.', isError: true };
		}

		const data = await response.json();
		return {
			result: {
				document: data.data,
				message: 'Document uploaded and indexing started. Use get_knowledge_base to check indexing progress.',
			},
		};
	} catch (err: any) {
		if (logger) logger.error(`upload_to_knowledge_base failed: ${err.message}`);
		return { result: 'Knowledge base upload service unavailable.', isError: true };
	}
}
