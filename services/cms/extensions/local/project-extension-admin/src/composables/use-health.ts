import { ref, onBeforeUnmount } from 'vue';

export function useServerStats(api: any) {
	const stats = ref<Record<string, any> | null>(null);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const responseTime = ref(0);
	let timer: ReturnType<typeof setInterval> | null = null;

	async function fetchStats() {
		loading.value = true;
		error.value = null;
		const start = Date.now();
		try {
			const res = await api.get('/calc/server-stats');
			responseTime.value = Date.now() - start;
			stats.value = res.data;
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message || 'Server stats unavailable';
			stats.value = null;
		} finally {
			loading.value = false;
		}
	}

	function startPolling(intervalMs = 30000) {
		stopPolling();
		fetchStats();
		timer = setInterval(fetchStats, intervalMs);
	}

	function stopPolling() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}

	onBeforeUnmount(() => stopPolling());

	return { stats, loading, error, responseTime, fetchStats, startPolling, stopPolling };
}
