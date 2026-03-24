<template>
	<div ref="rootEl" :class="['input-parameters', { compact, 'has-expanded': expandedIdx !== null }]">
		<p v-if="!compact" class="section-desc">Specify input parameters for your webservice. Expand a row to configure validation and constraints.</p>
		<div class="params-header">
			<div v-if="!compact" class="col col-expand"></div>
			<div class="col col-mapping" v-tooltip.bottom="'Cell in your Excel workbook that receives the input value, e.g. \'Sheet1\'!B1'">Excel cell mapping</div>
			<div class="col col-title"><span v-tooltip.bottom="'Human-readable label shown to API consumers'">Readable label</span></div>
			<div class="col col-name"><span v-tooltip.bottom="'Name used when calling your webservice'">Parameter name</span></div>
			<div class="col col-type"><span v-tooltip.bottom="'Data type the Excel cell expects. Expand the row to set validation constraints.'">Parameter type</span></div>
			<div v-if="!compact" class="col col-actions"><span v-tooltip.bottom="'Whether this parameter must be provided when calling your webservice'">Required</span></div>
			<div v-if="compact" class="col col-actions-compact"></div>
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
							v-tooltip.bottom="'Pick cell'"
							@click="openPicker(entry.key, 'mapping')"
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
				<div v-if="!compact" class="col col-actions">
					<v-button
						:class="['icon-btn', 'required-btn', { active: entry.param.required }]"
						secondary
						icon
						v-tooltip.bottom="entry.param.required ? 'Required (click to make optional)' : 'Optional (click to make required)'"
						@click="updateParam(entry.key, 'required', !entry.param.required)"
					>
						<v-icon :name="entry.param.required ? 'check_box' : 'check_box_outline_blank'" />
					</v-button>
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
				<div v-if="compact" class="col col-actions-compact">
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
					<div class="field-label"><span v-tooltip.bottom="'Optional help text shown to API consumers'">Description</span></div>
					<v-input
						:model-value="entry.param.description || ''"
						placeholder="Help text for this parameter"
						@update:model-value="updateParam(entry.key, 'description', $event)"
					/>
				</div>

				<fieldset v-if="entry.param.type === 'number' || entry.param.type === 'integer' || entry.param.type === 'percentage' || entry.param.type === 'currency'" class="predefined-group">
					<legend class="predefined-legend">Number settings</legend>
					<div class="predefined-group-body">
						<div class="expanded-row">
							<div class="expanded-field">
								<div class="field-label"><span v-tooltip.bottom="'Lowest accepted value'">Min</span></div>
								<v-input
									:model-value="entry.param.minimum ?? ''"
									type="number"
									placeholder="Min"
									@update:model-value="updateParam(entry.key, 'minimum', toNum($event))"
								/>
							</div>
							<div class="expanded-field">
								<div class="field-label"><span v-tooltip.bottom="'Highest accepted value'">Max</span></div>
								<v-input
									:model-value="entry.param.maximum ?? ''"
									type="number"
									placeholder="Max"
									@update:model-value="updateParam(entry.key, 'maximum', toNum($event))"
								/>
							</div>
							<div class="expanded-field">
								<div class="field-label"><span v-tooltip.bottom="'Increment step for slider and input (maps to multipleOf in JSON Schema)'">Step</span></div>
								<v-input
									:model-value="entry.param.multipleOf ?? ''"
									type="number"
									placeholder="Step"
									@update:model-value="updateParam(entry.key, 'multipleOf', toNum($event))"
								/>
							</div>
							<div class="expanded-field">
								<div class="field-label"><span v-tooltip.bottom="'Value used when parameter is not provided'">Default</span></div>
								<v-input
									:model-value="entry.param.default ?? ''"
									type="number"
									placeholder="Default"
									@update:model-value="updateParam(entry.key, 'default', toNum($event))"
								/>
							</div>
						</div>
						<div class="expanded-row">
							<div v-if="entry.param.type === 'currency'" class="expanded-field">
								<div class="field-label"><span v-tooltip.bottom="'Currency code shown in the test input (e.g. USD, EUR, GBP)'">Currency code</span></div>
								<v-input
									:model-value="entry.param.currency || ''"
									placeholder="USD"
									@update:model-value="updateParam(entry.key, 'currency', $event || null)"
								/>
							</div>
							<div v-if="entry.param.type !== 'percentage'" class="expanded-field">
								<div class="field-label"><span v-tooltip.bottom="'How the input is displayed in the test view'">Display</span></div>
								<v-select
									:model-value="entry.param.display || 'input'"
									:items="[{ text: 'Input field', value: 'input', icon: 'edit' }, { text: 'Slider', value: 'slider', icon: 'linear_scale' }]"
									item-icon="icon"
									@update:model-value="updateParam(entry.key, 'display', $event === 'input' ? null : $event)"
								/>
							</div>
						</div>
					</div>
				</fieldset>

				<fieldset v-if="entry.param.type === 'string'" class="predefined-group">
					<legend class="predefined-legend">String settings</legend>
					<div class="predefined-group-body">
						<div class="expanded-row">
							<div class="expanded-field">
								<div class="field-label"><span v-tooltip.bottom="'Minimum number of characters'">Min length</span></div>
								<v-input
									:model-value="entry.param.minLength ?? ''"
									type="number"
									placeholder="Min"
									@update:model-value="updateParam(entry.key, 'minLength', toNum($event))"
								/>
							</div>
							<div class="expanded-field">
								<div class="field-label"><span v-tooltip.bottom="'Maximum number of characters'">Max length</span></div>
								<v-input
									:model-value="entry.param.maxLength ?? ''"
									type="number"
									placeholder="Max"
									@update:model-value="updateParam(entry.key, 'maxLength', toNum($event))"
								/>
							</div>
							<div class="expanded-field">
								<div class="field-label"><span v-tooltip.bottom="'Value used when parameter is not provided'">Default</span></div>
								<v-input
									:model-value="entry.param.default ?? ''"
									placeholder="Default value"
									@update:model-value="updateParam(entry.key, 'default', $event || null)"
								/>
							</div>
						</div>
						<div class="expanded-row">
							<div class="expanded-field">
								<div class="field-label"><span v-tooltip.bottom="'Regular expression the value must match'">Pattern</span></div>
								<v-input
									:model-value="entry.param.pattern ?? ''"
									placeholder="Regex"
									monospace
									@update:model-value="updateParam(entry.key, 'pattern', $event || null)"
								/>
							</div>
						</div>
					</div>
				</fieldset>

				<template v-if="entry.param.type === 'boolean'">
					<div class="expanded-row">
						<div class="expanded-field toggle-field">
							<div class="field-label"><span v-tooltip.bottom="'Value used when parameter is not provided'">Default</span></div>
							<v-checkbox
								:model-value="entry.param.default === true"
								label="True"
								@update:model-value="updateParam(entry.key, 'default', $event ? true : false)"
							/>
						</div>
					</div>
				</template>

				<template v-if="entry.param.type === 'date'">
					<div class="expanded-row">
						<div class="expanded-field">
							<div class="field-label"><span v-tooltip.bottom="'Value used when parameter is not provided'">Default</span></div>
							<v-input
								:model-value="entry.param.default ?? ''"
								placeholder="YYYY-MM-DD"
								@update:model-value="updateParam(entry.key, 'default', $event || null)"
							/>
						</div>
					</div>
				</template>

				<template v-if="entry.param.type === 'time'">
					<div class="expanded-row">
						<div class="expanded-field">
							<div class="field-label"><span v-tooltip.bottom="'Value used when parameter is not provided'">Default</span></div>
							<v-input
								:model-value="entry.param.default ?? ''"
								placeholder="HH:MM"
								@update:model-value="updateParam(entry.key, 'default', $event || null)"
							/>
						</div>
					</div>
				</template>

				<template v-if="entry.param.type === 'datetime'">
					<div class="expanded-row">
						<div class="expanded-field">
							<div class="field-label"><span v-tooltip.bottom="'Value used when parameter is not provided'">Default</span></div>
							<v-input
								:model-value="entry.param.default ?? ''"
								placeholder="YYYY-MM-DDTHH:MM:SS"
								@update:model-value="updateParam(entry.key, 'default', $event || null)"
							/>
						</div>
					</div>
				</template>

				<fieldset class="predefined-group">
					<legend class="predefined-legend">
						Predefined values (dropdown)
						<v-button
							v-if="entry.param.selection_mapping_id || entry.param.selection_mapping_title"
							class="clear-btn"
							x-small
							secondary
							@click="clearPredefined(entry.key)"
						>
							Clear
						</v-button>
					</legend>
					<div class="predefined-group-body">
						<div class="expanded-row">
							<div class="expanded-field">
								<div class="field-label"><span v-tooltip.bottom="'Column range containing the option values sent to the API'">ID column range</span></div>
								<div class="mapping-field">
									<v-button
										class="icon-btn picker-prefix"
										secondary
										icon
										v-tooltip.bottom="'Pick range'"
										@click="openPicker(entry.key, 'selection_mapping_id')"
									>
										<v-icon name="grid_on" />
									</v-button>
									<v-input
										class="picker-input"
										:model-value="entry.param.selection_mapping_id || ''"
										monospace
										disabled
									/>
								</div>
							</div>
							<div class="expanded-field">
								<div class="field-label"><span v-tooltip.bottom="'Column range containing the labels shown in the dropdown'">Title column range</span></div>
								<div class="mapping-field">
									<v-button
										class="icon-btn picker-prefix"
										secondary
										icon
										v-tooltip.bottom="'Pick range'"
										@click="openPicker(entry.key, 'selection_mapping_title')"
									>
										<v-icon name="grid_on" />
									</v-button>
									<v-input
										class="picker-input"
										:model-value="entry.param.selection_mapping_title || ''"
										monospace
										disabled
									/>
								</div>
							</div>
						</div>
						<div v-if="rangeSameColumn(entry.param)" class="range-warning">
							ID and Title ranges must use different columns.
						</div>
						<div v-else-if="rangeLengthMismatch(entry.param)" class="range-warning">
							ID and Title ranges must have the same length.
						</div>
					</div>
				</fieldset>
			</div>
		</div>

		<div class="param-row add-row">
			<div v-if="!compact" class="col col-expand"></div>
			<div class="col col-mapping">
				<div class="mapping-field">
					<v-button
						class="icon-btn picker-prefix"
						icon
						v-tooltip.bottom="'Pick cell'"
						@click="openPicker(newAddKey, 'mapping')"
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
			<div v-if="!compact" class="col col-actions">
				<v-button class="icon-btn" icon :disabled="!newName || !newTitle || !newMapping" @click="addParam" v-tooltip.bottom="'Add parameter'">
					<v-icon name="add" />
				</v-button>
			</div>
			<div v-if="compact" class="col col-actions-compact">
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
			:single-column="pickerAllowRange"
			:fixed-range-length="pickerFixedRangeLength"
			:title="pickerTitle"
			:description="pickerDescription"
			:mapped-cells="mappedCells"
			@confirm="handlePickerConfirm"
		/>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { InputParameter } from '../types';
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
	modelValue: Record<string, InputParameter>;
	sheets: Record<string, unknown[][]> | null;
	compact?: boolean;
	outputMappings?: Record<string, string>;
}>();

