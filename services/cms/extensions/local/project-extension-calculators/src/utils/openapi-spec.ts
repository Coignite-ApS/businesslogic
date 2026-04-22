/**
 * OpenAPI 3.0 spec generator for calculator endpoints.
 *
 * Generates a per-calculator spec with:
 * - POST /execute/{id} — run a calculation
 * - GET  /describe/{id} — get schema metadata
 * - ApiKeyAuth via X-API-Key header
 *
 * Type mapping:
 * - date/time/datetime → string + format
 * - percentage → number (0–100)
 * - array → array of objects with nested properties
 */
import type { InputParameter, OutputParameter } from '../types';

export interface OpenApiSpecParams {
	calculatorName: string;
	calculatorId: string;
	calculatorDescription?: string | null;
	baseUrl: string;
	inputParams: Record<string, InputParameter>;
	outputParams: Record<string, OutputParameter>;
}

function mapType(type: string): { type: string; format?: string; minimum?: number; maximum?: number } {
	switch (type) {
		case 'date': return { type: 'string', format: 'date' };
		case 'time': return { type: 'string', format: 'time' };
		case 'datetime': return { type: 'string', format: 'date-time' };
		case 'percentage': return { type: 'number', minimum: 0, maximum: 100 };
		case 'integer': return { type: 'integer' };
		case 'boolean': return { type: 'boolean' };
		case 'number': return { type: 'number' };
		default: return { type: 'string' };
	}
}

function inputToSchema(param: InputParameter): Record<string, unknown> {
	const base = mapType(param.type);
	const schema: Record<string, unknown> = { type: base.type };

	if (base.format) schema.format = base.format;
	if (param.title) schema.title = param.title;
	if (param.description) schema.description = param.description;
	if (param.default != null) schema.default = param.default;
	if (param.minimum != null) schema.minimum = param.minimum;
	else if (base.minimum != null) schema.minimum = base.minimum;
	if (param.maximum != null) schema.maximum = param.maximum;
	else if (base.maximum != null) schema.maximum = base.maximum;
	if (param.minLength != null) schema.minLength = param.minLength;
	if (param.maxLength != null) schema.maxLength = param.maxLength;
	if (param.pattern) schema.pattern = param.pattern;
	if (param.oneOf?.length) {
		schema.oneOf = param.oneOf.map((o) => ({
			const: o.const,
			title: String(o.title ?? o.const),
		}));
	}

	return schema;
}

function outputToSchema(param: OutputParameter): Record<string, unknown> {
	if (param.type === 'array' && param.items?.properties) {
		const props: Record<string, unknown> = {};
		for (const [key, sub] of Object.entries(param.items.properties)) {
			const subBase = mapType(sub.type);
			const subSchema: Record<string, unknown> = { type: subBase.type };
			if (subBase.format) subSchema.format = subBase.format;
			if (sub.title) subSchema.title = sub.title;
			if (sub.description) subSchema.description = sub.description;
			props[key] = subSchema;
		}
		const schema: Record<string, unknown> = {
			type: 'array',
			items: { type: 'object', properties: props },
		};
		if (param.title) schema.title = param.title;
		if (param.description) schema.description = param.description;
		return schema;
	}

	const base = mapType(param.type);
	const schema: Record<string, unknown> = { type: base.type };
	if (base.format) schema.format = base.format;
	if (param.title) schema.title = param.title;
	if (param.description) schema.description = param.description;
	return schema;
}

export function generateOpenApiSpec(params: OpenApiSpecParams): Record<string, unknown> {
	const { calculatorName, calculatorId, calculatorDescription, baseUrl, inputParams, outputParams } = params;

	const inputProperties: Record<string, unknown> = {};
	for (const [key, param] of Object.entries(inputParams)) {
		inputProperties[key] = inputToSchema(param);
	}

	const outputProperties: Record<string, unknown> = {};
	for (const [key, param] of Object.entries(outputParams)) {
		outputProperties[key] = outputToSchema(param);
	}

	return {
		openapi: '3.0.0',
		info: {
			title: calculatorName,
			...(calculatorDescription ? { description: calculatorDescription } : {}),
			version: '1.0.0',
		},
		servers: [{ url: baseUrl }],
		security: [{ ApiKeyAuth: [] }],
		paths: {
			[`/execute/${calculatorId}`]: {
				post: {
					summary: `Execute ${calculatorName}`,
					operationId: 'executeCalculator',
					requestBody: {
						required: true,
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: inputProperties,
								},
							},
						},
					},
					responses: {
						'200': {
							description: 'Calculation result',
							content: {
								'application/json': {
									schema: {
										type: 'object',
										properties: outputProperties,
									},
								},
							},
						},
					},
					security: [{ ApiKeyAuth: [] }],
				},
			},
			[`/describe/${calculatorId}`]: {
				get: {
					summary: `Describe ${calculatorName}`,
					operationId: 'describeCalculator',
					responses: {
						'200': {
							description: 'Calculator schema metadata',
							content: {
								'application/json': {
									schema: { type: 'object' },
								},
							},
						},
					},
					security: [{ ApiKeyAuth: [] }],
				},
			},
		},
		components: {
			securitySchemes: {
				ApiKeyAuth: {
					type: 'apiKey',
					in: 'header',
					name: 'X-API-Key',
				},
			},
		},
	};
}

export function downloadOpenApiSpec(spec: Record<string, unknown>, calculatorId: string): void {
	const json = JSON.stringify(spec, null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${calculatorId}-openapi.json`;
	a.click();
	URL.revokeObjectURL(url);
}
