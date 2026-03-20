export type DB = any;

export interface AiConversation {
	id: string;
	account: string;
	user_created: string;
	title: string | null;
	messages: ConversationMessage[];
	model: string | null;
	total_input_tokens: number;
	total_output_tokens: number;
	status: string;
	date_created: string;
	date_updated: string | null;
}

export interface ConversationMessage {
	role: 'user' | 'assistant';
	content: string | ContentBlock[];
}

export interface ContentBlock {
	type: 'text' | 'tool_use' | 'tool_result';
	text?: string;
	id?: string;
	name?: string;
	input?: unknown;
	tool_use_id?: string;
	content?: string;
	is_error?: boolean;
}

export interface AiModelConfig {
	id: string;
	task_category: string;
	model: string;
	max_output_tokens: number;
	max_input_tokens: number;
	enabled: boolean;
}

export interface ChatRequest {
	conversation_id?: string;
	message: string;
	prompt_id?: string;
}

export interface SSEEvent {
	type: 'text_delta' | 'tool_use' | 'tool_result' | 'done' | 'error';
	data: unknown;
}

export interface ToolDefinition {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}
