import { ref, computed, onBeforeUnmount } from 'vue';
import type { CallRecord } from '../types';

const POLL_INTERVAL = 30_000;

export type TimeRange = 'today' | '7d' | '12m';

export function useDashboardStats(api: any) {
	const records = ref<CallRecord[]>([]);
	const loading = ref(false);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function fetchCallData(calculatorIds: string[]) {
		if (!calculatorIds.length) {
			records.value = [];
			return;
		}
		loading.value = true;
		try {
			const since = new Date();
			since.setMonth(since.getMonth() - 12);
			const { data } = await api.get('/items/calculator_calls', {
				params: {
					'filter[calculator][_in]': calculatorIds.join(','),
					'filter[timestamp][_gte]': since.toISOString(),
					fields: 'timestamp,error,cached,response_time_ms,calculator,test',
					sort: '-timestamp',
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
		pollTimer = setInterval(() => fetchCallData(getIds()), POLL_INTERVAL);
	}

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	onBeforeUnmount(stopPolling);

	// Filter to live calls only (non-test)
	const liveRecords = computed(() => records.value.filter((r) => !r.test));

	/** Get cutoff timestamp for a given time range */
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
		// 12m
		const d = new Date(now);
		d.setMonth(d.getMonth() - 12);
		return d.getTime();
	}

	/** Records filtered to a time range */
	function recordsInRange(range: TimeRange): CallRecord[] {
		const cutoff = rangeCutoff(range);
		return liveRecords.value.filter((r) => tsMs(r.timestamp) >= cutoff);
	}

	function totalCalls(range: TimeRange): number {
		return recordsInRange(range).length;
	}

	function errorRateForRange(range: TimeRange): number {
		const recs = recordsInRange(range);
		if (!recs.length) return 0;
		const errors = recs.filter((r) => r.error).length;
		return Math.round((errors / recs.length) * 100);
	}

	function errorCountForRange(range: TimeRange): number {
		return recordsInRange(range).filter((r) => r.error).length;
	}

	// Per-calculator 7-day mini chart data
	function miniChartData(calculatorId: string): number[] {
		const now = new Date();
		const days: number[] = [];
		for (let i = 6; i >= 0; i--) {
			const d = new Date(now);
			d.setDate(d.getDate() - i);
			d.setHours(0, 0, 0, 0);
			const start = d.getTime();
			const end = start + 86_400_000;
			const count = liveRecords.value.filter((r) => {
				if (r.calculator !== calculatorId) return false;
				const t = tsMs(r.timestamp);
				return t >= start && t < end;
			}).length;
			days.push(count);
		}
		return days;
	}

	// Aggregate chart data
	function buildAggregateChart(range: TimeRange): Array<{ label: string; success: number; error: number; cached: number; total: number; heightPct: number }> {
		const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const now = new Date();
		const buckets: Array<{ start: number; end: number; label: string }> = [];

		if (range === 'today') {
			// 24 hourly buckets for today
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
		} else {
			for (let i = 11; i >= 0; i--) {
				const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
				const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
				buckets.push({ start: d.getTime(), end: end.getTime(), label: monthLabels[d.getMonth()] });
			}
		}

		const recs = liveRecords.value;
		const bars = buckets.map((b) => {
			let success = 0, cached = 0, error = 0;
			for (const r of recs) {
				const t = tsMs(r.timestamp);
				if (t >= b.start && t < b.end) {
					if (r.error) error++;
					else if (r.cached) cached++;
					else success++;
				}
			}
			const total = success + cached + error;
			return { label: b.label, success, cached, error, total, heightPct: 0 };
		});

		const maxTotal = Math.max(1, ...bars.map((b) => b.total));
		for (const bar of bars) bar.heightPct = (bar.total / maxTotal) * 100;
		return bars;
	}

	return {
		records,
		liveRecords,
		loading,
		totalCalls,
		errorRateForRange,
		errorCountForRange,
		miniChartData,
		buildAggregateChart,
		fetchCallData,
		startPolling,
		stopPolling,
	};
}

function tsMs(ts: string): number {
	return new Date(ts.endsWith('Z') ? ts : ts + 'Z').getTime();
}
