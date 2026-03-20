import Anthropic from '@anthropic-ai/sdk';
import type { ConversationMessage, ToolDefinition } from './types.js';

export interface StreamEvent {
	type: 'text_delta' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_stop' | 'message_stop' | 'error' | 'usage';
	data: any;
}

export interface ChatOptions {
	model: string;
	systemPrompt: string;
	messages: ConversationMessage[];
	tools?: ToolDefinition[];
	maxOutputTokens?: number;
	signal?: AbortSignal;
}

export interface ChatResult {
	content: any[];
	stopReason: string | null;
	usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
}

export class AiClient {
	private client: Anthropic;

	constructor(apiKey: string) {
		this.client = new Anthropic({ apiKey });
	}

	async *streamChat(options: ChatOptions): AsyncGenerator<StreamEvent> {
		const { model, systemPrompt, messages, tools, maxOutputTokens = 4096, signal } = options;

		const params: any = {
			model,
			max_tokens: maxOutputTokens,
			system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
			messages: messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
		};

		if (tools && tools.length > 0) {
			params.tools = tools;
		}

		try {
			const stream = this.client.messages.stream(params, { signal });

			for await (const event of stream) {
				if (event.type === 'content_block_start') {
					if (event.content_block.type === 'tool_use') {
						yield {
							type: 'tool_use_start',
							data: { id: event.content_block.id, name: event.content_block.name },
						};
					}
				} else if (event.type === 'content_block_delta') {
					if (event.delta.type === 'text_delta') {
						yield { type: 'text_delta', data: { text: event.delta.text } };
					} else if (event.delta.type === 'input_json_delta') {
						yield { type: 'tool_use_delta', data: { partial_json: event.delta.partial_json } };
					}
				} else if (event.type === 'content_block_stop') {
					// Could be text or tool_use block ending
				} else if (event.type === 'message_stop') {
					// Will get final message from finalMessage()
				}
			}

			const finalMessage = await stream.finalMessage();
			yield {
				type: 'usage',
				data: finalMessage.usage,
			};
			yield {
				type: 'message_stop',
				data: {
					content: finalMessage.content,
					stop_reason: finalMessage.stop_reason,
					usage: finalMessage.usage,
				},
			};
		} catch (err: any) {
			if (err.name === 'AbortError' || signal?.aborted) {
				return;
			}
			yield { type: 'error', data: { message: err.message } };
		}
	}
}
