import { ref, onBeforeUnmount } from 'vue';

const POLL_INTERVAL = 30_000;

export type TimeRange = 'today' | '7d' | '30d' | '12m';

interface ExecutionRecord {
	status: string;
	duration_ms: number | null;
	started_at: string | null;
	cost_usd: number | null;
	flow_id: string;
}

export function useFlowDashboardStats(api: any) {
	const records = ref<ExecutionRecord[]>([]);
	const loading = ref(false);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function fetchExecutionData(flowIds: string[]) {
		if (!flowIds.length) {
			records.value = [];
			return;
		}
		loading.value = true;
		try {
			const since = new Date();
			since.setMonth(since.getMonth() - 12);
			const { data } = await api.get('/items/bl_flow_executions', {
				params: {
					'filter[flow_id][_in]': flowIds.join(','),
					'filter[started_at][_gte]': since.toISOString(),
					fields: 'status,duration_ms,started_at,cost_usd,flow_id',
					sort: '-started_at',
					limit: -1,
				},
			});
			records.value = data.data || [];
		} catch {
			records.value = [];
		} finally {
			loading.value = false;
		}
	}

	function startPolling(getIds: () => string[]) {
		stopPolling();
		pollTimer = setInterval(() => fetchExecutionData(getIds()), POLL_INTERVAL);
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

	function recordsInRange(range: TimeRange): ExecutionRecord[] {
		const cutoff = rangeCutoff(range);
		return records.value.filter((r) => r.started_at && tsMs(r.started_at) >= cutoff);
	}

	function totalExecutions(range: TimeRange): number {
		return recordsInRange(range).length;
	}

	function errorRate(range: TimeRange): number {
		const recs = recordsInRange(range);
		if (!recs.length) return 0;
		const failed = recs.filter((r) => r.status === 'failed').length;
		return Math.round((failed / recs.length) * 100);
	}

	function avgDuration(range: TimeRange): number {
		const recs = recordsInRange(range).filter((r) => r.status === 'completed' && r.duration_ms !== null);
		if (!recs.length) return 0;
		const sum = recs.reduce((acc, r) => acc + (r.duration_ms ?? 0), 0);
		return Math.round(sum / recs.length);
	}

	function activeFlows(range: TimeRange): number {
		const recs = recordsInRange(range);
		return new Set(recs.map((r) => r.flow_id)).size;
	}

	function buildAggregateChart(range: TimeRange): Array<{
		label: string;
		completed: number;
		failed: number;
		running: number;
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

		const recs = records.value;
		const bars = buckets.map((b) => {
			let completed = 0, failed = 0, running = 0;
			for (const r of recs) {
				if (!r.started_at) continue;
				const t = tsMs(r.started_at);
				if (t >= b.start && t < b.end) {
					if (r.status === 'completed') completed++;
					else if (r.status === 'failed') failed++;
					else if (r.status === 'running') running++;
				}
			}
			const total = completed + failed + running;
			return { label: b.label, completed, failed, running, total, heightPct: 0 };
		});

		const maxTotal = Math.max(1, ...bars.map((b) => b.total));
		for (const bar of bars) bar.heightPct = (bar.total / maxTotal) * 100;
		return bars;
	}

	function miniChartData(flowId: string): number[] {
		const now = new Date();
		const days: number[] = [];
		for (let i = 6; i >= 0; i--) {
			const d = new Date(now);
			d.setDate(d.getDate() - i);
			d.setHours(0, 0, 0, 0);
			const start = d.getTime();
			const end = start + 86_400_000;
			const count = records.value.filter((r) => {
				if (r.flow_id !== flowId || !r.started_at) return false;
				const t = tsMs(r.started_at);
				return t >= start && t < end;
			}).length;
			days.push(count);
		}
		return days;
	}

	return {
		records,
		loading,
		totalExecutions,
		errorRate,
		avgDuration,
		activeFlows,
		miniChartData,
		buildAggregateChart,
		fetchExecutionData,
		startPolling,
		stopPolling,
	};
}

function tsMs(ts: string): number {
	return new Date(ts.endsWith('Z') ? ts : ts + 'Z').getTime();
}
