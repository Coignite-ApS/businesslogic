<template>
	<v-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" @esc="$emit('update:modelValue', false)">
		<v-card :class="['cell-picker-card', { fullscreen }]">
			<div class="picker-header">
				<div class="picker-title">{{ title || 'Select cell' }}</div>
				<p v-if="description" class="picker-desc">{{ description }}</p>
			</div>

			<div class="spreadsheet">
				<div class="bar bar-top">
					<button
						v-if="tabsOverflow"
						class="bar-btn"
						@click="scrollTabs(-1)"
					><v-icon name="chevron_left" x-small /></button>
					<div ref="tabScroller" class="tab-scroller">
						<button
							v-for="name in sheetNames"
							:key="name"
							:class="['sheet-tab', { active: activeTab === name }]"
							@click="activeTab = name"
						>{{ name }}</button>
					</div>
					<button
						v-if="tabsOverflow"
						class="bar-btn"
						@click="scrollTabs(1)"
					><v-icon name="chevron_right" x-small /></button>
					<div class="bar-spacer"></div>
					<button
						class="bar-btn bar-btn-fs"
						v-tooltip.bottom="fullscreen ? 'Exit fullscreen' : 'Fullscreen'"
						@click="fullscreen = !fullscreen"
					><v-icon :name="fullscreen ? 'fullscreen_exit' : 'fullscreen'" small /></button>
				</div>
				<div v-if="activeSheet" class="grid-scroll">
					<table class="cell-grid">
						<thead>
							<tr>
								<th class="row-header"></th>
								<th v-for="col in colCount" :key="col" class="col-header">{{ colLetter(col - 1) }}</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="(row, ri) in activeSheet" :key="ri">
								<td class="row-header">{{ ri + 1 }}</td>
								<td
									v-for="(_, ci) in colCount"
									:key="ci"
									:class="cellClass(ri, ci)"
									v-tooltip.bottom="getMappedCell(ri, ci)?.label"
									@mousedown="handleMouseDown(ri, ci, $event)"
									@mouseenter="handleMouseEnter(ri, ci)"
									@mouseup="handleMouseUp"
								>
									{{ getCellValue(ri, ci) }}
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<div v-else class="grid-empty">No sheet data available.</div>
				<div class="bar bar-bottom">
					<span class="bar-label">{{ allowRange ? 'Selected range' : 'Selected cell' }}</span>
					<code v-if="selection" class="bar-value">{{ selection }}</code>
					<span v-else class="bar-hint">{{ allowRange ? 'Drag to select a range' : 'Click a cell' }}</span>
					<span v-if="selection && allowRange && !isRange" class="bar-hint bar-warn">Drag to select a range</span>
					<span v-if="duplicateWarning" class="bar-hint bar-warn">{{ duplicateWarning }}</span>
					<span class="bar-spacer"></span>
					<span v-if="mappedCells && mappedCells.length > 0" class="bar-legend">
						<span class="legend-dot legend-input"></span> Input
						<span class="legend-dot legend-output"></span> Output
					</span>
				</div>
			</div>

			<div class="picker-actions">
				<v-button secondary @click="$emit('update:modelValue', false)">Cancel</v-button>
				<v-button :disabled="!canConfirm" @click="handleConfirm">Confirm</v-button>
			</div>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';

const tabScroller = ref<HTMLElement | null>(null);
const tabsOverflow = ref(false);

function checkTabsOverflow() {
	const el = tabScroller.value;
	if (!el) { tabsOverflow.value = false; return; }
	tabsOverflow.value = el.scrollWidth > el.clientWidth;
}

function scrollTabs(dir: number) {
	const el = tabScroller.value;
	if (!el) return;
	el.scrollBy({ left: dir * 120, behavior: 'smooth' });
}

export interface MappedCell {
	ref: string;
	type: 'input' | 'output';
	label: string;
}

