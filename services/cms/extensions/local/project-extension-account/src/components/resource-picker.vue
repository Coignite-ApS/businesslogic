<template>
	<div class="resource-picker">
		<!-- Calculators Section -->
		<div class="rp-section">
			<div class="rp-section-header">
				<v-icon name="calculate" small />
				<span class="rp-section-title">Calculators</span>
				<label class="rp-wildcard">
					<input type="checkbox" :checked="calcWildcard" @change="toggleCalcWildcard" />
					All calculators
				</label>
			</div>

			<div v-if="!calcWildcard" class="rp-list">
				<div v-if="calculators.length === 0" class="rp-empty">No calculators found</div>
				<label v-for="calc in calculators" :key="calc.id" class="rp-item">
					<input
						type="checkbox"
						:checked="selectedCalcIds.includes(calc.id)"
						@change="toggleCalc(calc.id)"
					/>
					<span class="rp-item-name">{{ calc.name || calc.id }}</span>
				</label>
			</div>
			<div v-else class="rp-wildcard-note">Key will have access to all current and future calculators</div>

			<div class="rp-actions">
				<label v-for="action in calcActionOptions" :key="action" class="rp-action">
					<input
						type="checkbox"
						:checked="selectedCalcActions.includes(action)"
						@change="toggleCalcAction(action)"
					/>
					{{ action }}
				</label>
			</div>
		</div>

		<!-- Knowledge Bases Section -->
		<div class="rp-section">
			<div class="rp-section-header">
				<v-icon name="menu_book" small />
				<span class="rp-section-title">Knowledge Bases</span>
				<label class="rp-wildcard">
					<input type="checkbox" :checked="kbWildcard" @change="toggleKbWildcard" />
					All KBs
				</label>
			</div>

			<div v-if="!kbWildcard" class="rp-list">
				<div v-if="knowledgeBases.length === 0" class="rp-empty">No knowledge bases found</div>
				<label v-for="kb in knowledgeBases" :key="kb.id" class="rp-item">
					<input
						type="checkbox"
						:checked="selectedKbIds.includes(kb.id)"
						@change="toggleKb(kb.id)"
					/>
					<span class="rp-item-name">{{ kb.name || kb.id }}</span>
				</label>
			</div>
			<div v-else class="rp-wildcard-note">Key will have access to all current and future knowledge bases</div>

			<div class="rp-actions">
				<label v-for="action in kbActionOptions" :key="action" class="rp-action">
					<input
						type="checkbox"
						:checked="selectedKbActions.includes(action)"
						@change="toggleKbAction(action)"
					/>
					{{ action }}
				</label>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import type { PermissionSelection } from '../utils/permissions';

const props = defineProps<{
	api: any;
	accountId: string | null;
	modelValue: PermissionSelection;
}>();

const emit = defineEmits<{
	(e: 'update:modelValue', value: PermissionSelection): void;
}>();

const calculators = ref<{ id: string; name: string }[]>([]);
const knowledgeBases = ref<{ id: string; name: string }[]>([]);

const calcActionOptions = ['execute', 'describe'];
const kbActionOptions = ['search', 'ask'];

const selectedCalcIds = ref<string[]>([...props.modelValue.calcResources]);
const selectedCalcActions = ref<string[]>([...props.modelValue.calcActions]);
const calcWildcard = ref(props.modelValue.calcWildcard);
const selectedKbIds = ref<string[]>([...props.modelValue.kbResources]);
const selectedKbActions = ref<string[]>([...props.modelValue.kbActions]);
const kbWildcard = ref(props.modelValue.kbWildcard);

function emitUpdate() {
	emit('update:modelValue', {
		calcResources: [...selectedCalcIds.value],
		calcActions: [...selectedCalcActions.value],
		calcWildcard: calcWildcard.value,
		kbResources: [...selectedKbIds.value],
		kbActions: [...selectedKbActions.value],
		kbWildcard: kbWildcard.value,
	});
}

function toggleCalc(id: string) {
	const idx = selectedCalcIds.value.indexOf(id);
	if (idx >= 0) selectedCalcIds.value.splice(idx, 1);
	else selectedCalcIds.value.push(id);
	emitUpdate();
}

function toggleKb(id: string) {
	const idx = selectedKbIds.value.indexOf(id);
	if (idx >= 0) selectedKbIds.value.splice(idx, 1);
	else selectedKbIds.value.push(id);
	emitUpdate();
}

function toggleCalcWildcard() {
	calcWildcard.value = !calcWildcard.value;
	if (calcWildcard.value) selectedCalcIds.value = [];
	emitUpdate();
}

function toggleKbWildcard() {
	kbWildcard.value = !kbWildcard.value;
	if (kbWildcard.value) selectedKbIds.value = [];
	emitUpdate();
}

function toggleCalcAction(action: string) {
	const idx = selectedCalcActions.value.indexOf(action);
	if (idx >= 0) selectedCalcActions.value.splice(idx, 1);
	else selectedCalcActions.value.push(action);
	emitUpdate();
}

function toggleKbAction(action: string) {
	const idx = selectedKbActions.value.indexOf(action);
	if (idx >= 0) selectedKbActions.value.splice(idx, 1);
	else selectedKbActions.value.push(action);
	emitUpdate();
}

async function fetchResources() {
	if (!props.accountId || !props.api) return;

	try {
		const { data } = await props.api.get('/items/calculators', {
			params: {
				filter: { account: { _eq: props.accountId } },
				fields: ['id', 'name'],
				sort: ['name'],
				limit: -1,
			},
		});
		calculators.value = data.data || [];
	} catch {
		calculators.value = [];
	}

	try {
		const { data } = await props.api.get('/items/knowledge_bases', {
			params: {
				filter: { account: { _eq: props.accountId } },
				fields: ['id', 'name'],
				sort: ['name'],
				limit: -1,
			},
		});
		knowledgeBases.value = data.data || [];
	} catch {
		knowledgeBases.value = [];
	}
}

watch(() => props.modelValue, (val) => {
	selectedCalcIds.value = [...val.calcResources];
	selectedCalcActions.value = [...val.calcActions];
	calcWildcard.value = val.calcWildcard;
	selectedKbIds.value = [...val.kbResources];
	selectedKbActions.value = [...val.kbActions];
	kbWildcard.value = val.kbWildcard;
}, { deep: true });

watch(() => props.accountId, fetchResources);
onMounted(fetchResources);
</script>

<style scoped>
.resource-picker {
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.rp-section {
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 12px;
}

.rp-section-header {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 8px;
}

.rp-section-title {
	font-weight: 600;
	font-size: 14px;
	flex: 1;
}

.rp-wildcard {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	cursor: pointer;
}

.rp-list {
	max-height: 200px;
	overflow-y: auto;
	border: 1px solid var(--theme--border-color);
	border-radius: 4px;
	padding: 4px;
	margin-bottom: 8px;
}

.rp-item {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 4px 8px;
	cursor: pointer;
	border-radius: 4px;
}

.rp-item:hover {
	background: var(--theme--background-subdued);
}

.rp-item-name {
	font-size: 13px;
}

.rp-empty {
	padding: 12px;
	text-align: center;
	color: var(--theme--foreground-subdued);
	font-size: 13px;
}

.rp-wildcard-note {
	padding: 8px 12px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	font-style: italic;
	margin-bottom: 8px;
}

.rp-actions {
	display: flex;
	gap: 12px;
	padding-top: 4px;
	border-top: 1px solid var(--theme--border-color);
}

.rp-action {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 12px;
	text-transform: uppercase;
	color: var(--theme--foreground-subdued);
	cursor: pointer;
}
</style>
