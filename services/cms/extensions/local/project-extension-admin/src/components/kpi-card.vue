<template>
	<component
		:is="to ? 'router-link' : 'div'"
		:to="to || undefined"
		class="kpi-card"
		:class="{ clickable: !!to }"
	>
		<div class="kpi-icon" :class="iconVariant ? 'icon-' + iconVariant : ''">
			<v-icon :name="icon" />
		</div>
		<div class="kpi-body">
			<div class="kpi-label">{{ label }}</div>
			<slot name="custom-value">
				<div class="kpi-value">
					<span v-if="prefix" class="kpi-prefix">{{ prefix }}</span>{{ formatted }}<span v-if="suffix" class="kpi-suffix">{{ suffix }}</span>
					<span v-if="max !== undefined" class="kpi-max">/ {{ formattedMax }}</span>
				</div>
			</slot>
			<div v-if="progress !== undefined" class="kpi-bar">
				<div class="kpi-fill" :style="{ width: Math.min(progress, 100) + '%' }" :class="{ 'fill-warn': progress > 80, 'fill-danger': progress > 95 }" />
			</div>
			<slot name="custom-subtitle">
				<div v-if="subtitle" class="kpi-subtitle">{{ subtitle }}</div>
			</slot>
		</div>
	</component>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
	label: string;
	value: number;
	icon: string;
	subtitle?: string;
	to?: string;
	max?: number;
	progress?: number;
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
	text-decoration: none;
	color: inherit;
	transition: border-color 0.15s, box-shadow 0.15s;
}

.kpi-card.clickable {
	cursor: pointer;
}

.kpi-card.clickable:hover {
	border-color: var(--theme--primary);
	box-shadow: 0 0 0 1px var(--theme--primary);
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

.kpi-bar {
	height: 4px;
	background: var(--theme--border-color);
	border-radius: 2px;
	margin-top: 6px;
	overflow: hidden;
}

.kpi-fill {
	height: 100%;
	background: var(--theme--primary);
	border-radius: 2px;
	transition: width 0.3s;
}

.kpi-fill.fill-warn {
	background: var(--theme--warning);
}

.kpi-fill.fill-danger {
	background: var(--theme--danger);
}

.kpi-subtitle {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	margin-top: 2px;
}
</style>
