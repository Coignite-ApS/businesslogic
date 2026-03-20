<template>
	<div class="mini-chart-wrapper">
		<div v-if="title" class="chart-title">{{ title }}</div>

		<!-- Line chart with Y-axis + hover tooltip -->
		<template v-if="type === 'line'">
			<div class="line-chart-container" :style="{ height: height + 'px' }">
				<div class="y-axis">
					<span class="y-label y-max">{{ formatYVal(yMax) }}</span>
					<span class="y-label y-mid">{{ formatYVal(yMid) }}</span>
					<span class="y-label y-min">0</span>
				</div>
				<div class="line-chart-area" ref="chartAreaRef">
					<svg class="line-chart" :viewBox="'0 0 ' + svgW + ' ' + svgH" preserveAspectRatio="none">
						<defs>
							<linearGradient :id="'fill-' + uid" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stop-color="var(--theme--primary)" stop-opacity="0.15" />
								<stop offset="100%" stop-color="var(--theme--primary)" stop-opacity="0" />
							</linearGradient>
						</defs>
						<!-- horizontal grid lines -->
						<line x1="0" :y1="pad.top" :x2="svgW" :y2="pad.top" stroke="var(--theme--border-color)" stroke-width="0.5" />
						<line x1="0" :y1="pad.top + (svgH - pad.top - pad.bottom) / 2" :x2="svgW" :y2="pad.top + (svgH - pad.top - pad.bottom) / 2" stroke="var(--theme--border-color)" stroke-width="0.5" stroke-dasharray="4 4" />
						<line x1="0" :y1="svgH - pad.bottom" :x2="svgW" :y2="svgH - pad.bottom" stroke="var(--theme--border-color)" stroke-width="0.5" />
						<!-- tertiary line (e.g. conversions) -->
						<path v-if="tertiaryPath" :d="tertiaryPath" fill="none" stroke="var(--theme--success, #2ecda7)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
						<!-- secondary line (e.g. errors/deletions) -->
						<path v-if="secondaryPath" :d="secondaryPath" fill="none" stroke="var(--theme--danger, #e35169)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
						<!-- primary area fill -->
						<path v-if="primaryFillPath" :d="primaryFillPath" :fill="'url(#fill-' + uid + ')'" />
						<!-- primary line -->
						<path v-if="primaryPath" :d="primaryPath" fill="none" stroke="var(--theme--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
					<!-- Hover overlay -->
					<div
						class="hover-overlay"
						@mousemove="onHover"
						@mouseleave="hoverIdx = -1"
					>
						<template v-if="hoverIdx >= 0 && hoverPoint">
							<div class="hover-line" :style="{ left: hoverPoint.pctX + '%' }" />
							<div class="hover-dot" :style="{ left: hoverPoint.pctX + '%', top: hoverPoint.pctY + '%' }" />
							<div class="hover-tooltip" :style="tooltipStyle">
								<div class="tooltip-value">{{ formatYVal(hoverPoint.value) }}</div>
								<div class="tooltip-label">{{ hoverPoint.label }}</div>
							</div>
						</template>
					</div>
				</div>
			</div>
			<div class="line-labels-row">
				<div v-for="(d, i) in sparseLabels" :key="i" class="line-label" :style="lineLabelStyle(i)">{{ d }}</div>
			</div>
		</template>

		<!-- Bar chart (default) -->
		<template v-else>
			<div class="chart" :style="{ height: height + 'px' }">
				<div class="chart-gradient" />
				<template v-if="isEmpty">
					<div v-for="(_, idx) in bars" :key="idx" class="chart-bar-group">
						<div class="chart-bar-wrapper" :style="{ height: placeholders[idx % placeholders.length] + '%' }">
							<div class="chart-bar"><div class="bar-segment bar-placeholder" style="flex: 1" /></div>
						</div>
					</div>
				</template>
				<template v-else>
					<div v-for="bar in bars" :key="bar.label" class="chart-bar-group">
						<div class="chart-bar-wrapper" :style="{ height: bar.heightPct + '%' }">
							<div class="chart-bar-count">{{ bar.primary || '' }}</div>
							<div class="chart-bar">
								<div
									v-if="bar.secondary"
									class="bar-segment bar-secondary"
									:style="{ flex: bar.secondary }"
								/>
								<div
									v-if="bar.primary"
									class="bar-segment bar-primary"
									:style="{ flex: bar.primary - (bar.secondary || 0) }"
								/>
							</div>
						</div>
					</div>
				</template>
			</div>
			<div class="chart-labels">
				<div v-for="bar in bars" :key="'l-' + bar.label" class="chart-label-cell">{{ bar.label }}</div>
			</div>
		</template>
	</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

