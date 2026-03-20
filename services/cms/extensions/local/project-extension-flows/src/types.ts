export interface FlowItem {
	id: string;
	name: string | null;
	description: string | null;
	account_id: string | null;
	status: 'draft' | 'active' | 'disabled';
	graph: FlowGraph | null;
	trigger_config: TriggerConfig | null;
	settings: FlowSettings | null;
	version: number;
	created_at: string | null;
	updated_at: string | null;
	created_by: string | null;
	updated_by: string | null;
}

export interface FlowGraph {
	nodes: FlowNode[];
	edges: FlowEdge[];
}

export interface FlowNode {
	id: string;
	node_type: string;
	config: Record<string, unknown>;
	on_error?: ErrorStrategy;
	position?: { x: number; y: number };
}

export interface FlowEdge {
	from: string;
	to: string;
	from_port?: string;
	to_port?: string;
	back_edge?: { guard: string; max_iterations: number } | null;
}

export type ErrorStrategy =
	| 'Abort'
	| 'Skip'
	| 'Fallback'
	| { Retry: { max_retries: number; initial_delay_ms: number; backoff_multiplier: number } };

export interface TriggerConfig {
	type: 'manual' | 'webhook' | 'cron' | 'db_event';
	webhook_secret?: string;
	cron_expression?: string;
	collection?: string;
	event?: string;
}

export interface FlowSettings {
	mode: 'Parallel' | 'Sequential' | 'Streaming';
	timeout_ms: number;
	priority: 'Critical' | 'Normal' | 'Batch';
	worker_group?: string | null;
	budget_limit_usd?: number | null;
}

export interface NodeTypeMeta {
	id: string;
	name: string;
	description: string;
	category: string;
	tier: 'Core' | 'Wasm' | 'External';
	inputs: PortDef[];
	outputs: PortDef[];
	config_schema: Record<string, unknown>;
	estimated_cost_usd: number;
	required_role: 'Any' | 'Admin';
}

export interface PortDef {
	name: string;
	data_type: string;
	required: boolean;
}

export interface ExecutionSummary {
	id: string;
	status: string;
	error: string | null;
	duration_ms: number | null;
	nodes_executed: number | null;
	cost_usd: number | null;
	started_at: string | null;
}

export interface ExecutionDetail extends ExecutionSummary {
	flow_id: string;
	account_id: string | null;
	worker_id: string | null;
	context?: Record<string, unknown>;
	trigger_data?: unknown;
	result?: unknown;
}

export interface ValidateResponse {
	valid: boolean;
	errors: string[];
	warnings: string[];
	node_permissions: Record<string, string>;
}

export type NodeStatusMap = Record<string, 'pending' | 'running' | 'completed' | 'failed'>;
