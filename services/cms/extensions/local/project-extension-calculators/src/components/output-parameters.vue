<template>
	<div ref="rootEl" :class="['input-parameters', { compact, 'has-expanded': expandedIdx !== null }]">
		<p v-if="!compact" class="section-desc">Specify output parameters returned by your webservice. Each maps to a calculated cell in your Excel workbook.</p>
		<div class="params-header">
			<div v-if="!compact" class="col col-expand"></div>
			<div class="col col-mapping"><span v-tooltip.bottom="'Cell in your Excel workbook whose calculated value is returned as output'">Excel value mapping</span></div>
			<div class="col col-title"><span v-tooltip.bottom="'Human-readable label shown to API consumers'">Readable label</span></div>
			<div class="col col-name"><span v-tooltip.bottom="'Name used in the webservice response'">Parameter name</span></div>
			<div class="col col-type"><span v-tooltip.bottom="'Data type of the returned value. Expand the row for array column configuration.'">Parameter type</span></div>
			<div class="col col-actions"></div>
			<div v-if="!compact" class="col col-drag-handle"></div>
		</div>

		<div
			v-for="(entry, idx) in paramEntries"
			:key="entry.key"
			:class="['param-row-wrapper', { 'row-alt': idx % 2 === 1, 'row-expanded': expandedIdx === idx, 'row-dimmed': expandedIdx !== null && expandedIdx !== idx, dragging: dragIdx === idx, 'drop-above': dropIdx === idx && dragIdx !== null && dragIdx > idx, 'drop-below': dropIdx === idx && dragIdx !== null && dragIdx < idx }]"
			@click.capture="handleDimmedClick($event, idx)"
			@dragover="onDragOver($event, idx)"
			@drop="onDrop($event, idx)"
			@dragend="onDragEnd"
		>
			<div class="param-row">
				<div v-if="!compact" class="col col-expand">
					<v-icon
						class="expand-icon"
						:name="expandedIdx === idx ? 'expand_more' : 'chevron_right'"
						small
						clickable
						@click="toggleExpand(idx)"
					/>
				</div>
				<div class="col col-mapping">
					<div class="mapping-field">
						<v-button
							class="icon-btn picker-prefix"
							icon
							v-tooltip.bottom="entry.param.type === 'array' ? 'Pick range' : 'Pick cell'"
							@click="openPicker(entry.key)"
						>
							<v-icon name="grid_on" />
						</v-button>
						<v-input
							class="picker-input"
							:model-value="entry.param.mapping"
							monospace
							disabled
						/>
					</div>
				</div>
				<div class="col col-title">
					<v-input
						:model-value="entry.param.title"
						placeholder="Display label"
						@update:model-value="handleExistingTitle(entry.key, $event)"
						@blur="commitPendingRename(entry.key)"
					/>
				</div>
				<div class="col col-name">
					<v-input
						:model-value="nameDisplay(entry.key)"
						placeholder="param_name"
						monospace
						@update:model-value="handleExistingName(entry.key, $event)"
						@blur="commitPendingRename(entry.key)"
					/>
				</div>
				<div class="col col-type">
					<v-select
						:model-value="entry.param.type"
						:items="typeChoices"
						@update:model-value="handleTypeChange(entry.key, $event)"
					/>
				</div>
				<div class="col col-actions">
					<v-button
						class="icon-btn delete-btn"
						secondary
						icon
						v-tooltip.bottom="'Remove'"
						@click="deleteParam(entry.key)"
					>
						<v-icon name="delete" />
					</v-button>
				</div>
				<div v-if="!compact" class="col col-drag-handle" draggable="true" @dragstart="onDragStart($event, idx)">
					<v-icon class="drag-handle" name="drag_indicator" small />
				</div>
			</div>

			<div v-if="!compact && expandedIdx === idx" class="param-expanded">
				<div class="expanded-field">
					<div class="field-label">Description</div>
					<v-input
						:model-value="entry.param.description || ''"
						placeholder="Help text for this parameter"
						@update:model-value="updateParam(entry.key, 'description', $event || null)"
					/>
				</div>

				<template v-if="entry.param.type === 'array' && entry.param.mapping">
					<div class="expanded-section-label">Object Array</div>
					<div class="sub-items-header">
						<div class="sub-col sub-col-col">Column</div>
						<div class="sub-col sub-col-title">Label</div>
						<div class="sub-col sub-col-name">Parameter name</div>
						<div class="sub-col sub-col-type">Type</div>
					</div>

					<div
						v-for="(sub, subIdx) in subItemEntries(entry.param)"
						:key="sub.key"
						:class="['sub-item-row', { 'row-alt': subIdx % 2 === 1 }]"
					>
						<div class="sub-col sub-col-col">
							<span class="col-letter">{{ sub.item.mapping_item }}</span>
						</div>
						<div class="sub-col sub-col-title">
							<v-input
								:model-value="sub.item.title"
								placeholder="Label"
								@update:model-value="updateSubItem(entry.key, sub.key, 'title', $event)"
							/>
						</div>
						<div class="sub-col sub-col-name">
							<v-input
								:model-value="isAutoKey(sub.key) ? '' : sub.key"
								placeholder="field_name"
								monospace
								@update:model-value="renameSubItem(entry.key, sub.key, $event || autoKey(sub.item.mapping_item))"
							/>
						</div>
						<div class="sub-col sub-col-type">
							<v-select
								:model-value="sub.item.type"
								:items="simpleTypeChoices"
								@update:model-value="updateSubItem(entry.key, sub.key, 'type', $event)"
							/>
						</div>
					</div>
				</template>
			</div>
		</div>

		<div class="param-row add-row">
			<div v-if="!compact" class="col col-expand"></div>
			<div class="col col-mapping">
				<div class="mapping-field">
					<v-button
						class="icon-btn picker-prefix"
						icon
						v-tooltip.bottom="newType === 'array' ? 'Pick range' : 'Pick cell'"
						@click="openPicker(newAddKey)"
					>
						<v-icon name="grid_on" />
					</v-button>
					<v-input
						class="picker-input"
						v-model="newMapping"
						monospace
						disabled
					/>
				</div>
			</div>
			<div class="col col-title">
				<v-input :model-value="newTitle" placeholder="Label" @update:model-value="handleNewTitle" />
			</div>
			<div class="col col-name">
				<v-input :model-value="newName" placeholder="param_name" monospace @update:model-value="handleNewName" />
			</div>
			<div class="col col-type">
				<v-select v-model="newType" :items="typeChoices" />
			</div>
			<div class="col col-actions">
				<v-button class="icon-btn" icon :disabled="!newName || !newTitle || !newMapping" @click="addParam" v-tooltip.bottom="'Add parameter'">
					<v-icon name="add" />
				</v-button>
			</div>
			<div v-if="!compact" class="col col-drag-handle"></div>
		</div>

		<cell-picker-dialog
			v-model="pickerOpen"
			:sheets="sheets"
			:current-value="pickerCurrentValue"
			:allow-range="pickerAllowRange"
			:title="pickerTitle"
			:description="pickerDescription"
			:mapped-cells="mappedCells"
			@confirm="handlePickerConfirm"
		/>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { OutputParameter, OutputArrayItem } from '../types';
