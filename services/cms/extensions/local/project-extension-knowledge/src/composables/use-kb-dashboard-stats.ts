import { ref, onBeforeUnmount } from 'vue';

const POLL_INTERVAL = 30_000;

export type TimeRange = 'today' | '7d' | '30d' | '12m';

interface QueryRecord {
	id: string;
	knowledge_base: string;
	query: string;
	type: 'search' | 'ask';
	result_count: number;
	date_created: string;
}

export function useKbDashboardStats(api: any) {
	const queryRecords = ref<QueryRecord[]>([]);
	const loading = ref(false);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function fetchQueryData() {
		loading.value = true;
		try {
			const since = new Date();
			since.setMonth(since.getMonth() - 12);
			const { data } = await api.get('/items/kb_queries', {
				params: {
					'filter[date_created][_gte]': since.toISOString(),
					fields: 'id,knowledge_base,query,type,result_count,date_created',
					sort: '-date_created',
					limit: -1,
				},
			});
			queryRecords.value = data.data || [];
		} catch {
			// kb_queries table may not exist yet — silently ignore
			queryRecords.value = [];
		} finally {
			loading.value = false;
		}
	}

	function startPolling() {
		stopPolling();
		pollTimer = setInterval(fetchQueryData, POLL_INTERVAL);
	}

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	onBeforeUnmount(stopPolling);

	function rangeCutoff(range: TimeRange): number {
		const now = new Date();
		if (range === 'today') {
			const midnight = new Date(now);
			midnight.setHours(0, 0, 0, 0);
			return midnight.getTime();
		}
		if (range === '7d') {
			const d = new Date(now);
			d.setDate(d.getDate() - 7);
			d.setHours(0, 0, 0, 0);
			return d.getTime();
		}
		if (range === '30d') {
			const d = new Date(now);
			d.setDate(d.getDate() - 30);
			d.setHours(0, 0, 0, 0);
			return d.getTime();
		}
		// 12m
		const d = new Date(now);
		d.setMonth(d.getMonth() - 12);
		return d.getTime();
	}

	function recordsInRange(range: TimeRange): QueryRecord[] {
		const cutoff = rangeCutoff(range);
		return queryRecords.value.filter((r) => tsMs(r.date_created) >= cutoff);
	}

	function totalQueries(range: TimeRange): number {
		return recordsInRange(range).length;
	}

	function buildAggregateChart(range: TimeRange): Array<{
		label: string;
		search: number;
		ask: number;
		total: number;
		heightPct: number;
	}> {
		const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const now = new Date();
		const buckets: Array<{ start: number; end: number; label: string }> = [];

		if (range === 'today') {
			const midnight = new Date(now);
			midnight.setHours(0, 0, 0, 0);
			for (let i = 0; i < 24; i++) {
				const start = midnight.getTime() + i * 3_600_000;
				const end = start + 3_600_000;
				const label = String(i).padStart(2, '0');
				buckets.push({ start, end, label });
			}
		} else if (range === '7d') {
			for (let i = 6; i >= 0; i--) {
				const d = new Date(now);
				d.setDate(d.getDate() - i);
				d.setHours(0, 0, 0, 0);
				const end = new Date(d);
				end.setDate(end.getDate() + 1);
				buckets.push({ start: d.getTime(), end: end.getTime(), label: dayLabels[d.getDay()] });
			}
		} else if (range === '30d') {
			for (let i = 29; i >= 0; i--) {
				const d = new Date(now);
				d.setDate(d.getDate() - i);
				d.setHours(0, 0, 0, 0);
				const end = new Date(d);
				end.setDate(end.getDate() + 1);
				const label = `${d.getMonth() + 1}/${d.getDate()}`;
				buckets.push({ start: d.getTime(), end: end.getTime(), label });
			}
		} else {
			for (let i = 11; i >= 0; i--) {
				const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
				const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
				buckets.push({ start: d.getTime(), end: end.getTime(), label: monthLabels[d.getMonth()] });
			}
		}

		const recs = queryRecords.value;
		const bars = buckets.map((b) => {
			let search = 0, ask = 0;
			for (const r of recs) {
				const t = tsMs(r.date_created);
				if (t >= b.start && t < b.end) {
					if (r.type === 'search') search++;
					else if (r.type === 'ask') ask++;
				}
			}
			const total = search + ask;
			return { label: b.label, search, ask, total, heightPct: 0 };
		});

		const maxTotal = Math.max(1, ...bars.map((b) => b.total));
		for (const bar of bars) bar.heightPct = (bar.total / maxTotal) * 100;
		return bars;
	}

	return {
		queryRecords,
		loading,
		totalQueries,
		buildAggregateChart,
		fetchQueryData,
		startPolling,
		stopPolling,
	};
}

function tsMs(ts: string): number {
	return new Date(ts.endsWith('Z') ? ts : ts + 'Z').getTime();
}
