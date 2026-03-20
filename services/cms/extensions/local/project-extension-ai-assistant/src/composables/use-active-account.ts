import { ref } from 'vue';

export function useActiveAccount(api: any) {
	const activeAccountId = ref<string | null>(null);
	const loading = ref(false);

	async function fetchActiveAccount() {
		loading.value = true;
		try {
			const { data } = await api.get('/users/me', {
				params: {
					fields: ['active_account', 'accounts.account_id.id'],
				},
			});
			const user = data.data;
			activeAccountId.value = user.active_account || null;

			if (!activeAccountId.value) {
				const junctions = user.accounts || [];
				const accountIds = junctions.map((j: any) => j.account_id?.id).filter(Boolean);
				if (accountIds.length === 1) {
					await api.patch('/users/me', { active_account: accountIds[0] });
					activeAccountId.value = accountIds[0];
				}
			}
		} catch {
			// silently fail
		} finally {
			loading.value = false;
		}
	}

	return { activeAccountId, loading, fetchActiveAccount };
}