const props = defineProps<{
	modelValue: boolean;
	sheets: Record<string, unknown[][]> | null;
	currentValue?: string;
	allowRange?: boolean;
	singleColumn?: boolean;
	fixedRangeLength?: number | null;
	title?: string;
	description?: string;
	mappedCells?: MappedCell[];
}>();

const emit = defineEmits<{
	'update:modelValue': [value: boolean];
	confirm: [cellRef: string];
}>();

const fullscreen = ref(false);
const activeTab = ref<string>('');
const startCell = ref<{ row: number; col: number } | null>(null);
const endCell = ref<{ row: number; col: number } | null>(null);

const sheetNames = computed(() => (props.sheets ? Object.keys(props.sheets) : []));

const activeSheet = computed(() => {
	if (!props.sheets || !activeTab.value) return null;
	return props.sheets[activeTab.value] || null;
});

const colCount = computed(() => {
	if (!activeSheet.value) return 0;
	return Math.max(...activeSheet.value.map((row) => row.length), 0);
});

const selection = computed(() => {
	if (!startCell.value || !activeTab.value) return '';
	const start = `'${activeTab.value}'!${colLetter(startCell.value.col)}${startCell.value.row + 1}`;
	if (!endCell.value || (startCell.value.row === endCell.value.row && startCell.value.col === endCell.value.col)) {
		return start;
	}
	return `${start}:${colLetter(endCell.value.col)}${endCell.value.row + 1}`;
});

const isRange = computed(() => {
	if (!startCell.value || !endCell.value) return false;
	return startCell.value.row !== endCell.value.row || startCell.value.col !== endCell.value.col;
});

const duplicateWarning = computed(() => {
	if (!selection.value || !props.mappedCells) return '';
	const existing = props.mappedCells.find((mc) => mc.ref === selection.value);
	if (existing) return `Already mapped to "${existing.label}"`;
	return '';
});

const canConfirm = computed(() => {
	if (!selection.value) return false;
	if (props.allowRange) return isRange.value;
	return true;
});

function colLetter(col: number): string {
	let letter = '';
	let c = col;
	while (c >= 0) {
		letter = String.fromCharCode((c % 26) + 65) + letter;
		c = Math.floor(c / 26) - 1;
	}
	return letter;
}

function letterToCol(letters: string): number {
	let col = 0;
	for (let i = 0; i < letters.length; i++) {
		col = col * 26 + (letters.charCodeAt(i) - 64);
	}
	return col - 1;
}

function parseCellRef(ref: string): { sheet: string; col: number; row: number } | null {
	const match = ref.match(/^'?([^'!]+)'?!([A-Z]+)(\d+)$/);
	if (!match) return null;
	return { sheet: match[1], col: letterToCol(match[2]), row: parseInt(match[3]) - 1 };
}

function parseRangeRef(ref: string): { sheet: string; startCol: number; startRow: number; endCol: number; endRow: number } | null {
	const match = ref.match(/^'?([^'!]+)'?!([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
	if (!match) return null;
	return {
		sheet: match[1],
		startCol: letterToCol(match[2]),
		startRow: parseInt(match[3]) - 1,
		endCol: letterToCol(match[4]),
		endRow: parseInt(match[5]) - 1,
	};
}

// Build a lookup map: "SheetName!A1" → MappedCell for highlight rendering
const mappedCellMap = computed(() => {
	const map = new Map<string, MappedCell>();
	if (!props.mappedCells) return map;
	for (const mc of props.mappedCells) {
		const parsed = parseCellRef(mc.ref);
		if (parsed) {
			map.set(`${parsed.sheet}!${colLetter(parsed.col)}${parsed.row + 1}`, mc);
		}
	}
	return map;
});

function getMappedCell(row: number, col: number): MappedCell | undefined {
	if (!activeTab.value) return undefined;
	const key = `${activeTab.value}!${colLetter(col)}${row + 1}`;
	return mappedCellMap.value.get(key);
}

