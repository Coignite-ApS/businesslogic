export interface McpConfig {
	enabled: boolean;
	toolName: string;
	toolDescription: string;
	parameterDescriptions: Record<string, string>;
	responseTemplate: string;
}

export interface IntegrationConfig {
	responseTemplate: string;
	skill: boolean;
	plugin: boolean;
	mcpResponseOverride?: string;
	skillResponseOverride?: string;
	pluginResponseOverride?: string;
}

export interface CalculatorConfig {
	id: string;
	calculator: string;
	description: string | null;
	sheets: Record<string, unknown> | null;
	formulas: Record<string, unknown> | null;
	input: unknown[] | null;
	output: unknown[] | null;
	test_environment: boolean;
	file_version: number | null;
	config_version: number | null;
	api_key: string | null;
	allowed_ips: string[] | null;
	allowed_origins: string[] | null;
	mcp: McpConfig | null;
	integration: IntegrationConfig | null;
	expressions: { name: string; expression: string; scope?: string }[] | null;
	profile: Record<string, unknown> | null;
	unresolved_functions: { name: string; references: string[] }[] | null;
}

export interface Calculator {
	id: string;
	name: string;
	description: string | null;
	account: string;
	activated?: boolean;
	test_enabled_at?: string | null;
	test_expires_at?: string | null;
	activation_expires_at?: string | null;
	over_limit?: boolean;
}

export interface FormulaApiCalculatorPayload {
	calculatorId?: string;
	name?: string;
	version?: string;
	description?: string;
	token?: string;
	test?: boolean;
	accountId?: string | null;
	sheets: Record<string, unknown>;
	formulas: Record<string, unknown>;
	input: unknown[];
	output: unknown[];
	allowedIps?: string[];
	allowedOrigins?: string[];
	mcp?: {
		enabled: boolean;
		toolName: string;
		toolDescription: string | null;
		responseTemplate: string | null;
	};
	integration?: {
		skill: boolean;
		plugin: boolean;
		responseTemplate: string | null;
	};
	expressions?: { name: string; expression: string; scope?: string }[] | null;
}

export interface FormulaApiCreateResponse {
	calculatorId: string;
	profile?: Record<string, unknown>;
}

export interface AccountabilityRequest {
	accountability?: {
		user?: string;
		admin?: boolean;
	};
}

export type DB = any;
