import { ref } from 'vue';

export function useFormulaToken(api: any) {
	const hasToken = ref(true);
	const tokenLoading = ref(true);
	const tokenValue = ref('');
	const formulaApiUrl = ref('');

	async function fetchToken() {
		tokenLoading.value = true;
		try {
			// Check if user has API keys via gateway
			const { data } = await api.get('/calc/api-keys');
			const keys = data?.data || data;
			hasToken.value = Array.isArray(keys) && keys.length > 0;

			if (hasToken.value) {
				// Gateway list returns key_prefix, not the full key (security).
				// Use prefix as placeholder — user must copy their key from Account settings.
				const first = keys[0];
				tokenValue.value = first?.raw_key || first?.key || (first?.key_prefix ? `${first.key_prefix}...your-key-here` : '');
			} else {
				tokenValue.value = '';
			}

			// Get gateway URL for code snippets
			try {
				const { data: urlData } = await api.get('/calc/formula-api-url');
				formulaApiUrl.value = urlData?.data || urlData?.url || urlData || '';
			} catch {
				formulaApiUrl.value = '';
			}
		} catch {
			hasToken.value = false;
		} finally {
			tokenLoading.value = false;
		}
	}

	return { hasToken, tokenLoading, tokenValue, formulaApiUrl, fetchToken };
}
