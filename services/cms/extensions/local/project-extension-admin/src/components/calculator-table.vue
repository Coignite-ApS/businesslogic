<template>
	<div class="calc-table">
		<div class="calc-header" :class="showAccount ? 'cols-with-account' : 'cols-no-account'">
			<div class="col-name">Calculator</div>
			<div v-if="showAccount" class="col-account">Account</div>
			<div class="col-status">Status</div>
			<div class="col-calls">Calls/Mo</div>
			<div class="col-errors">Errors</div>
			<div class="col-size" title="Excel model complexity — more sheets/formulas = more memory and slower builds">Size</div>
			<div class="col-memory" title="Total process memory used when this calculator was built (JS heap + native/Rust). Large values = heavy model">Build RSS</div>
			<div class="col-remarks">Remarks</div>
		</div>

		<div
			v-for="calc in calculators"
			:key="calc.id"
			class="calc-row"
			:class="showAccount ? 'cols-with-account' : 'cols-no-account'"
			@click="$emit('click-calculator', calc)"
		>
			<div class="col-name">
				<div class="calc-name-row">
					<span class="calc-name">{{ calc.name || calc.id }}</span>
					<span
						v-if="inMemoryIds.has(calc.id)"
						class="memory-dot memory-dot--active"
						title="In worker memory"
					/>
					<span
						v-else-if="inRedisIds.has(calc.id)"
						class="memory-dot memory-dot--cached"
						title="Cached in Redis"
					/>
				</div>
				<div class="calc-id">{{ calc.id }}</div>
			</div>
			<div v-if="showAccount" class="col-account">
				<a v-if="calc.account_id" class="account-link" @click.stop="$emit('click-account', calc)">
					{{ calc.account_name || '—' }}
				</a>
				<span v-else>—</span>
			</div>
			<div class="col-status">
				<v-chip v-if="calc.activated && !calc.over_limit" small class="chip-live">Live</v-chip>
				<v-chip v-else-if="calc.activated && calc.over_limit" small class="chip-danger">Over limit</v-chip>
				<v-chip v-else small class="chip-inactive">Inactive</v-chip>
			</div>
			<div class="col-calls">{{ calc.monthly_calls ?? '—' }}</div>
			<div class="col-errors">
				<span
					v-if="calc.monthly_errors"
					class="error-count"
					@click.stop="$emit('click-errors', calc)"
				>{{ calc.monthly_errors }}</span>
				<span v-else>0</span>
			</div>
			<div class="col-size">
				<template v-if="calc.profile">
					<div class="size-metric">{{ calc.profile.sheetCount || 0 }} sheets</div>
					<div class="size-metric">{{ calc.profile.formulaCount || 0 }} formulas</div>
					<div class="size-metric">{{ formatBytes(calc.profile.dataBytes) }}</div>
				</template>
				<span v-else class="no-profile">—</span>
			</div>
			<div class="col-memory">
				<template v-if="calc.profile">
					<div v-if="calc.profile.heapDeltaMB" class="memory-primary" title="RSS delta measured when calculator was built (includes native/Rust memory)">
						{{ calc.profile.heapDeltaMB.toFixed(1) }} MB
					</div>
					<div v-else-if="calc.profile.estimatedMemoryMB" class="memory-primary memory-primary--est" title="Rough estimate — no measured data yet">
						~{{ formatMB(calc.profile.estimatedMemoryMB) }}
					</div>
					<div v-if="calc.profile.buildMs" class="memory-detail">
						{{ calc.profile.buildMs }}ms build
					</div>
				</template>
				<span v-else class="no-profile">—</span>
			</div>
			<div class="col-remarks">
				<template v-if="calc.profile?.remarks?.length">
					<span
						v-for="r in calc.profile.remarks"
						:key="r.code"
						class="remark-badge"
						:class="'remark-' + r.level"
						:title="r.message"
					>{{ r.code }}</span>
				</template>
				<span v-if="calc.unresolved_functions?.length"
					class="remark-badge remark-warning"
					:title="'Unsupported: ' + calc.unresolved_functions.map((f: any) => f.name).join(', ')"
				>UNSUPPORTED_FN</span>
				<span v-if="!calc.profile?.remarks?.length && !calc.unresolved_functions?.length" class="no-profile">—</span>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { AdminCalculator } from '../types';

