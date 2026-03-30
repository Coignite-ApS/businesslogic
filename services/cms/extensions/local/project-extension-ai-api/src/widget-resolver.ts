import type { Knex } from 'knex';

interface WidgetTemplate {
	id: string;
	name: string;
	tool_binding: string;
	resource_binding: string | null;
	template: string;
	data_mapping: string;
	status: string;
}

interface ChatKitNode {
	component: string;
	props?: Record<string, unknown>;
	children?: ChatKitNode[];
}

/**
 * Find a widget template for a tool call.
 * Resolution: specific resource_binding → default (null) → null
 */
async function findTemplate(db: Knex, toolName: string, resourceId?: string | null): Promise<WidgetTemplate | null> {
	try {
		if (resourceId) {
			const specific = await db('bl_widget_templates')
				.where({ tool_binding: toolName, resource_binding: resourceId, status: 'published' })
				.orderBy('sort', 'asc')
				.first();
			if (specific) return specific;
		}
		const defaultTpl = await db('bl_widget_templates')
			.where({ tool_binding: toolName, status: 'published' })
			.whereNull('resource_binding')
			.orderBy('sort', 'asc')
			.first();
		return defaultTpl || null;
	} catch {
		return null; // Table might not exist yet
	}
}

const PROTO_DENYLIST = new Set(['__proto__', 'constructor', 'prototype']);

/** JSONPath resolver — $.path.to.field */
function resolvePath(path: string, source: any): any {
	if (!path?.startsWith('$')) return path;
	const parts = path.slice(2).split('.').filter(Boolean);
	let current = source;
	for (const part of parts) {
		if (current == null) return null;
		const bracketMatch = part.match(/^(.+?)\[(\d+)\]$/);
		if (bracketMatch) {
			if (PROTO_DENYLIST.has(bracketMatch[1])) return null;
			current = current[bracketMatch[1]]?.[Number(bracketMatch[2])];
		} else {
			if (PROTO_DENYLIST.has(part)) return null;
			current = current[part];
		}
	}
	return current;
}

/** Apply format pipe */
function applyPipe(value: any, pipe: string): any {
	const [name, ...args] = pipe.split(':');
	const arg = args.join(':').trim();
	switch (name.trim()) {
		case 'currency': {
			const num = Number(value);
			if (isNaN(num)) return String(value ?? '');
			try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: arg || 'USD' }).format(num); }
			catch { return `${num.toFixed(2)} ${arg || 'USD'}`; }
		}
		case 'percent': return value != null ? `${Math.round(Number(value) * 100)}%` : null;
		case 'truncate': { const s = String(value ?? ''); const n = Number(arg) || 100; return s.length > n ? s.slice(0, n) + '\u2026' : s; }
		case 'string': return String(value ?? '');
		case 'default': return value ?? arg;
		case 'concat': return value != null ? `${value} ${arg}`.trim() : null;
		case 'entries': return typeof value === 'object' && !Array.isArray(value) ? Object.entries(value).map(([k, v]) => ({ key: k, value: v })) : value;
		default: return value;
	}
}

/** Resolve expression: $.path | pipe, 'literal' */
function resolveExpression(expr: string, source: any): any {
	const str = String(expr).trim();
	if (str.startsWith("'") && str.endsWith("'")) return str.slice(1, -1);
	const pipeIdx = str.indexOf(' | ');
	let path = str, pipes = '';
	if (pipeIdx >= 0) { path = str.slice(0, pipeIdx).trim(); pipes = str.slice(pipeIdx + 3).trim(); }
	let value = resolvePath(path, source);
	if (pipes) {
		for (const p of pipes.split(' | ')) {
			value = applyPipe(value, p.trim());
		}
	}
	return value;
}

/** Apply data mapping to source data */
function applyMapping(mapping: any, source: any): Record<string, any> {
	if (!mapping || !source) return {};
	const result: Record<string, any> = {};
	for (const [key, expr] of Object.entries(mapping)) {
		if (typeof expr === 'string') {
			result[key] = resolveExpression(expr, source);
		} else if (Array.isArray(expr)) {
			result[key] = (expr as any[]).map(item =>
				typeof item === 'object' && item ? applyMapping(item, source) : item
			);
		} else if (typeof expr === 'object' && expr !== null) {
			const obj = expr as any;
			if (obj.source && obj.map) {
				const arr = resolveExpression(obj.source, source);
				result[key] = Array.isArray(arr) ? arr.map((item: any) => {
					const mapped: Record<string, any> = {};
					for (const [mk, mv] of Object.entries(obj.map)) {
						mapped[mk] = typeof mv === 'string' ? resolveExpression(mv, item) : mv;
					}
					return mapped;
				}) : [];
			} else {
				result[key] = applyMapping(obj, source);
			}
		} else {
			result[key] = expr;
		}
	}
	return result;
}

/** Hydrate template tree with mapped data */
function hydrateTemplate(tree: any, data: any): ChatKitNode | null {
	if (!tree) return null;
	const result: ChatKitNode = { component: tree.component };
	if (tree.props) {
		result.props = {};
		for (const [key, value] of Object.entries(tree.props)) {
			result.props[key] = hydrateValue(value, data);
		}
	}
	if (tree.children) {
		result.children = [];
		for (const child of tree.children) {
			if (child.component === '__each' && child.props?.source) {
				const arr = data[child.props.source as string];
				if (Array.isArray(arr) && child.children?.[0]) {
					for (const item of arr) {
						const h = hydrateTemplate(child.children[0], { ...data, ...item, _item: item });
						if (h) result.children.push(h);
					}
				}
			} else {
				const h = hydrateTemplate(child, data);
				if (h) result.children.push(h);
			}
		}
	}
	return result;
}

function hydrateValue(value: any, data: any): any {
	if (typeof value === 'string') {
		const full = value.match(/^\{\{(\w+(?:\.\w+)*)\}\}$/);
		if (full) return full[1].split('.').reduce((o: any, k: string) => PROTO_DENYLIST.has(k) ? undefined : o?.[k], data);
		return value.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key: string) => {
			const val = key.split('.').reduce((o: any, k: string) => PROTO_DENYLIST.has(k) ? undefined : o?.[k], data);
			return val == null ? '' : String(val);
		});
	}
	if (Array.isArray(value)) return value.map(v => hydrateValue(v, data));
	if (typeof value === 'object' && value !== null) {
		const r: any = {};
		for (const [k, v] of Object.entries(value)) r[k] = hydrateValue(v, data);
		return r;
	}
	return value;
}

/**
 * Resolve a tool result into a ChatKit widget tree.
 * Returns null if no template matches or on any error.
 */
export async function resolveWidget(
	db: Knex,
	toolName: string,
	toolResult: any,
	resourceId?: string | null,
): Promise<ChatKitNode | null> {
	const template = await findTemplate(db, toolName, resourceId);
	if (!template) return null;

	try {
		const mapping = typeof template.data_mapping === 'string'
			? JSON.parse(template.data_mapping) : template.data_mapping;
		const mappedData = applyMapping(mapping || {}, toolResult);
		const tree = typeof template.template === 'string'
			? JSON.parse(template.template) : template.template;
		if (!tree) return null;
		return hydrateTemplate(tree, mappedData);
	} catch {
		return null;
	}
}