const emit = defineEmits<{
	'update:modelValue': [value: Record<string, InputParameter>];
}>();

const expandedIdx = ref<number | null>(null);
const newTitle = ref('');
const newName = ref('');
const newNameEdited = ref(false);
const newType = ref<InputParameter['type']>('number');
const newMapping = ref('');

const newAddKey = '__new__';

const pickerOpen = ref(false);
const pickerParamKey = ref('');
const pickerField = ref<'mapping' | 'selection_mapping_id' | 'selection_mapping_title'>('mapping');

const allTypeChoices = [
	{ text: 'Number', value: 'number' },
	{ text: 'Integer', value: 'integer' },
	{ text: 'String', value: 'string' },
	{ text: 'Boolean', value: 'boolean' },
	{ text: 'Date', value: 'date' },
	{ text: 'Time', value: 'time' },
	{ text: 'Datetime', value: 'datetime' },
	{ text: 'Percentage', value: 'percentage' },
	{ text: 'Currency', value: 'currency' },
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
			cells.push({ ref: param.mapping, type: 'input', label: param.title || key });
		}
	}
	if (props.outputMappings) {
		for (const [key, mapping] of Object.entries(props.outputMappings)) {
			if (mapping) cells.push({ ref: mapping, type: 'output', label: key });
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
	const updated: Record<string, InputParameter> = {};
	entries.forEach(({ key, param }, i) => {
		updated[key] = { ...param, order: i };
	});
	emitUpdate(updated);
}

const pickerCurrentValue = computed(() => {
	if (!pickerParamKey.value) return '';
	if (pickerParamKey.value === newAddKey) return newMapping.value;
	if (!props.modelValue[pickerParamKey.value]) return '';
	const param = props.modelValue[pickerParamKey.value]!;
	if (pickerField.value === 'mapping') return param.mapping || '';
	if (pickerField.value === 'selection_mapping_id') return param.selection_mapping_id || '';
	if (pickerField.value === 'selection_mapping_title') return param.selection_mapping_title || '';
	return '';
});

const pickerAllowRange = computed(() => pickerField.value !== 'mapping');

const pickerTitle = computed(() => {
	if (pickerField.value === 'selection_mapping_id') return 'Select ID column range';
	if (pickerField.value === 'selection_mapping_title') return 'Select title column range';
	return 'Select input cell';
});

const pickerDescription = computed(() => {
	if (pickerField.value === 'selection_mapping_id') return 'Drag down a column to select the dropdown option IDs.';
	if (pickerField.value === 'selection_mapping_title') return 'Drag down a column to select the labels shown in the dropdown.';
	return 'Click the cell where this input value will be written to.';
});

const pickerFixedRangeLength = computed(() => {
	if (!pickerAllowRange.value || !pickerParamKey.value) return null;
	const param = props.modelValue[pickerParamKey.value];
	if (!param) return null;
	// When picking title, constrain to ID range length and vice versa
	const otherRef = pickerField.value === 'selection_mapping_id'
		? param.selection_mapping_title
		: param.selection_mapping_id;
	return rangeLength(otherRef) || null;
});

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

function emitUpdate(newMap: Record<string, InputParameter>) {
	emit('update:modelValue', newMap);
}

function updateParam(key: string, field: string, value: unknown) {
	const current = props.modelValue[key];
	if (!current) return;
	const updated = { ...current, [field]: value };
	// Auto-strip oneOf when both selection_mapping fields are cleared
	if ((field === 'selection_mapping_id' || field === 'selection_mapping_title') && !value) {
		if (!updated.selection_mapping_id && !updated.selection_mapping_title) {
			delete (updated as any).oneOf;
			delete (updated as any).selection_mapping_id;
			delete (updated as any).selection_mapping_title;
		}
	}
	emitUpdate({ ...props.modelValue, [key]: updated });
}

function handleTypeChange(key: string, newType: string) {
	const current = props.modelValue[key];
	if (!current) return;
	const updated: InputParameter = { ...current, type: newType as InputParameter['type'] };
	// Reset type-specific constraints
	delete updated.minimum;
	delete updated.maximum;
	delete updated.multipleOf;
	delete updated.minLength;
	delete updated.maxLength;
	delete updated.pattern;
	delete updated.default;
	delete updated.display;
	delete updated.currency;
	// Set percentage defaults
	if (newType === 'percentage') {
		updated.minimum = 0;
		updated.maximum = 100;
	}
	emitUpdate({ ...props.modelValue, [key]: updated });
}

function renameParam(oldKey: string, newKey: string) {
	if (!newKey || newKey === oldKey) return;
	// Preserve order by rebuilding the map
	const entries = Object.entries(props.modelValue);
	const updated: Record<string, InputParameter> = {};
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
	const reindexed: Record<string, InputParameter> = {};
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
	const param: InputParameter = {
		mapping: newMapping.value,
		title: newTitle.value,
		type: newType.value,
		order: paramEntries.value.length,
	};
	if (newType.value === 'percentage') {
		param.minimum = 0;
		param.maximum = 100;
	}
	emitUpdate({ ...props.modelValue, [newName.value]: param });
	newTitle.value = '';
	newName.value = '';
	newNameEdited.value = false;
	newType.value = 'number';
	newMapping.value = '';
}

function clearPredefined(key: string) {
	const current = props.modelValue[key];
	if (!current) return;
	const { selection_mapping_id, selection_mapping_title, oneOf, ...rest } = current;
	emitUpdate({ ...props.modelValue, [key]: rest as InputParameter });
}

function openPicker(key: string, field: 'mapping' | 'selection_mapping_id' | 'selection_mapping_title') {
	pickerParamKey.value = key;
	pickerField.value = field;
	pickerOpen.value = true;
}

function handlePickerConfirm(cellRef: string) {
	if (pickerParamKey.value === newAddKey) {
		newMapping.value = cellRef;
	} else if (pickerParamKey.value) {
		updateParam(pickerParamKey.value, pickerField.value, cellRef);
	}
}

function rangeLength(rangeRef: string | undefined): number | null {
	if (!rangeRef) return null;
	const match = rangeRef.match(/^'?[^'!]+'?![A-Z]+(\d+):[A-Z]+(\d+)$/);
	if (!match) return null;
	return Math.abs(parseInt(match[2]!) - parseInt(match[1]!)) + 1;
}

function rangeColumn(rangeRef: string | undefined): string | null {
	if (!rangeRef) return null;
	const match = rangeRef.match(/^'?([^'!]+)'?!([A-Z]+)\d+:[A-Z]+\d+$/);
	if (!match) return null;
	return match[1] + '!' + match[2];
}