export interface ChartDataPoint {
	label: string;
	primary: number;
	secondary?: number;
	tertiary?: number;
}

const props = withDefaults(defineProps<{
	data: ChartDataPoint[];
	title?: string;
	height?: number;
	type?: 'bar' | 'line';
	unit?: string;
}>(), {
	height: 200,
	type: 'bar',
	unit: '',
});

const uid = Math.random().toString(36).slice(2, 8);
const chartAreaRef = ref<HTMLElement | null>(null);
const hoverIdx = ref(-1);

const placeholders = [35, 55, 25, 65, 40, 75, 30, 50, 45, 60, 20, 70];

const isEmpty = computed(() => props.data.every(d => d.primary === 0));

// Bar chart
const bars = computed(() => {
	const maxVal = Math.max(1, ...props.data.map(d => d.primary));
	return props.data.map(d => ({
		label: d.label,
		primary: d.primary,
		secondary: d.secondary || 0,
		heightPct: (d.primary / maxVal) * 100,
	}));
});

// Line chart
const svgW = 400;
const svgH = computed(() => props.height);
const pad = { top: 8, bottom: 4, left: 0, right: 0 };

function buildPath(values: number[], maxVal: number): string {
	if (values.length < 2) return '';
	const w = svgW - pad.left - pad.right;
	const h = svgH.value - pad.top - pad.bottom;
	const points = values.map((v, i) => ({
		x: pad.left + (i / (values.length - 1)) * w,
		y: pad.top + h - (v / maxVal) * h,
	}));
	const bottomY = pad.top + h; // y position for value=0, clamp control points here
	let d = `M ${points[0].x},${points[0].y}`;
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[Math.max(i - 1, 0)];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = points[Math.min(i + 2, points.length - 1)];
		const t = 0.3;
		const cp1x = p1.x + (p2.x - p0.x) * t;
		const cp1y = Math.min(p1.y + (p2.y - p0.y) * t, bottomY);
		const cp2x = p2.x - (p3.x - p1.x) * t;
		const cp2y = Math.min(p2.y - (p3.y - p1.y) * t, bottomY);
		d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
	}
	return d;
}

function niceMax(val: number): number {
	if (val <= 0) return 100;
	const magnitude = Math.pow(10, Math.floor(Math.log10(val)));
	const normalized = val / magnitude;
	if (normalized <= 1) return magnitude;
	if (normalized <= 2) return 2 * magnitude;
	if (normalized <= 5) return 5 * magnitude;
	return 10 * magnitude;
}

const yMax = computed(() => {
	const vals = props.data.flatMap(d => [d.primary, d.secondary || 0, d.tertiary || 0]);
	const maxData = Math.max(0, ...vals);
	return niceMax(maxData);
});

const yMid = computed(() => Math.round(yMax.value / 2));

const lineMaxVal = computed(() => yMax.value || 1);

function formatYVal(val: number): string {
	const s = val >= 1000 ? Math.round(val).toLocaleString() : String(Math.round(val));
	return props.unit ? s + props.unit : s;
}

const primaryPath = computed(() => buildPath(props.data.map(d => d.primary), lineMaxVal.value));
const secondaryPath = computed(() => {
	if (!props.data.some(d => d.secondary)) return '';
	return buildPath(props.data.map(d => d.secondary || 0), lineMaxVal.value);
});

const tertiaryPath = computed(() => {
	if (!props.data.some(d => d.tertiary)) return '';
	return buildPath(props.data.map(d => d.tertiary || 0), lineMaxVal.value);
});

const primaryFillPath = computed(() => {
	if (!primaryPath.value) return '';
	const w = svgW - pad.left - pad.right;
	const lastX = pad.left + w;
	const bottomY = svgH.value - pad.bottom;
	return primaryPath.value + ` L ${lastX},${bottomY} L ${pad.left},${bottomY} Z`;
});

// Hover interaction
function onHover(e: MouseEvent) {
	const el = chartAreaRef.value;
	if (!el || !props.data.length) return;
	const rect = el.getBoundingClientRect();
	const x = e.clientX - rect.left;
	const pct = x / rect.width;
	const idx = Math.round(pct * (props.data.length - 1));
	hoverIdx.value = Math.max(0, Math.min(idx, props.data.length - 1));
}

const hoverPoint = computed(() => {
	if (hoverIdx.value < 0 || !props.data.length) return null;
	const d = props.data[hoverIdx.value];
	const pctX = (hoverIdx.value / (props.data.length - 1)) * 100;
	const h = svgH.value - pad.top - pad.bottom;
	const yPx = pad.top + h - (d.primary / lineMaxVal.value) * h;
	const pctY = (yPx / svgH.value) * 100;
	return { pctX, pctY, value: d.primary, label: d.label };
});