function cellClass(row: number, col: number): Record<string, boolean> {
	const mapped = getMappedCell(row, col);
	return {
		cell: true,
		selected: isCellSelected(row, col),
		'mapped-input': !!mapped && mapped.type === 'input',
		'mapped-output': !!mapped && mapped.type === 'output',
	};
}

function getCellValue(row: number, col: number): string {
	if (!activeSheet.value) return '';
	const r = activeSheet.value[row];
	if (!r || col >= r.length) return '';
	const val = r[col];
	if (val === null || val === undefined) return '';
	return String(val);
}

function isCellSelected(row: number, col: number): boolean {
	if (!startCell.value) return false;
	if (!endCell.value) return startCell.value.row === row && startCell.value.col === col;
	const minRow = Math.min(startCell.value.row, endCell.value.row);
	const maxRow = Math.max(startCell.value.row, endCell.value.row);
	const minCol = Math.min(startCell.value.col, endCell.value.col);
	const maxCol = Math.max(startCell.value.col, endCell.value.col);
	return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
}

const dragging = ref(false);

function constrainEnd(row: number, col: number): { row: number; col: number } {
	const c = props.singleColumn && startCell.value ? startCell.value.col : col;
	if (props.fixedRangeLength && startCell.value) {
		return { row: startCell.value.row + props.fixedRangeLength - 1, col: c };
	}
	return { row, col: c };
}

function handleMouseDown(row: number, col: number, event: MouseEvent) {
	if (props.allowRange && event.shiftKey && startCell.value) {
		endCell.value = constrainEnd(row, col);
		return;
	}
	startCell.value = { row, col };
	endCell.value = null;
	if (props.allowRange) {
		dragging.value = true;
	}
}

function handleMouseEnter(row: number, col: number) {
	if (dragging.value && props.allowRange) {
		endCell.value = constrainEnd(row, col);
	}
}

function handleMouseUp() {
	dragging.value = false;
}

function handleConfirm() {
	if (selection.value) {
		emit('confirm', selection.value);
		emit('update:modelValue', false);
	}
}

// Initialize from currentValue and set default tab
watch(() => props.modelValue, (open) => {
	if (!open) { fullscreen.value = false; return; }

	// Set default tab
	if (sheetNames.value.length > 0) {
		activeTab.value = sheetNames.value[0]!;
	}

	nextTick(() => checkTabsOverflow());

	// Parse current value to pre-select
	startCell.value = null;
	endCell.value = null;

	if (props.currentValue) {
		const range = parseRangeRef(props.currentValue);
		if (range) {
			activeTab.value = range.sheet;
			startCell.value = { row: range.startRow, col: range.startCol };
			endCell.value = { row: range.endRow, col: range.endCol };
			return;
		}
		const cell = parseCellRef(props.currentValue);
		if (cell) {
			activeTab.value = cell.sheet;
			startCell.value = { row: cell.row, col: cell.col };
		}
	}
});
</script>

<style scoped>
.cell-picker-card {
	min-width: 640px;
	max-width: 90vw;
	transition: all 0.2s ease;
}

.cell-picker-card.fullscreen {
	width: 96vw;
	max-width: 96vw;
	height: 92vh;
	display: flex;
	flex-direction: column;
}

.fullscreen .spreadsheet {
	flex: 1;
	display: flex;
	flex-direction: column;
	min-height: 0;
}

.fullscreen .grid-scroll {
	flex: 1;
	max-height: none;
}

.fullscreen .picker-header {
	flex-shrink: 0;
}

.fullscreen .picker-actions {
	flex-shrink: 0;
}

.picker-header {
	padding: 20px 20px 0;
}

.picker-title {
	font-size: 24px;
	font-weight: 700;
	line-height: 32px;
}

.picker-desc {
	margin: 4px 0 0;
	font-size: 14px;
	line-height: 22px;
	color: var(--theme--foreground-subdued);
}

