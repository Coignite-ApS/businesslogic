import { ref, computed } from 'vue';
import type { NodeTypeMeta } from '../types';

export function useNodeTypes(api: any) {
	const nodeTypes = ref<NodeTypeMeta[]>([]);
	const loading = ref(false);

	async function fetchNodeTypes() {
		loading.value = true;
		try {
			const { data } = await api.get('/items/bl_node_types', {
				params: {
					fields: ['*'],
					limit: -1,
				},
			});
			nodeTypes.value = (data.data as any[]).map((row) => ({
				...row,
				inputs: typeof row.inputs === 'string' ? JSON.parse(row.inputs) : row.inputs || [],
				outputs: typeof row.outputs === 'string' ? JSON.parse(row.outputs) : row.outputs || [],
				config_schema: typeof row.config_schema === 'string' ? JSON.parse(row.config_schema) : row.config_schema || {},
			}));
		} catch {
			// silently fail — node types list may not be available
		} finally {
			loading.value = false;
		}
	}

	const categories = computed(() => {
		const cats = new Map<string, NodeTypeMeta[]>();
		for (const nt of nodeTypes.value) {
			const cat = nt.category || 'Other';
			if (!cats.has(cat)) cats.set(cat, []);
			cats.get(cat)!.push(nt);
		}
		return cats;
	});

	function getNodeType(id: string): NodeTypeMeta | undefined {
		return nodeTypes.value.find((nt) => nt.id === id);
	}

	return { nodeTypes, categories, loading, fetchNodeTypes, getNodeType };
}