const tooltipStyle = computed(() => {
	if (!hoverPoint.value) return {};
	const alignRight = hoverPoint.value.pctX > 70;
	return {
		left: alignRight ? 'auto' : hoverPoint.value.pctX + '%',
		right: alignRight ? (100 - hoverPoint.value.pctX) + '%' : 'auto',
		top: Math.max(0, hoverPoint.value.pctY - 15) + '%',
	};
});

// Sparse labels for line charts — pick evenly spaced indices
const sparseIndices = computed(() => {
	const len = props.data.length;
	if (len <= 8) return props.data.map((_, i) => i);
	const step = Math.ceil(len / 7);
	const result: number[] = [];
	for (let i = 0; i < len; i += step) result.push(i);
	return result;
});

const sparseLabels = computed(() => sparseIndices.value.map(i => props.data[i]?.label || ''));

// Position each label at the exact percentage matching its data point in the SVG
function lineLabelStyle(sparseIdx: number) {
	const dataIdx = sparseIndices.value[sparseIdx];
	const total = props.data.length - 1;
	if (total <= 0) return { left: '50%', transform: 'translateX(-50%)' };
	const pct = (dataIdx / total) * 100;
	return { left: pct + '%', transform: 'translateX(-50%)' };
}
</script>

<style scoped>
.mini-chart-wrapper {
	width: 100%;
}

.chart-title {
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	margin-bottom: 8px;
}

/* Line chart with Y-axis */
.line-chart-container {
	display: flex;
	gap: 0;
}

.y-axis {
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	align-items: flex-end;
	padding: 4px 8px 0 0;
	min-width: 48px;
	flex-shrink: 0;
}

.y-label {
	font-size: 10px;
	color: var(--theme--foreground-subdued);
	line-height: 1;
}

.line-chart-area {
	flex: 1;
	position: relative;
	min-width: 0;
}

.line-chart {
	width: 100%;
	height: 100%;
	display: block;
}

/* Hover overlay */
.hover-overlay {
	position: absolute;
	inset: 0;
	cursor: crosshair;
}

.hover-line {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 1px;
	background: var(--theme--primary);
	opacity: 0.4;
	pointer-events: none;
}

.hover-dot {
	position: absolute;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--theme--primary);
	border: 2px solid var(--theme--background);
	box-shadow: 0 0 0 1px var(--theme--primary);
	transform: translate(-50%, -50%);
	pointer-events: none;
	z-index: 2;
}

.hover-tooltip {
	position: absolute;
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: 6px;
	padding: 6px 10px;
	pointer-events: none;
	z-index: 3;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
	white-space: nowrap;
	transform: translateX(12px);
}

.tooltip-value {
	font-size: 14px;
	font-weight: 700;
	color: var(--theme--foreground);
}

.tooltip-label {
	font-size: 11px;
	color: var(--theme--foreground-subdued);
	margin-top: 1px;
}

.line-labels-row {
	position: relative;
	height: 16px;
	margin-left: 48px;
	border-top: 1px solid var(--theme--border-color);
	padding-top: 4px;
}

.line-label {
	position: absolute;
	font-size: 10px;
	color: var(--theme--foreground-subdued);
	white-space: nowrap;
}

/* Bar chart */
.chart {
	display: flex;
	align-items: flex-end;
	gap: 6px;
	position: relative;
}

.chart-gradient {
	position: absolute;
	inset: 0;
	background: linear-gradient(to top, var(--theme--background-subdued), transparent);
	border-radius: var(--theme--border-radius);
	pointer-events: none;
	z-index: 0;
}

.chart-bar-group {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: flex-end;
	height: 100%;
	position: relative;
	z-index: 1;
}

.chart-bar-wrapper {
	display: flex;
	flex-direction: column;
	align-items: center;
	width: 100%;
}

.chart-bar-count {
	font-size: 10px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	margin-bottom: 2px;
	min-height: 12px;
}

.chart-bar {
	width: 100%;
	max-width: 40px;
	display: flex;
	flex-direction: column-reverse;
	border-radius: 4px 4px 0 0;
	overflow: hidden;
	flex: 1;
	min-height: 2px;
}

.bar-segment {
	min-height: 0;
}

.bar-primary {
	background: var(--theme--primary);
}

.bar-secondary {
	background: var(--theme--danger, #e35169);
}

.bar-placeholder {
	background: var(--theme--border-color);
	opacity: 0.3;
	border-radius: 4px 4px 0 0;
}

.chart-labels {
	display: flex;
	gap: 6px;
	border-top: 1px solid var(--theme--border-color);
	padding-top: 4px;
	justify-content: space-between;
}

.chart-label-cell {
	flex: 1;
	text-align: center;
	font-size: 10px;
	color: var(--theme--foreground-subdued);
}
</style>
