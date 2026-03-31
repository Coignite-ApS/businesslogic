import { FormulaApiError } from './formula-api.js';
import type { CalculatorConfig, FormulaApiCalculatorPayload, McpConfig, DB } from './types.js';

export interface LookupResult {
	calc: any;
	config: any;
	isTest: boolean;
}

export interface LookupError {
	error: string;
	status: number;
}

/**
 * Shared calculator + config lookup used by recipes and mcp-config endpoints.
 * Returns the calculator, its config, and whether it's a test environment.
 */
export async function lookupCalculatorConfig(
	id: string,
	services: any,
	getSchema: () => Promise<any>,
	db: DB,
	accountability: any,
	configFields: string[],
): Promise<LookupResult | LookupError> {
	const { ItemsService } = services;
	const schema = await getSchema();

	const calcService = new ItemsService('calculators', { schema, accountability });
	const configService = new ItemsService('calculator_configs', { schema, accountability });

	const calcFields = ['id', 'name', 'description', 'account', 'test_expires_at', 'activation_expires_at'];

	// Try live calculator by ID (activated=true)
	let calculators = await calcService.readByQuery({
		filter: { id: { _eq: id }, activated: { _eq: true } },
		fields: calcFields,
		limit: 1,
	});

	let isTest = false;

	// If not found, try test: strip -test suffix
	if (!calculators.length) {
		const baseId = id.endsWith('-test') ? id.slice(0, -5) : null;
		if (baseId) {
			calculators = await calcService.readByQuery({
				filter: { id: { _eq: baseId } },
				fields: calcFields,
				limit: 1,
			});
			isTest = true;
		}
	}

	if (!calculators.length) {
		return { error: 'Calculator not found or not activated', status: 404 };
	}

	const calc = calculators[0];

	// Check expiry (exempt accounts bypass)
	const acct = await db('account').where('id', calc.account).select('exempt_from_subscription').first();
	if (!acct?.exempt_from_subscription) {
		if (isTest) {
			if (!calc.test_expires_at || new Date(calc.test_expires_at) < new Date()) {
				return { error: 'Test window expired', status: 404 };
			}
		} else {
			if (calc.activation_expires_at && new Date(calc.activation_expires_at) < new Date()) {
				return { error: 'Calculator activation expired', status: 404 };
			}
		}
	}

	// Fetch the matching config
	const configs = await configService.readByQuery({
		filter: {
			calculator: { _eq: calc.id },
			test_environment: { _eq: isTest },
		},
		fields: configFields,
		limit: 1,
	});

	if (!configs.length) {
		return { error: 'Calculator config not found', status: 404 };
	}

	return { calc, config: configs[0], isTest };
}

export function handleFormulaApiError(err: unknown, res: any) {
	if (err instanceof FormulaApiError) {
		if (err.status >= 500) {
			return res.status(502).json({ errors: [{ message: 'Formula API unavailable' }] });
		}
		const body = err.body as any;

		// Pass through structured 422 OUTPUT_ERROR with per-field details
		if (err.status === 422 && body?.code === 'OUTPUT_ERROR' && Array.isArray(body?.fields)) {
			return res.status(422).json(body);
		}

		// Pass through 400 validation errors with details array
		if (err.status === 400 && Array.isArray(body?.details)) {
			return res.status(400).json(body);
		}

		const message = body?.error && body?.detail
			? `${body.error}: ${body.detail}`
			: body?.detail || body?.error || body?.message || 'Unknown error';
		return res.status(err.status).json({ errors: [{ message }] });
	}
	// Network error
	return res.status(502).json({ errors: [{ message: 'Formula API unavailable' }] });
}

/** Strip internal-only fields and coerce oneOf titles to strings for Formula API */
const INTERNAL_KEYS = new Set(['selection_mapping_id', 'selection_mapping_title', 'display', 'currency']);

function sanitizeParam(param: Record<string, any>): Record<string, any> {
	const cleaned: Record<string, any> = {};
	for (const [k, v] of Object.entries(param)) {
		if (!INTERNAL_KEYS.has(k)) cleaned[k] = v;
	}
	if (Array.isArray(cleaned.oneOf)) {
		cleaned.oneOf = cleaned.oneOf.map((o: any) => ({ ...o, title: o.title != null ? String(o.title) : String(o.const) }));
	}
	return cleaned;
}

function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
	const props = (schema as any)?.properties;
	if (!props || typeof props !== 'object') return schema;
	const cleaned: Record<string, any> = { ...schema, properties: {} };
	for (const [key, param] of Object.entries(props as Record<string, any>)) {
		cleaned.properties[key] = sanitizeParam(param);
	}
	return cleaned;
}

