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

	const hasKeys = computed(() => keys.value.length > 0);
	const calcKeys = computed(() => keys.value.filter(hasCalcPermission));
	const hasCalcKeys = computed(() => calcKeys.value.length > 0);

	const testCalcKeys = computed(() => calcKeys.value.filter((k) => k.environment === 'test'));
	const liveCalcKeys = computed(() => calcKeys.value.filter((k) => k.environment === 'live'));

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

			// Auto-select first live calc key, fallback to any calc key
			const liveKey = liveCalcKeys.value[0];
			selectedKey.value = liveKey || calcKeys.value[0] || null;
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

	function selectKeyForEnv(environment: 'test' | 'live') {
		const pool = environment === 'test' ? testCalcKeys.value : liveCalcKeys.value;
		if (pool.length > 0) {
			selectedKey.value = pool[0];
		} else if (calcKeys.value.length > 0) {
			selectedKey.value = calcKeys.value[0];
		}
	}

	async function ensureCalcKey(environment: 'test' | 'live'): Promise<ApiKey | null> {
		const pool = environment === 'test' ? testCalcKeys.value : liveCalcKeys.value;
		if (pool.length > 0) return pool[0];

		// Auto-provision a new key
		return createCalcKey(environment);
	}

	async function rotateKey(id: string): Promise<ApiKey | null> {
		try {
			const { data } = await api.post(`/account/api-keys/${id}/rotate`);
			const key = data?.data || data;
			await fetchKeys();
			if (key?.id) selectKey(key.id);
			return key;
		} catch {
			return null;
		}
	}

	async function createCalcKey(environment: 'test' | 'live'): Promise<ApiKey | null> {
		try {
			const { data } = await api.post('/account/api-keys', {
				name: environment === 'test' ? 'Calculator Test' : 'Calculator Live',
				environment,
				permissions: {
					services: {
						calc: { enabled: true, resources: ['*'], actions: ['execute', 'describe'] },
						kb: { enabled: true, resources: ['*'], actions: ['search', 'ask'] },
						flow: { enabled: true, resources: ['*'], actions: ['trigger'] },
					},
				},
			});
			const key = data?.data || data;
			await fetchKeys();
			if (key?.id) selectKey(key.id);
			return key;
		} catch {
			return null;
		}
	}

	return {
		keys,
		selectedKey,
		loading,
		hasKeys,
		calcKeys,
		hasCalcKeys,
		testCalcKeys,
		liveCalcKeys,
		gatewayUrl,
		fetchKeys,
		selectKey,
		selectKeyForEnv,
		ensureCalcKey,
		rotateKey,
		createCalcKey,
	};
}
