import { ref, computed } from 'vue';

export interface ApiKey {
	id: string;
	key_prefix: string;
	raw_key?: string;
	account_id: string;
	name: string;
	environment: string;
	permissions: any;
	created_at: string;
}

function hasCalcPermission(key: ApiKey): boolean {
	if (!key.permissions) return true; // null = full access
	return key.permissions?.services?.calc?.enabled === true;
}

export function useApiKeys(api: any) {
	const keys = ref<ApiKey[]>([]);
	const selectedKey = ref<ApiKey | null>(null);
	const loading = ref(true);
	const gatewayUrl = ref('');
	const justCreatedRawKey = ref('');

	const hasKeys = computed(() => keys.value.length > 0);
	const calcKeys = computed(() => keys.value.filter(hasCalcPermission));
	const hasCalcKeys = computed(() => calcKeys.value.length > 0);

	async function fetchKeys() {
		loading.value = true;
		try {
			const [keysRes, urlRes] = await Promise.all([
				api.get('/account/api-keys'),
				api.get('/calc/formula-api-url').catch(() => ({ data: {} })),
			]);

			const raw = keysRes.data?.data || keysRes.data;
			keys.value = Array.isArray(raw) ? raw : [];

			gatewayUrl.value = urlRes.data?.url || urlRes.data?.data || '';

			// Auto-select first live key with calc permission, fallback to any calc key
			const withCalc = keys.value.filter(hasCalcPermission);
			const liveKey = withCalc.find((k) => k.environment === 'live');
			selectedKey.value = liveKey || withCalc[0] || null;
		} catch {
			keys.value = [];
			selectedKey.value = null;
		} finally {
			loading.value = false;
		}
	}

	function selectKey(id: string) {
		const found = keys.value.find((k) => k.id === id);
		if (found) selectedKey.value = found;
	}

	async function createDefaultKey(): Promise<ApiKey | null> {
		try {
			const { data } = await api.post('/account/api-keys', {
				name: 'Default',
				environment: 'live',
				permissions: {
					services: {
						calc: { enabled: true, resources: ['*'], actions: ['execute', 'describe'] },
						kb: { enabled: true, resources: ['*'], actions: ['search', 'ask'] },
						flow: { enabled: true, resources: ['*'], actions: ['trigger'] },
					},
				},
			});
			const key = data?.data || data;
			if (key?.raw_key) {
				justCreatedRawKey.value = key.raw_key;
			}
			// Refresh list so the new key appears
			await fetchKeys();
			// Select the newly created key
			if (key?.id) selectKey(key.id);
			return key;
		} catch {
			return null;
		}
	}

	function dismissRawKey() {
		justCreatedRawKey.value = '';
	}

	return {
		keys,
		selectedKey,
		loading,
		hasKeys,
		calcKeys,
		hasCalcKeys,
		gatewayUrl,
		justCreatedRawKey,
		fetchKeys,
		selectKey,
		createDefaultKey,
		dismissRawKey,
	};
}
