import { useRouter } from 'vue-router';
import { useCalculators } from './use-calculators';
import { useActiveAccount } from './use-active-account';

export function useCreateCalculator(api: any) {
	const router = useRouter();
	const { create } = useCalculators(api);
	const { activeAccountId } = useActiveAccount(api);

	async function handleCreate() {
		const id = crypto.randomUUID();
		const accountId = activeAccountId.value || null;
		const created = await create({ id, name: null, account: accountId, onboarded: false });
		if (created) {
			router.push(`/calculators/${created.id}`);
		}
	}

	return { handleCreate };
}
