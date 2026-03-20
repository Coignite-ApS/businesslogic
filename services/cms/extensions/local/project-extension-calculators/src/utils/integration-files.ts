import type { InputParameter, OutputParameter } from '../types';

export interface IntegrationFileParams {
	calculatorName: string;
	calculatorDescription: string | null;
	effectiveId: string;
	toolName: string;
	formulaApiUrl: string;
	token: string;
	inputParams: Record<string, InputParameter>;
	outputParams: Record<string, OutputParameter>;
}

function buildParamTable(entries: [string, { type: string; title?: string; description?: string | null; default?: unknown; required?: boolean }][]): string[] {
	if (!entries.length) return ['No parameters defined.'];
	const lines = [
		'| Parameter | Type | Required | Default | Description |',
		'|-----------|------|----------|---------|-------------|',
	];
	for (const [key, param] of entries) {
		const req = param.required ? 'Yes' : 'No';
		const def = param.default != null ? String(param.default) : '—';
		const desc = param.description || param.title || '—';
		lines.push(`| \`${key}\` | ${param.type} | ${req} | ${def} | ${desc} |`);
	}
	return lines;
}

function buildSampleBody(entries: [string, { type: string; default?: unknown }][]): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	for (const [key, param] of entries) {
		if (param.default != null) {
			body[key] = param.default;
		} else if (param.type === 'number' || param.type === 'integer' || param.type === 'percentage' || param.type === 'currency') {
			body[key] = 0;
		} else if (param.type === 'boolean') {
			body[key] = false;
		} else {
			body[key] = '';
		}
	}
	return body;
}

export function generateSkillMd(params: IntegrationFileParams): string {
	const desc = params.calculatorDescription || params.calculatorName;
	const endpoint = `${params.formulaApiUrl}/execute/calculator/${params.effectiveId}`;
	const inputEntries = Object.entries(params.inputParams);
	const outputEntries = Object.entries(params.outputParams);
	const sampleBody = buildSampleBody(inputEntries);

	const lines: string[] = [
		'---',
		`name: ${params.toolName}`,
		`description: "${desc}"`,
		'user_invocable: true',
		'---',
		'',
		`# ${params.calculatorName}`,
		'',
		desc,
		'',
		'## Input Parameters',
		'',
		...buildParamTable(inputEntries),
		'',
		'## Output Parameters',
		'',
		...buildParamTable(outputEntries),
		'',
		'## API Details',
		'',
		`- **Endpoint**: \`POST ${endpoint}\``,
		`- **Auth Header**: \`X-Auth-Token: ${params.token}\``,
		'- **Content-Type**: `application/json`',
		'',
		'## Example Request',
		'',
		'```bash',
		`curl -X POST '${endpoint}' \\`,
		`  -H 'Content-Type: application/json' \\`,
		`  -H 'X-Auth-Token: ${params.token}' \\`,
		`  -d '${JSON.stringify(sampleBody)}'`,
		'```',
		'',
		'## Usage',
		'',
		`Invoke via \`/${params.toolName}\` in Claude Code.`,
		'',
	];

	return lines.join('\n');
}

export function generatePluginJson(params: IntegrationFileParams): string {
	const desc = params.calculatorDescription || params.calculatorName;
	const obj = {
		schema_version: 'v1',
		name_for_human: params.calculatorName,
		name_for_model: params.toolName,
		description_for_human: desc,
		description_for_model: desc,
		api: {
			type: 'openapi',
			url: `${params.formulaApiUrl}/calculator/${params.effectiveId}/describe`,
		},
		auth: {
			type: 'service_http',
			authorization_type: 'custom',
			custom_auth_header: 'X-Auth-Token',
		},
	};
	return JSON.stringify(obj, null, 2);
}

export function generateMcpJson(params: IntegrationFileParams): string {
	const obj = {
		mcpServers: {
			[params.toolName]: {
				url: `${params.formulaApiUrl}/mcp/calculator/${params.effectiveId}`,
				headers: { 'X-Auth-Token': params.token },
			},
		},
	};
	return JSON.stringify(obj, null, 2);
}
