import type { Knex } from 'knex';

export type DB = Knex;

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

export interface ValidateRequest {
	graph: {
		nodes: FlowNode[];
		edges: FlowEdge[];
	};
	caller_role?: 'Any' | 'Admin';
}

export interface ValidateResponse {
	valid: boolean;
	errors: string[];
	warnings: string[];
	node_permissions: Record<string, string>;
}

export interface FlowNode {
	id: string;
	node_type: string;
	config: Record<string, unknown>;
	on_error?: string;
	position?: { x: number; y: number };
}

export interface FlowEdge {
	from: string;
	to: string;
	from_port?: string;
	to_port?: string;
	back_edge?: { guard: string; max_iterations: number } | null;
}
