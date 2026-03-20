import type { DB } from './types.js';

export interface ModelSelection {
	model: string;
	maxOutputTokens: number;
	maxInputTokens: number;
}

const ALLOWED_MODELS = [
	'claude-sonnet-4-6',
	'claude-haiku-4-5-20251001',
	'claude-opus-4-6',
];

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_OUTPUT = 4096;
const DEFAULT_MAX_INPUT = 100000;

export async function resolveModel(
	db: DB,
	taskCategory: string,
	envDefaults: { defaultModel?: string; allowedModels?: string },
): Promise<ModelSelection> {
	try {
		const config = await db('ai_model_config')
			.where('task_category', taskCategory)
			.where('enabled', true)
			.first();

		if (config) {
			const model = validateModel(config.model, envDefaults);
			return {
				model,
				maxOutputTokens: config.max_output_tokens || DEFAULT_MAX_OUTPUT,
				maxInputTokens: config.max_input_tokens || DEFAULT_MAX_INPUT,
			};
		}
	} catch {
		// Table may not exist yet — use defaults
	}

	return {
		model: validateModel(envDefaults.defaultModel || DEFAULT_MODEL, envDefaults),
		maxOutputTokens: DEFAULT_MAX_OUTPUT,
		maxInputTokens: DEFAULT_MAX_INPUT,
	};
}

function validateModel(
	model: string,
	envDefaults: { allowedModels?: string },
): string {
	const allowed = envDefaults.allowedModels
		? envDefaults.allowedModels.split(',').map((m) => m.trim())
		: ALLOWED_MODELS;

	if (allowed.includes(model)) return model;
	return DEFAULT_MODEL;
}