/* Spreadsheet block */
.spreadsheet {
	margin: 16px 20px 0;
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

/* Shared top/bottom bar */
.bar {
	display: flex;
	align-items: center;
	height: 32px;
	background: var(--theme--background-subdued);
	font-size: 13px;
}

.bar-top {
	border-bottom: var(--theme--border-width) solid var(--theme--border-color);
}

.bar-bottom {
	border-top: var(--theme--border-width) solid var(--theme--border-color);
	padding: 0 12px;
	gap: 8px;
}

/* Tab scroller */
.tab-scroller {
	display: flex;
	overflow: hidden;
	flex: 0 1 auto;
	min-width: 0;
}

.bar-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 100%;
	background: none;
	border: none;
	border-left: var(--theme--border-width) solid var(--theme--border-color);
	color: var(--theme--foreground-subdued);
	cursor: pointer;
	flex-shrink: 0;
}

.bar-btn:first-child {
	border-left: none;
}

.bar-btn:hover {
	color: var(--theme--foreground);
	background: var(--theme--background);
}

.bar-btn-fs {
	width: 36px;
}

.bar-spacer {
	flex: 1;
}

.sheet-tab {
	padding: 0 16px;
	height: 100%;
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	background: none;
	border: none;
	border-right: var(--theme--border-width) solid var(--theme--border-color);
	cursor: pointer;
	white-space: nowrap;
	flex-shrink: 0;
	transition: color 0.1s, background 0.1s;
}

.sheet-tab:hover {
	color: var(--theme--foreground);
	background: var(--theme--background);
}

.sheet-tab.active {
	color: var(--theme--foreground);
	background: var(--theme--background);
	box-shadow: inset 0 -2px 0 var(--theme--primary);
}

/* Grid */
.grid-scroll {
	overflow: auto;
	max-height: 360px;
}

.cell-grid {
	border-collapse: collapse;
	font-size: 13px;
	width: 100%;
}

.cell-grid th,
.cell-grid td {
	border: 1px solid var(--theme--border-color);
	padding: 4px 8px;
	white-space: nowrap;
	min-width: 60px;
	max-width: 200px;
	overflow: hidden;
	text-overflow: ellipsis;
}

.col-header {
	background: var(--theme--background-subdued);
	font-weight: 600;
	text-align: center;
	position: sticky;
	top: 0;
	z-index: 2;
}

.row-header {
	background: var(--theme--background-subdued);
	font-weight: 600;
	text-align: center;
	width: 40px;
	min-width: 40px;
	position: sticky;
	left: 0;
	z-index: 1;
}

thead .row-header {
	z-index: 3;
}

.cell {
	cursor: pointer;
	user-select: none;
}

.cell:hover {
	background: var(--theme--primary-background);
}

.cell.selected {
	background: var(--theme--primary);
	color: var(--theme--primary-inverted, #fff);
}

.cell.mapped-input {
	background: rgba(59, 130, 246, 0.15);
	border-color: rgba(59, 130, 246, 0.3);
}

.cell.mapped-output {
	background: rgba(34, 197, 94, 0.15);
	border-color: rgba(34, 197, 94, 0.3);
}

.cell.mapped-input.selected,
.cell.mapped-output.selected {
	background: var(--theme--primary);
	color: var(--theme--primary-inverted, #fff);
}

/* Bottom bar content */
.bar-label {
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	white-space: nowrap;
}

.bar-value {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
	color: var(--theme--foreground);
}

.bar-hint {
	color: var(--theme--foreground-subdued);
	font-style: italic;
}

.bar-warn {
	color: var(--theme--warning);
	font-style: normal;
}

.picker-actions {
	display: flex;
	justify-content: flex-end;
	gap: 12px;
	padding: 16px 20px;
}

.grid-empty {
	padding: 40px;
	text-align: center;
	color: var(--theme--foreground-subdued);
}

.bar-legend {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.legend-dot {
	display: inline-block;
	width: 10px;
	height: 10px;
	border-radius: 2px;
}

.legend-input {
	background: rgba(59, 130, 246, 0.4);
}

.legend-output {
	background: rgba(34, 197, 94, 0.4);
	margin-left: 8px;
}
</style>