import CellPickerDialog from './cell-picker-dialog.vue';
import type { MappedCell } from './cell-picker-dialog.vue';

const rootEl = ref<HTMLElement | null>(null);

function onClickOutside(e: MouseEvent) {
	if (expandedIdx.value === null) return;
	const target = e.target as Node;
	if (!target.isConnected) return;
	if (rootEl.value?.contains(target)) return;
	if ((target as Element).closest?.('#dialog-outlet, .v-dialog, .v-overlay')) return;
	expandedIdx.value = null;
}

onMounted(() => document.addEventListener('click', onClickOutside));
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside));

const props = defineProps<{
	modelValue: Record<string, OutputParameter>;
	sheets: Record<string, unknown[][]> | null;
	compact?: boolean;
	inputMappings?: Record<string, string>;
}>();

const emit = defineEmits<{
	'update:modelValue': [value: Record<string, OutputParameter>];
}>();

const expandedIdx = ref<number | null>(null);
const newTitle = ref('');
const newName = ref('');
const newNameEdited = ref(false);
const newType = ref<OutputParameter['type']>('number');
const newMapping = ref('');

const newAddKey = '__new__';

const pickerOpen = ref(false);
const pickerParamKey = ref('');

const simpleTypeChoices = [
	{ text: 'Number', value: 'number' },
	{ text: 'Integer', value: 'integer' },
	{ text: 'String', value: 'string' },
	{ text: 'Boolean', value: 'boolean' },
	{ text: 'Date', value: 'date' },
	{ text: 'Time', value: 'time' },
	{ text: 'Datetime', value: 'datetime' },
	{ text: 'Percentage', value: 'percentage' },
];

