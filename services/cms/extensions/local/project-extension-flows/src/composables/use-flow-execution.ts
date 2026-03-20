import { ref, onUnmounted } from 'vue';
import type { NodeStatusMap } from '../types';

export function useFlowExecution(api: any) {
	const nodeStatuses = ref<NodeStatusMap>({});
	const executing = ref(false);
	const executionId = ref<string | null>(null);
	const executionError = ref<string | null>(null);
	let eventSource: EventSource | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let pollFailures = 0;
	const MAX_POLL_FAILURES = 10;

	function connectSSE(execId: string, streamUrl: string) {
		disconnectSSE();
		stopPolling();
		executionId.value = execId;
		executing.value = true;
		executionError.value = null;
		nodeStatuses.value = {};

		// Include auth token in SSE URL via cookie (Directus handles this)
		const token = (api.defaults?.headers?.common?.Authorization as string || '').replace('Bearer ', '');
		const sep = streamUrl.includes('?') ? '&' : '?';
		const url = token ? `${streamUrl}${sep}access_token=${token}` : streamUrl;

		eventSource = new EventSource(url);

		eventSource.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				handleEvent(data);
			} catch {
				// ignore parse errors
			}
		};

		eventSource.onerror = () => {
			// SSE failed — fall back to polling
			disconnectSSE();
			startPolling(execId);
		};
	}

	function startPolling(execId: string) {
		if (pollTimer) return;
		pollFailures = 0;
		// Poll immediately, then every 2s
		pollExecution(execId);
		pollTimer = setInterval(() => pollExecution(execId), 2000);
	}

	async function pollExecution(execId: string) {
		try {
			const { data } = await api.get(`/flow/executions/${execId}`, {
				params: { include: 'context' },
			});
			const exec = data;
			if (!exec) return;

			// Update node statuses from context
			if (exec.context?.$nodes) {
				const statuses: NodeStatusMap = {};
				for (const [nodeId, info] of Object.entries(exec.context.$nodes as Record<string, any>)) {
					statuses[nodeId] = info.status === 'completed' ? 'completed' : info.status === 'failed' ? 'failed' : 'running';
				}
				nodeStatuses.value = statuses;
			}

			// Check terminal status
			if (exec.status === 'completed' || exec.status === 'failed') {
				executing.value = false;
				if (exec.status === 'failed') {
					executionError.value = exec.error || 'Execution failed';
				}
				stopPolling();
			}
		} catch {
			// Tolerate transient failures (execution may not be persisted yet)
			pollFailures++;
			if (pollFailures >= MAX_POLL_FAILURES) {
				executing.value = false;
				stopPolling();
			}
		}
	}

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	function handleEvent(data: any) {
		const eventType = data.event_type;
		if (!eventType) return;

		if (eventType === 'Started') {
			// Mark all nodes as pending
			return;
		}

		if (eventType.NodeStarted) {
			nodeStatuses.value = {
				...nodeStatuses.value,
				[eventType.NodeStarted.node_id]: 'running',
			};
		} else if (eventType.NodeCompleted) {
			nodeStatuses.value = {
				...nodeStatuses.value,
				[eventType.NodeCompleted.node_id]: 'completed',
			};
		} else if (eventType.NodeFailed) {
			nodeStatuses.value = {
				...nodeStatuses.value,
				[eventType.NodeFailed.node_id]: 'failed',
			};
		} else if (eventType.Completed || eventType.Failed) {
			executing.value = false;
			if (eventType.Failed) {
				executionError.value = eventType.Failed.error || 'Execution failed';
			}
			disconnectSSE();
		}
	}

	function disconnectSSE() {
		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}
	}

	onUnmounted(() => {
		disconnectSSE();
		stopPolling();
	});

	return {
		nodeStatuses,
		executing,
		executionId,
		executionError,
		connectSSE,
		disconnectSSE,
	};
}
