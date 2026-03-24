export interface Calculator {
	id: string;
	name: string | null;
	description: string | null;
	status?: string | null;
	sort: number | null;
	account: string | null;
	user_created: string | null;
	date_created: string | null;
	user_updated: string | null;
	date_updated: string | null;
	activated?: boolean;
	onboarded?: boolean;
	test_enabled_at?: string | null;
	test_expires_at?: string | null;
	activation_expires_at?: string | null;
	icon?: string | null;
	over_limit?: boolean;
	configs?: CalculatorConfig[];
}

export interface DirectusFile {
	id: string;
	filename_download: string;
	title: string | null;
	type: string | null;
	filesize: number | null;
}

export interface InputParameter {
	mapping: string;
	title: string;
	description?: string;
	type: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'time' | 'datetime' | 'percentage' | 'currency';
	default?: number | string | boolean | null;
	// number constraints
	minimum?: number | null;
	maximum?: number | null;
	multipleOf?: number | null;
	// display hint
	display?: 'slider' | 'input';
	// currency code (e.g. "USD", "EUR")
	currency?: string;
	// string constraints
	minLength?: number | null;
	maxLength?: number | null;
	pattern?: string | null;
	// serialization hint
	transform?: 'date' | 'time' | 'datetime' | 'percentage' | 'currency';
	// predefined values
	selection_mapping_id?: string;
	selection_mapping_title?: string;
	oneOf?: Array<{ const: unknown; title: unknown }>;
	// metadata
	required?: boolean;
	order?: number;
}

export interface OutputArrayItem {
	mapping_item: string;
	title: string;
	description?: string | null;
	type: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'time' | 'datetime' | 'percentage' | 'currency';
	default?: number | string | boolean | null;
	transform?: 'date' | 'time' | 'datetime' | 'percentage' | 'currency';
}

export interface OutputParameter {
	mapping: string;
	title: string;
	description?: string | null;
	type: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'time' | 'datetime' | 'percentage' | 'currency' | 'array';
	readOnly?: boolean;
	transform?: 'date' | 'time' | 'datetime' | 'percentage';
	order?: number;
	items?: {
		type: 'object';
		properties: Record<string, OutputArrayItem>;
		required?: string[];
	};
}

export interface CallRecord {
	timestamp: string;
	error: boolean;
	cached: boolean;
	response_time_ms: number | null;
	error_message: string | null;
	test: boolean;
}

export interface CalculatorTemplate {
	id: string;
	name: string;
	description: string | null;
	icon: string | null;
	sheets: Record<string, unknown[][]> | null;
	formulas: Record<string, unknown> | null;
	input: Record<string, InputParameter> | null;
	output: Record<string, OutputParameter> | null;
	sort: number | null;
	featured: boolean;
	industry: string | null;
}

export interface CalculatorTestCase {
	id: string;
	name: string;
	input: Record<string, unknown> | null;
	expected_outputs: Record<string, unknown> | null;
	tolerance: number | null;
	sort: number | null;
	calculator: string | null;
	// runtime-only (not persisted)
	_result?: TestCaseResult | null;
}

export interface TestCaseResult {
	passed: boolean;
	expected: Record<string, unknown>;
	actual: Record<string, unknown>;
	diff: Record<string, { expected: unknown; actual: unknown }>;
	error?: string | null;
}

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
	calculator: string | null;
	description: string | null;
	api_key: string | null;
	excel_file: string | DirectusFile | null;
	sheets: Record<string, unknown[][]> | null;
	formulas: Record<string, unknown> | null;
	input: Record<string, InputParameter> | null;
	output: Record<string, OutputParameter> | null;
	test_environment: boolean;
	file_version: number | null;
	config_version: string | null;
	user_created: string | null;
	date_created: string | null;
	user_updated: string | null;
	date_updated: string | null;
	allowed_ips: string[] | null;
	allowed_origins: string[] | null;
	mcp: McpConfig | null;
	integration: IntegrationConfig | null;
	expressions: { name: string; expression: string; scope?: string }[] | null;
	profile: Record<string, unknown> | null;
	unresolved_functions: { name: string; references: string[] }[] | null;
}