const allTypeChoices = [
	...simpleTypeChoices,
	{ text: 'Array', value: 'array' },
];

const compactTypeChoices = [
	{ text: 'Number', value: 'number' },
	{ text: 'String', value: 'string' },
];

const typeChoices = computed(() => props.compact ? compactTypeChoices : allTypeChoices);

const paramEntries = computed(() =>
	Object.entries(props.modelValue)
		.map(([key, param]) => ({ key, param }))
		.sort((a, b) => (a.param.order ?? 999) - (b.param.order ?? 999)),
);

const mappedCells = computed<MappedCell[]>(() => {
	const cells: MappedCell[] = [];
	for (const [key, param] of Object.entries(props.modelValue)) {
		if (param.mapping) {
			cells.push({ ref: param.mapping, type: 'output', label: param.title || key });
		}
	}
	if (props.inputMappings) {
		for (const [key, mapping] of Object.entries(props.inputMappings)) {
			if (mapping) cells.push({ ref: mapping, type: 'input', label: key });
		}
	}
	return cells;
});

// Drag reorder
const dragIdx = ref<number | null>(null);
const dropIdx = ref<number | null>(null);

function onDragStart(e: DragEvent, idx: number) {
	dragIdx.value = idx;
	e.dataTransfer!.effectAllowed = 'move';
}
function onDragOver(e: DragEvent, idx: number) {
	e.preventDefault();
	dropIdx.value = idx;
}
function onDrop(e: DragEvent, idx: number) {
	e.preventDefault();
	if (dragIdx.value !== null && dragIdx.value !== idx) reorderParams(dragIdx.value, idx);
	dragIdx.value = null;
	dropIdx.value = null;
}
function onDragEnd() {
	dragIdx.value = null;
	dropIdx.value = null;
}

function reorderParams(fromIdx: number, toIdx: number) {
	const entries = [...paramEntries.value];
	const [moved] = entries.splice(fromIdx, 1);
	entries.splice(toIdx, 0, moved!);
	const updated: Record<string, OutputParameter> = {};
	entries.forEach(({ key, param }, i) => {
		updated[key] = { ...param, order: i };
	});
	emitUpdate(updated);
}

const pickerCurrentValue = computed(() => {
	if (!pickerParamKey.value) return '';
	if (pickerParamKey.value === newAddKey) return newMapping.value;
	if (!props.modelValue[pickerParamKey.value]) return '';
	return props.modelValue[pickerParamKey.value]!.mapping || '';
});

const pickerAllowRange = computed(() => {
	if (pickerParamKey.value === newAddKey) return newType.value === 'array';
	if (!pickerParamKey.value || !props.modelValue[pickerParamKey.value]) return false;
	return props.modelValue[pickerParamKey.value]!.type === 'array';
});