function rangeSameColumn(param: InputParameter): boolean {
	const idCol = rangeColumn(param.selection_mapping_id);
	const titleCol = rangeColumn(param.selection_mapping_title);
	if (!idCol || !titleCol) return false;
	return idCol === titleCol;
}

function rangeLengthMismatch(param: InputParameter): boolean {
	const idLen = rangeLength(param.selection_mapping_id);
	const titleLen = rangeLength(param.selection_mapping_title);
	if (idLen === null || titleLen === null) return false;
	return idLen !== titleLen;
}

function toNum(val: unknown): number | null {
	if (val === '' || val === null || val === undefined) return null;
	const n = Number(val);
	return isNaN(n) ? null : n;
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
.col-actions { width: 128px; flex-shrink: 0; display: flex; gap: 4px; align-items: center; }
.col-actions-compact { width: 60px; flex-shrink: 0; display: flex; gap: 4px; align-items: center; }

.col-drag-handle {
	width: 24px;
	flex-shrink: 0;
}

.drag-handle {
	cursor: grab;
	color: var(--theme--foreground-subdued);
}

.required-btn {
	--v-button-color: var(--theme--foreground-subdued);
	--v-button-color-hover: var(--theme--primary);
}

.required-btn.active {
	--v-button-color: var(--theme--primary);
	--v-button-color-hover: var(--theme--primary);
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

.expanded-row {
	display: flex;
	gap: 12px;
	margin-top: 12px;
}

.predefined-group {
	margin-top: 16px;
	padding: 12px;
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
}

.predefined-legend {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 0 6px;
	font-size: 14px;
	font-weight: 600;
	line-height: 0;
	color: var(--theme--foreground-subdued);
}

.predefined-group-body .expanded-row {
	margin-top: 0;
}

.predefined-group-body .expanded-row + .expanded-row {
	margin-top: 12px;
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

.range-warning {
	margin-top: 8px;
	font-size: 13px;
	color: var(--theme--danger);
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
