import type { FlowGraph, FlowNode, FlowEdge } from '../types';
import type { Node as VueFlowNode, Edge as VueFlowEdge } from '@vue-flow/core';

/**
 * Convert bl_flows.graph → Vue Flow format.
 * node_type → type, config → data.config
 */
export function toVueFlow(graph: FlowGraph): { nodes: VueFlowNode[]; edges: VueFlowEdge[] } {
	const nodes: VueFlowNode[] = graph.nodes.map((n) => ({
		id: n.id,
		type: 'base',
		position: n.position ?? { x: 0, y: 0 },
		data: {
			node_type: n.node_type,
			config: n.config,
			on_error: n.on_error,
			label: n.id,
		},
	}));

	const edges: VueFlowEdge[] = graph.edges.map((e, i) => ({
		id: `e-${e.from}-${e.to}-${i}`,
		source: e.from,
		target: e.to,
		sourceHandle: e.from_port || 'default',
		targetHandle: e.to_port || 'default',
		animated: !!e.back_edge,
		data: {
			back_edge: e.back_edge || null,
		},
	}));

	return { nodes, edges };
}

/**
 * Convert Vue Flow format → bl_flows.graph.
 * type → node_type, data.config → config
 */
export function fromVueFlow(nodes: VueFlowNode[], edges: VueFlowEdge[]): FlowGraph {
	const flowNodes: FlowNode[] = nodes.map((n) => ({
		id: n.id,
		node_type: n.data?.node_type || 'core:noop',
		config: n.data?.config || {},
		on_error: n.data?.on_error,
		position: { x: n.position.x, y: n.position.y },
	}));

	const flowEdges: FlowEdge[] = edges.map((e) => ({
		from: e.source,
		to: e.target,
		from_port: e.sourceHandle || 'default',
		to_port: e.targetHandle || 'default',
		back_edge: e.data?.back_edge || null,
	}));

	return { nodes: flowNodes, edges: flowEdges };
}

/** Generate a unique node ID based on type */
export function generateNodeId(nodeType: string, existingIds: Set<string>): string {
	const base = nodeType.replace(':', '_');
	let i = 1;
	while (existingIds.has(`${base}_${i}`)) i++;
	return `${base}_${i}`;
}