const pickerTitle = computed(() => pickerAllowRange.value ? 'Select output range' : 'Select output cell');

const pickerDescription = computed(() => pickerAllowRange.value
	? 'Drag across columns to select the output range. Each column becomes a field in the result.'
	: 'Click the cell whose calculated value will be returned as output.',
);

function handleDimmedClick(e: MouseEvent, idx: number) {
	if (expandedIdx.value !== null && expandedIdx.value !== idx) {
		e.stopPropagation();
		e.preventDefault();
		expandedIdx.value = null;
	}
}

function toggleExpand(idx: number) {
	expandedIdx.value = expandedIdx.value === idx ? null : idx;
}

function emitUpdate(newMap: Record<string, OutputParameter>) {
	emit('update:modelValue', newMap);
}

function updateParam(key: string, field: string, value: unknown) {
	const current = props.modelValue[key];
	if (!current) return;
	emitUpdate({ ...props.modelValue, [key]: { ...current, [field]: value } });
}

function handleTypeChange(key: string, newType: string) {
	const current = props.modelValue[key];
	if (!current) return;
	const updated: OutputParameter = { ...current, type: newType as OutputParameter['type'] };
	if (newType === 'array' && !updated.items) {
		updated.items = { type: 'object', properties: {} };
		updated.mapping = '';
	} else if (newType !== 'array') {
		delete updated.items;
		updated.mapping = '';
	}
	emitUpdate({ ...props.modelValue, [key]: updated });
}

function renameParam(oldKey: string, newKey: string) {
	if (!newKey || newKey === oldKey) return;
	const entries = Object.entries(props.modelValue);
	const updated: Record<string, OutputParameter> = {};
	for (const [k, v] of entries) {
		updated[k === oldKey ? newKey : k] = v;
	}
	emitUpdate(updated);
}

const nameOverride = ref<Record<string, string>>({});

function nameDisplay(key: string): string {
	if (key in nameOverride.value) return nameOverride.value[key];
	return key;
}

function handleExistingTitle(key: string, val: string) {
	updateParam(key, 'title', val);
	if (key in nameOverride.value) {
		nameOverride.value = { ...nameOverride.value, [key]: toSnakeCase(val) };
	}
}

function commitPendingRename(key: string) {
	if (!(key in nameOverride.value)) return;
	const newKey = nameOverride.value[key];
	const newOverrides = { ...nameOverride.value };
	delete newOverrides[key];
	nameOverride.value = newOverrides;
	if (newKey && newKey !== key) renameParam(key, newKey);
}

function handleExistingName(key: string, val: string) {
	nameOverride.value = { ...nameOverride.value, [key]: val };
}

function deleteParam(key: string) {
	const { [key]: _, ...rest } = props.modelValue;
	expandedIdx.value = null;
	// Re-index order values
	const sorted = Object.entries(rest)
		.map(([k, p]) => ({ key: k, param: p }))
		.sort((a, b) => (a.param.order ?? 999) - (b.param.order ?? 999));
	const reindexed: Record<string, OutputParameter> = {};
	sorted.forEach(({ key: k, param }, i) => {
		reindexed[k] = { ...param, order: i };
	});
	emitUpdate(reindexed);
}