export function buildPayload(config: CalculatorConfig, meta?: { calculator_id?: string; name?: string; description?: string | null; account_id?: string | null }): FormulaApiCalculatorPayload {
	const isTest = !!config.test_environment;
	const slug = meta?.calculator_id || 'unknown';
	const name = isTest ? `${slug}-test` : slug;
	return {
		calculatorId: name,
		name,
		description: meta?.description ?? undefined,
		version: String(config.config_version ?? 1),
		token: config.api_key || undefined,
		test: isTest,
		accountId: meta?.account_id || null,
		sheets: config.sheets!,
		formulas: config.formulas!,
		input: sanitizeSchema(config.input as Record<string, unknown>),
		output: sanitizeSchema(config.output as Record<string, unknown>),
		allowedIps: config.allowed_ips?.length ? config.allowed_ips : undefined,
		allowedOrigins: config.allowed_origins?.length ? config.allowed_origins : undefined,
		mcp: config.mcp ? {
			enabled: config.mcp.enabled,
			toolName: config.mcp.toolName,
			toolDescription: config.mcp.toolDescription || null,
			responseTemplate: config.mcp.responseTemplate || null,
		} : undefined,
		integration: config.integration ? {
			skill: config.integration.skill,
			plugin: config.integration.plugin,
			responseTemplate: config.integration.responseTemplate || null,
		} : undefined,
		expressions: config.expressions?.length ? config.expressions : undefined,
	};
}

export function buildRecipe(config: any) {
	const isTest = !!config.test_environment;
	const slug = config.calculator_id || 'unknown';
	return {
		sheets: config.sheets,
		formulas: config.formulas,
		inputSchema: config.input,
		outputSchema: config.output,
		dataMappings: [],
		locale: null,
		generation: 0,
		name: isTest ? `${slug}-test` : slug,
		version: String(config.config_version ?? 1),
		description: config.description ?? null,
		test: isTest || null,
		token: config.api_key || null,
		accountId: config.account_id || null,
		expressions: config.expressions?.length ? config.expressions : undefined,
	};
}

export function configIsComplete(config: { sheets?: unknown; formulas?: unknown; input?: unknown; output?: unknown }) {
	return config.sheets && config.formulas && config.input && config.output;
}

/** Convert "my-calc" → "my_calc" */
export function toSnakeCase(id: string): string {
	return id.replace(/-/g, '_');
}

/** Build JSON Schema for MCP tool from calculator input params */
export function buildMcpInputSchema(input: Record<string, unknown>, paramDescriptions?: Record<string, string>): Record<string, unknown> {
	const props = (input as any)?.properties;
	if (!props || typeof props !== 'object') return { type: 'object', properties: {} };

	const schema: Record<string, any> = {};
	const required: string[] = [];

	for (const [key, param] of Object.entries(props) as [string, any][]) {
		const prop: Record<string, any> = { type: param.type || 'string' };
		if (paramDescriptions?.[key]) prop.description = paramDescriptions[key];
		else if (param.description) prop.description = param.description;
		if (param.title) prop.title = param.title;
		if (param.oneOf) prop.enum = param.oneOf.map((o: any) => o.const);
		if (param.minimum != null) prop.minimum = param.minimum;
		if (param.maximum != null) prop.maximum = param.maximum;
		if (param.default != null) prop.default = param.default;
		schema[key] = prop;
		if (param.required) required.push(key);
	}

	return { type: 'object', properties: schema, ...(required.length ? { required } : {}) };
}

export interface McpSnippetParams {
	toolName: string;
	mcpUrl: string;
}

/** Generate platform-specific MCP config snippets */
export function buildMcpSnippets({ toolName, mcpUrl }: McpSnippetParams): Record<string, { config: string; filePath: string }> {
	const fmt = (obj: unknown) => JSON.stringify(obj, null, 2);

	const remoteBlock = {
		command: 'npx',
		args: ['-y', 'mcp-remote', mcpUrl],
	};

	return {
		claude_desktop: {
			config: fmt({ mcpServers: { [toolName]: { url: mcpUrl } } }),
			filePath: 'claude_desktop_config.json',
		},
		cursor: {
			config: fmt({ mcpServers: { [toolName]: remoteBlock } }),
			filePath: '.cursor/mcp.json',
		},
		vscode: {
			config: fmt({ mcp: { servers: { [toolName]: { type: 'stdio', ...remoteBlock } } } }),
			filePath: '.vscode/settings.json',
		},
		windsurf: {
			config: fmt({ mcpServers: { [toolName]: remoteBlock } }),
			filePath: '~/.codeium/windsurf/mcp_config.json',
		},
	};
}
