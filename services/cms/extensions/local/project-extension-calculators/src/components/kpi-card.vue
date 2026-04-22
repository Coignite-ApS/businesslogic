<template>
	<div class="kpi-card">
		<div class="kpi-icon" :class="iconVariant ? 'icon-' + iconVariant : ''">
			<v-icon :name="icon" />
		</div>
		<div class="kpi-body">
			<div class="kpi-label">{{ label }}</div>
			<div class="kpi-value">
				<span v-if="prefix" class="kpi-prefix">{{ prefix }}</span>{{ formatted }}<span v-if="suffix" class="kpi-suffix">{{ suffix }}</span>
				<span v-if="max !== undefined" class="kpi-max">/ {{ formattedMax }}</span>
			</div>
			<div v-if="subtitle" class="kpi-subtitle">{{ subtitle }}</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
	label: string;
	value: number;
	icon: string;
	subtitle?: string;
	max?: number;
	iconVariant?: 'success' | 'warning' | 'danger';
	prefix?: string;
	suffix?: string;
}>();

function fmt(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
	if (n >= 10_000) return (n / 1_000).toFixed(1) + 'K';
	return n.toLocaleString();
}

const formatted = computed(() => fmt(props.value));
const formattedMax = computed(() => props.max !== undefined ? fmt(props.max) : '');
</script>

<style scoped>
.kpi-card {
	display: flex;
	align-items: flex-start;
	gap: 16px;
	padding: 20px;
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
}

.kpi-icon {
	width: 48px;
	height: 48px;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--theme--primary-background);
	border-radius: var(--theme--border-radius);
	color: var(--theme--primary);
	flex-shrink: 0;
}

.icon-success {
	background: var(--theme--success-background, rgba(46, 205, 167, 0.1));
	color: var(--theme--success);
}

.icon-warning {
	background: var(--theme--warning-background);
	color: var(--theme--warning);
}

.icon-danger {
	background: var(--theme--danger-background);
	color: var(--theme--danger);
}

.kpi-body {
	min-width: 0;
	flex: 1;
}

.kpi-label {
	font-size: 12px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.kpi-value {
	font-size: 28px;
	font-weight: 700;
	color: var(--theme--foreground);
	line-height: 1.2;
}

.kpi-prefix, .kpi-suffix {
	font-size: 20px;
	font-weight: 600;
}

.kpi-max {
	font-size: 16px;
	font-weight: 400;
	color: var(--theme--foreground-subdued);
}

.kpi-subtitle {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	margin-top: 2px;
}
</style>