function toSnakeCase(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function handleNewTitle(val: string) {
	newTitle.value = val;
	if (!newNameEdited.value) {
		newName.value = toSnakeCase(val);
	}
}

function handleNewName(val: string) {
	newName.value = val;
	newNameEdited.value = val !== '';
}

function addParam() {
	if (!newName.value || !newTitle.value) return;
	const param: OutputParameter = {
		mapping: newMapping.value,
		title: newTitle.value,
		type: newType.value,
		readOnly: true,
		order: paramEntries.value.length,
	};
	if (newType.value === 'array') {
		param.items = { type: 'object', properties: buildSubItemsFromRange(newMapping.value, {}) };
	}
	emitUpdate({ ...props.modelValue, [newName.value]: param });
	newTitle.value = '';
	newName.value = '';
	newNameEdited.value = false;
	newType.value = 'number';
	newMapping.value = '';
}

function openPicker(key: string) {
	pickerParamKey.value = key;
	pickerOpen.value = true;
}

function handlePickerConfirm(cellRef: string) {
	if (pickerParamKey.value === newAddKey) {
		newMapping.value = cellRef;
	} else if (pickerParamKey.value) {
		const param = props.modelValue[pickerParamKey.value];
		if (param?.type === 'array') {
			const newProps = buildSubItemsFromRange(cellRef, param.items?.properties || {});
			const updatedParam: OutputParameter = {
				...param,
				mapping: cellRef,
				items: { type: 'object', properties: newProps },
			};
			emitUpdate({ ...props.modelValue, [pickerParamKey.value]: updatedParam });
		} else {
			updateParam(pickerParamKey.value, 'mapping', cellRef);
		}
	}
}

function autoKey(col: string): string {
	return `__${col}`;
}

function isAutoKey(key: string): boolean {
	return key.startsWith('__');
}

// --- Sub-item helpers ---

function buildSubItemsFromRange(
	mapping: string,
	existing: Record<string, OutputArrayItem>,
): Record<string, OutputArrayItem> {
	const cols = rangeColumns(mapping);
	if (cols.length === 0) return {};

	// Index existing items by column letter
	const byCol: Record<string, { key: string; item: OutputArrayItem }> = {};
	for (const [key, item] of Object.entries(existing)) {
		byCol[item.mapping_item] = { key, item };
	}

	const result: Record<string, OutputArrayItem> = {};
	for (const col of cols) {
		const match = byCol[col.value];
		if (match) {
			result[match.key] = match.item;
		} else {
			result[autoKey(col.value)] = { mapping_item: col.value, title: '', type: 'string' };
		}
	}
	return result;
}

function subItemEntries(param: OutputParameter): { key: string; item: OutputArrayItem }[] {
	if (!param.items?.properties) return [];
	return Object.entries(param.items.properties).map(([key, item]) => ({ key, item }));
}

function rangeColumns(mapping: string): { text: string; value: string }[] {
	const match = mapping.match(/([A-Z]+)\d+:([A-Z]+)\d+$/);
	if (!match) return [];
	const start = letterToCol(match[1]!);
	const end = letterToCol(match[2]!);
	const cols: { text: string; value: string }[] = [];
	for (let i = start; i <= end; i++) {
		const l = colLetter(i);
		cols.push({ text: l, value: l });
	}
	return cols;
}

function letterToCol(letters: string): number {
	let col = 0;
	for (let i = 0; i < letters.length; i++) {
		col = col * 26 + (letters.charCodeAt(i) - 64);
	}
	return col - 1;
}

function colLetter(col: number): string {
	let letter = '';
	let c = col;
	while (c >= 0) {
		letter = String.fromCharCode((c % 26) + 65) + letter;
		c = Math.floor(c / 26) - 1;
	}
	return letter;
}

function updateSubItem(paramKey: string, subKey: string, field: string, value: unknown) {
	const param = props.modelValue[paramKey];
	if (!param?.items?.properties[subKey]) return;
	const updatedProps = {
		...param.items.properties,
		[subKey]: { ...param.items.properties[subKey], [field]: value },
	};
	const updatedParam: OutputParameter = {
		...param,
		items: { ...param.items, properties: updatedProps },
	};
	emitUpdate({ ...props.modelValue, [paramKey]: updatedParam });
}

function renameSubItem(paramKey: string, oldKey: string, newKey: string) {
	if (!newKey || newKey === oldKey) return;
	const param = props.modelValue[paramKey];
	if (!param?.items?.properties) return;
	const entries = Object.entries(param.items.properties);
	const updatedProps: Record<string, OutputArrayItem> = {};
	for (const [k, v] of entries) {
		updatedProps[k === oldKey ? newKey : k] = v;
	}
	const updatedParam: OutputParameter = {
		...param,
		items: { ...param.items, properties: updatedProps },
	};
	emitUpdate({ ...props.modelValue, [paramKey]: updatedParam });
}
</script>

<style scoped>
.input-parameters {
	padding: 20px 0;
}

.input-parameters.compact {
	padding: 8px 0;
}

.section-desc {
	margin: 0 0 12px;
	font-size: 13px;
	line-height: 1.5;
	color: var(--theme--foreground-subdued);
}

.params-header {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 0;
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color);
}