defineProps<{
	calculators: AdminCalculator[];
	showAccount?: boolean;
	inMemoryIds?: Set<string>;
	inRedisIds?: Set<string>;
}>();

defineEmits<{
	(e: 'click-calculator', calc: AdminCalculator): void;
	(e: 'click-account', calc: AdminCalculator): void;
	(e: 'click-errors', calc: AdminCalculator): void;
}>();

function formatMB(mb: number | undefined): string {
	if (!mb) return '—';
	return mb < 1 ? '<1 MB' : mb.toFixed(1) + ' MB';
}

function formatBytes(bytes: number | undefined): string {
	if (!bytes) return '—';
	if (bytes < 1024) return bytes + ' B';
	if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
	return (bytes / 1048576).toFixed(1) + ' MB';
}
</script>

<style scoped>
.calc-table {
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow-x: auto;
}

.calc-header, .calc-row {
	display: grid;
	gap: 8px;
	padding: 12px 16px;
	align-items: center;
	min-width: 900px;
}

.cols-with-account {
	grid-template-columns: 2fr 1.2fr 90px 70px 60px 1.2fr 1.2fr 1.2fr;
}

.cols-no-account {
	grid-template-columns: 2fr 90px 70px 60px 1.2fr 1.2fr 1.2fr;
}

.calc-header {
	background: var(--theme--background-subdued);
	font-size: 11px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.calc-row {
	border-top: 1px solid var(--theme--border-color);
	cursor: pointer;
	transition: background 0.15s;
}

.calc-row:hover {
	background: var(--theme--background-subdued);
}

.calc-name-row {
	display: flex;
	align-items: center;
	gap: 6px;
}

.calc-name {
	font-weight: 600;
	font-size: 13px;
}

.calc-id {
	font-size: 11px;
	color: var(--theme--foreground-subdued);
	font-family: var(--theme--fonts--monospace--font-family);
}

/* Memory status dot */
.memory-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	flex-shrink: 0;
}

.memory-dot--active {
	background: var(--theme--success, #2ecda7);
	box-shadow: 0 0 4px var(--theme--success, #2ecda7);
}

.memory-dot--cached {
	background: var(--theme--warning, #ffa439);
}

.col-account, .col-calls, .col-errors {
	font-size: 13px;
}

.account-link {
	color: var(--theme--primary);
	cursor: pointer;
	text-decoration: none;
}

.account-link:hover {
	text-decoration: underline;
}

.error-count {
	color: var(--theme--danger);
	font-weight: 600;
	cursor: pointer;
	padding: 2px 8px;
	border-radius: var(--theme--border-radius);
	transition: background 0.15s;
}

.error-count:hover {
	background: var(--theme--danger-background, rgba(227, 81, 105, 0.1));
}

.chip-live {
	--v-chip-background-color: var(--theme--success-background, rgba(46, 205, 167, 0.1));
	--v-chip-color: var(--theme--success);
}

.chip-danger {
	--v-chip-background-color: var(--theme--danger-background);
	--v-chip-color: var(--theme--danger);
}

.chip-inactive {
	--v-chip-background-color: var(--theme--background-subdued);
	--v-chip-color: var(--theme--foreground-subdued);
}

/* Size column */
.size-metric {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	line-height: 1.4;
}

/* Memory column */
.memory-primary {
	font-weight: 600;
	font-size: 13px;
}

.memory-primary--est {
	color: var(--theme--foreground-subdued);
	font-style: italic;
}

.memory-detail {
	font-size: 11px;
	color: var(--theme--foreground-subdued);
}

.no-profile {
	color: var(--theme--foreground-subdued);
}

/* Remarks — consistent badge sizing */
.col-remarks {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}

.remark-badge {
	font-size: 10px;
	padding: 2px 6px;
	border-radius: 3px;
	font-weight: 600;
	cursor: help;
	line-height: 1.3;
	white-space: nowrap;
}

.remark-info { background: var(--theme--primary-background); color: var(--theme--primary); }
.remark-warning { background: var(--theme--warning-background); color: var(--theme--warning); }
.remark-error { background: var(--theme--danger-background); color: var(--theme--danger); }
</style>
