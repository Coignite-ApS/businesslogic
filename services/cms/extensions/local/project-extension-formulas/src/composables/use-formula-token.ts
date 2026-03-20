import { ref } from 'vue';

export function useFormulaToken(api: any) {
	const hasToken = ref(true);
	const tokenLoading = ref(true);
	const tokenValue = ref('');
	const formulaApiUrl = ref('');

	async function fetchToken() {
		tokenLoading.value = true;
		try {
			// Check token existence
			const { data } = await api.get('/calc/formula-tokens');
			const tokens = data?.data || data;
			hasToken.value = Array.isArray(tokens) && tokens.some((t: any) => !t.revoked);

			if (hasToken.value) {
				// Get decrypted value
				try {
					const { data: valData } = await api.get('/calc/formula-token-value');
					tokenValue.value = valData?.data || valData || '';
				} catch {
					tokenValue.value = '';
				}
			}

			// Get formula API URL
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