.param-row-wrapper {
	border-bottom: var(--theme--border-width) solid var(--theme--border-color);
}

.row-alt {
	background-color: var(--theme--background-subdued);
}

.param-row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 0;
}

.col-expand { width: 28px; flex-shrink: 0; }
.col-title { flex: 2; min-width: 0; }
.col-name { flex: 2; min-width: 0; }
.col-type { width: 150px; flex-shrink: 0; }
.col-mapping { flex: 2; min-width: 0; }
.col-actions { width: 60px; flex-shrink: 0; display: flex; gap: 4px; align-items: center; }

.col-drag-handle {
	width: 24px;
	flex-shrink: 0;
}

.drag-handle {
	cursor: grab;
	color: var(--theme--foreground-subdued);
}

.expand-icon {
	color: var(--theme--foreground-subdued);
}

.mapping-field {
	display: flex;
	align-items: center;
	gap: 0;
}

.mapping-field .picker-prefix {
	--v-button-background-color: var(--theme--primary);
	--v-button-background-color-hover: var(--theme--primary-accent);
	--v-button-color: var(--white);
	--v-button-color-hover: var(--white);
}

.mapping-field .picker-prefix :deep(button) {
	border-top-right-radius: 0;
	border-bottom-right-radius: 0;
	border: var(--theme--border-width) solid var(--theme--primary);
}

.mapping-field .picker-input {
	flex: 1;
	min-width: 0;
}

.mapping-field .picker-input :deep(.input) {
	border-top-left-radius: 0;
	border-bottom-left-radius: 0;
	border-left: none;
}

.icon-btn {
	--v-button-min-width: 60px;
	--v-button-height: 60px;
	flex-shrink: 0;
}

.delete-btn {
	--v-button-color: var(--theme--danger);
	--v-button-color-hover: var(--theme--danger);
}

.param-expanded {
	padding: 12px 0 16px 36px;
}

.expanded-field {
	flex: 1;
	min-width: 0;
}

.expanded-section-label {
	margin-top: 16px;
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
}

.field-label {
	margin-bottom: 8px;
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
}

.row-dimmed {
	opacity: 0.4;
	cursor: default;
	transition: opacity 0.15s;
}

.row-expanded {
	transition: opacity 0.15s;
}

.has-expanded .add-row {
	opacity: 0.4;
	pointer-events: none;
}

.add-row {
	border-bottom: none;
	margin-top: 4px;
	transition: opacity 0.15s;
}

/* Sub-items table */
.sub-items-header {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 0;
	margin-top: 8px;
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color);
}

.sub-item-row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 0;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color);
}

.sub-col-col { width: 60px; flex-shrink: 0; }
.sub-col-title { flex: 2; min-width: 0; }
.sub-col-name { flex: 2; min-width: 0; }
.sub-col-type { width: 130px; flex-shrink: 0; }

.sub-col-col {
	display: flex;
	align-items: center;
	justify-content: center;
}

.col-letter {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
}

.dragging {
	opacity: 0.4;
}

.drop-above {
	border-top: 2px solid var(--theme--primary);
}

.drop-below {
	border-bottom: 2px solid var(--theme--primary);
}
</style>
