<template>
	<private-view title="Configure">
		<template #headline>
			<v-breadcrumb
				v-if="current?.name"
				:items="[{ name: current.name, to: `/calculators/${currentId}` }]"
			/>
		</template>
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="tune" />
			</v-button>
		</template>

		<template #navigation>
			<calculator-navigation
				:calculators="calculators"
				:current-id="currentId"
				:loading="loading"
				:creating="saving"
				:has-excel="hasExcel"
				:has-config="hasConfigured"
				@create="handleCreate"
			/>
		</template>

		<template #actions>
			<v-button
				v-tooltip.bottom="'Test calculator'"
				icon
				rounded
				:disabled="!canTest"
				@click="router.push(`/calculators/${currentId}/test`)"
			>
				<v-icon name="play_arrow" />
			</v-button>
			<v-button
				v-if="hasChanges"
				v-tooltip.bottom="'Undo changes'"
				icon
				rounded
				secondary
				@click="resetChanges"
			>
				<v-icon name="undo" />
			</v-button>
			<v-button
				v-tooltip.bottom="'Save'"
				icon
				rounded
				:disabled="!canSave"
				:loading="saving"
				@click="handleSave"
			>
				<v-icon name="check" />
			</v-button>
		</template>

		<div v-if="currentId && current" class="configure-content">
			<div class="detail-header">
				<div class="field">
					<div class="field-label">Name</div>
					<v-input
						:model-value="editedName"
						placeholder="e.g. Mortgage Calculator"
						@update:model-value="handleNameChange"
					/>
				</div>
				<div class="field">
					<div class="field-label">Icon</div>
					<interface-select-icon
						:value="editedIcon || 'calculate'"
						@input="edits.icon = $event || null"
					/>
				</div>
				<div class="field field-full">
					<div class="field-label">Description</div>
					<v-input
						:model-value="editedDescription"
						placeholder="What does this calculator do?"
						@update:model-value="edits.description = $event"
					/>
				</div>
			</div>

			<!-- Tabs: Input / Output -->
			<div class="tabs-bar">
				<button
					class="tab-btn"
					:class="{ active: activeTab === 'input' }"
					:disabled="!hasExcel"
					@click="activeTab = 'input'"
				>
					Input
				</button>
				<button
					class="tab-btn"
					:class="{ active: activeTab === 'output' }"
					:disabled="!hasExcel"
					@click="activeTab = 'output'"
				>
					Output
				</button>
			</div>

			<div v-if="!hasExcel" class="tabs-hint">
				<v-icon name="info" x-small />
				Upload an Excel workbook on the overview page to configure input and output parameters.
			</div>

			<div v-if="hasExcel && activeTab === 'input'" class="tab-content">
				<input-parameters
					:model-value="localInput"
					:sheets="testConfig?.sheets || null"
					:output-mappings="outputMappingMap"
					@update:model-value="localInput = $event"
				/>
			</div>

			<div v-if="hasExcel && activeTab === 'output'" class="tab-content">
				<output-parameters
					:model-value="localOutput"
					:sheets="testConfig?.sheets || null"
					:input-mappings="inputMappingMap"
					@update:model-value="localOutput = $event"
				/>
			</div>

			<div v-if="validationErrors.length > 0" class="validation-errors">
				<v-icon name="warning" small />
				<div>
					<div v-for="(err, idx) in validationErrors" :key="idx" class="validation-error-item">
						<strong>{{ err.param }}:</strong> {{ err.message }}
					</div>
				</div>
			</div>

			<div v-if="hasExcel && previewJson" class="api-preview">
				<div class="preview-header">
					<v-icon name="code" small />
					<span>{{ activeTab === 'input' ? 'Example request body' : 'Example response' }}</span>
				</div>
				<p class="preview-desc">
					{{ activeTab === 'input'
						? 'POST to /execute endpoint with this JSON body. Each field corresponds to an input parameter above.'
						: 'The /execute endpoint returns this JSON structure. Each field corresponds to an output parameter above.' }}
				</p>
				<code-block :code="previewJson" language="json" />
			</div>
			<!-- Access Control -->
			<div v-if="hasExcel" class="access-control">
				<div class="section-header">
					<v-icon name="security" small />
					<span>Access Control</span>
				</div>
				<p class="section-desc">
					Restrict which IPs and origins can call this calculator. Leave empty to allow all.
					Changes require a redeploy to take effect.
				</p>

				<div class="field field-full">
					<div class="field-label-row">
						<div class="field-label">Allowed IPs</div>
						<button class="link-btn" :disabled="loadingMyIp" @click="addMyIp">
							{{ loadingMyIp ? 'Detecting…' : 'Add my IP' }}
						</button>
					</div>
					<div class="tag-input">
						<div v-if="localAllowedIps.length" class="tag-list">
							<v-chip
								v-for="(ip, idx) in localAllowedIps"
								:key="idx"
								class="access-chip"
								small
								close
								@close="localAllowedIps.splice(idx, 1)"
							>
								{{ ip }}
							</v-chip>
						</div>
						<v-input
							v-model="newIp"
							placeholder="e.g. 192.168.1.1 or 203.0.113.0/24"
							@update:model-value="ipError = ''"
							@keydown.enter.prevent="addIp"
						/>
						<div v-if="ipError" class="tag-error">{{ ipError }}</div>
					</div>
				</div>

				<div class="field field-full">
					<div class="field-label">Allowed Origins</div>
					<div class="tag-input">
						<div v-if="localAllowedOrigins.length" class="tag-list">
							<v-chip
								v-for="(origin, idx) in localAllowedOrigins"
								:key="idx"
								class="access-chip"
								small
								close
								@close="localAllowedOrigins.splice(idx, 1)"
							>
								{{ origin }}
							</v-chip>
						</div>
						<v-input
							v-model="newOrigin"
							placeholder="e.g. https://app.example.com"
							@update:model-value="originError = ''"
							@keydown.enter.prevent="addOrigin"
						/>
						<div v-if="originError" class="tag-error">{{ originError }}</div>
					</div>
				</div>
			</div>
		</div>

		<div v-else-if="loading" class="module-loading">
			<v-progress-circular indeterminate />
		</div>

		<template #sidebar>
			<sidebar-detail id="info" icon="info" title="Information">
				<div class="sidebar-info">
					<p v-if="current">
						Configure input parameters for <strong>{{ current.name }}</strong>.
					</p>
					<p v-else>Select a calculator to configure.</p>
				</div>
			</sidebar-detail>
		</template>
		<v-dialog v-model="showUnsavedDialog" @esc="cancelLeave">
			<v-card>
				<v-card-title>Unsaved Changes</v-card-title>
				<v-card-text>You have unsaved changes. Are you sure you want to leave?</v-card-text>
				<v-card-actions>
					<v-button secondary @click="cancelLeave">Stay</v-button>
					<v-button kind="danger" @click="confirmLeave">Leave</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import { useCalculators } from '../composables/use-calculators';
import { useCreateCalculator } from '../composables/use-create-calculator';
import { useUnsavedGuard } from '../composables/use-unsaved-guard';
import CalculatorNavigation from '../components/navigation.vue';
import InputParameters from '../components/input-parameters.vue';
import OutputParameters from '../components/output-parameters.vue';
import CodeBlock from '../components/code-block.vue';
import type { Calculator, CalculatorConfig, InputParameter, OutputParameter, OutputArrayItem } from '../types';
import { extractParams, wrapParams, toLogicalType, toSchemaParam, generateOneOf, validateSchema } from '../utils/param-transforms';
import { validateInputParams, validateOutputParams, type ValidationError } from '../utils/param-validation';

const api = useApi();
const route = useRoute();
const router = useRouter();

const {
	calculators, current, loading, saving,
	fetchOne, update,
	createConfig, updateConfig,
} = useCalculators(api);

const { handleCreate } = useCreateCalculator(api);

const activeTab = ref('input');
const localInput = ref<Record<string, InputParameter>>({});
const localOutput = ref<Record<string, OutputParameter>>({});
const edits = ref<Partial<Calculator>>({});
const validationErrors = ref<ValidationError[]>([]);

// Access control
const localAllowedIps = ref<string[]>([]);
const localAllowedOrigins = ref<string[]>([]);
const newIp = ref('');
const newOrigin = ref('');
const ipError = ref('');
const originError = ref('');
const loadingMyIp = ref(false);

const currentId = computed(() => (route.params.id as string) || null);

const testConfig = computed(
	() => current.value?.configs?.find((c) => c.test_environment) || null,
);

const hasExcel = computed(() => !!testConfig.value?.excel_file);

const hasConfigured = computed(() => {
	const input = testConfig.value?.input as any;
	const props = input?.properties || input;
	return !!(props && typeof props === 'object' && Object.keys(props).length > 0);
});

// Edited field values (merge edits over current)
const editedName = computed(() =>
	edits.value.name !== undefined ? edits.value.name : (current.value?.name || ''),
);
const editedDescription = computed(() =>
	edits.value.description !== undefined ? edits.value.description : (current.value?.description || ''),
);
const editedIcon = computed(() =>
	edits.value.icon !== undefined ? edits.value.icon : (current.value?.icon || ''),
);

const hasCalcEdits = computed(() => Object.keys(edits.value).length > 0);

function handleNameChange(value: string) {
	edits.value = { ...edits.value, name: value };
}


const originalInput = computed(() =>
	extractParams<InputParameter>(testConfig.value?.input as Record<string, unknown> | null),
);

const originalOutput = computed(() =>
	extractParams<OutputParameter>(testConfig.value?.output as Record<string, unknown> | null),
);

// Cross-parameter mapping maps for cell highlighting
const inputMappingMap = computed(() => {
	const map: Record<string, string> = {};
	for (const [key, param] of Object.entries(localInput.value)) {
		if (param.mapping) map[param.title || key] = param.mapping;
	}
	return map;
});

const outputMappingMap = computed(() => {
	const map: Record<string, string> = {};
	for (const [key, param] of Object.entries(localOutput.value)) {
		if (param.mapping) map[param.title || key] = param.mapping;
	}
	return map;
});

const hasParamChanges = computed(() =>
	JSON.stringify(localInput.value) !== JSON.stringify(originalInput.value)
	|| JSON.stringify(localOutput.value) !== JSON.stringify(originalOutput.value),
);

const hasAccessChanges = computed(() => {
	const origIps = testConfig.value?.allowed_ips ?? null;
	const origOrigins = testConfig.value?.allowed_origins ?? null;
	const newIps = localAllowedIps.value.length ? localAllowedIps.value : null;
	const newOrigins = localAllowedOrigins.value.length ? localAllowedOrigins.value : null;
	return JSON.stringify(newIps) !== JSON.stringify(origIps)
		|| JSON.stringify(newOrigins) !== JSON.stringify(origOrigins);
});

const hasChanges = computed(() => hasCalcEdits.value || hasParamChanges.value || hasAccessChanges.value);

// Unsaved changes navigation guard
const { showDialog: showUnsavedDialog, confirmLeave, cancelLeave } = useUnsavedGuard(hasChanges);

// IP validation: IPv4 with optional CIDR, or IPv6 (must contain : and be 3+ chars)
const IP_V4_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const IP_V6_RE = /^([0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}(\/\d{1,3})?$/;
function isValidIp(val: string): boolean {
	if (IP_V4_RE.test(val)) {
		// Validate each octet is 0-255
		const octets = val.split('/')[0].split('.');
		return octets.every((o) => Number(o) <= 255);
	}
	return IP_V6_RE.test(val);
}

// Origin validation: http(s)://, optional wildcard subdomain, domain, optional port
const ORIGIN_RE = /^https?:\/\/(\*\.)?[a-zA-Z0-9][-a-zA-Z0-9.]*(:\d+)?\/?$/;
function isValidOrigin(val: string): boolean {
	return ORIGIN_RE.test(val);
}

function addIp() {
	const val = newIp.value.trim();
	if (!val) return;
	if (!isValidIp(val)) { ipError.value = 'Invalid IP address'; return; }
	if (localAllowedIps.value.includes(val)) { ipError.value = 'Duplicate'; return; }
	ipError.value = '';
	localAllowedIps.value.push(val);
	newIp.value = '';
}

function addOrigin() {
	const val = newOrigin.value.trim();
	if (!val) return;
	if (!isValidOrigin(val)) { originError.value = 'Must start with http:// or https://'; return; }
	if (localAllowedOrigins.value.includes(val)) { originError.value = 'Duplicate'; return; }
	originError.value = '';
	localAllowedOrigins.value.push(val);
	newOrigin.value = '';
}

async function addMyIp() {
	loadingMyIp.value = true;
	ipError.value = '';
	try {
		const { data } = await api.get('/calc/my-ip');
		const ip = data?.ip;
		if (!ip) { ipError.value = 'Could not detect IP'; return; }
		if (localAllowedIps.value.includes(ip)) { ipError.value = 'Already added'; return; }
		localAllowedIps.value.push(ip);
	} catch {
		ipError.value = 'Could not detect IP';
	} finally {
		loadingMyIp.value = false;
	}
}
const canSave = computed(() => hasChanges.value);
const canTest = computed(() => hasConfigured.value && !hasChanges.value);

function resetChanges() {
	edits.value = {};
	localInput.value = extractParams<InputParameter>(testConfig.value?.input as Record<string, unknown> | null);
	localOutput.value = extractParams<OutputParameter>(testConfig.value?.output as Record<string, unknown> | null);
	localAllowedIps.value = [...(testConfig.value?.allowed_ips || [])];
	localAllowedOrigins.value = [...(testConfig.value?.allowed_origins || [])];
}

function exampleValue(type: string, defaultVal?: unknown): unknown {
	if (defaultVal !== undefined && defaultVal !== null) return defaultVal;
	switch (type) {
		case 'number': return 0;
		case 'integer': return 42;
		case 'string': return 'text';
		case 'boolean': return true;
		case 'date': return '2026-03-03';
		case 'time': return '14:30:00';
		case 'datetime': return '2026-03-03T14:30:00';
		case 'percentage': return 50;
		default: return 'text';
	}
}

const previewJson = computed(() => {
	const params = activeTab.value === 'input' ? localInput.value : localOutput.value;
	if (!params || Object.keys(params).length === 0) return null;

	const example: Record<string, unknown> = {};
	for (const [key, param] of Object.entries(params)) {
		if (param.type === 'array' && 'items' in param && (param as OutputParameter).items?.properties) {
			const itemExample: Record<string, unknown> = {};
			for (const [sk, sv] of Object.entries((param as OutputParameter).items!.properties)) {
				itemExample[sk] = exampleValue(sv.type, sv.default);
			}
			example[key] = [itemExample];
		} else {
			example[key] = exampleValue(param.type, param.default);
		}
	}

	return JSON.stringify(example, null, 2);
});

async function handleSave() {
	if (!currentId.value) return;

	// Validate params before saving
	const inputErrs = validateInputParams(localInput.value);
	const outputErrs = validateOutputParams(localOutput.value);
	const allErrors = [...inputErrs, ...outputErrs];
	if (allErrors.length > 0) {
		validationErrors.value = allErrors;
		return;
	}
	validationErrors.value = [];

	// Save calculator fields (name, description) if changed
	if (hasCalcEdits.value) {
		await update(currentId.value, edits.value);
		edits.value = {};
	}

	// Save parameter or access control changes
	const accessChanged = hasAccessChanges.value;
	const newAllowedIps = localAllowedIps.value.length ? localAllowedIps.value : null;
	const newAllowedOrigins = localAllowedOrigins.value.length ? localAllowedOrigins.value : null;
	if (hasParamChanges.value || accessChanged) {
		const configPayload: Partial<CalculatorConfig> = {};

		// Access control — always include when saving config
		configPayload.allowed_ips = newAllowedIps;
		configPayload.allowed_origins = newAllowedOrigins;

		if (hasParamChanges.value) {
			const inputResult: Record<string, InputParameter> = {};
			for (const [key, param] of Object.entries(localInput.value)) {
				inputResult[key] = toSchemaParam(generateOneOf(param, testConfig.value?.sheets || null));
			}

			const outputResult: Record<string, OutputParameter> = {};
			for (const [key, param] of Object.entries(localOutput.value)) {
				const converted = toSchemaParam(param);
				if (converted.items?.properties) {
					const subProps: Record<string, OutputArrayItem> = {};
					for (const [sk, sv] of Object.entries(converted.items.properties)) {
						subProps[sk] = toSchemaParam(sv);
					}
					converted.items = { ...converted.items, properties: subProps };
				}
				outputResult[key] = converted;
			}

			const sortedInput = Object.entries(inputResult).sort(([, a], [, b]) => (a.order ?? 999) - (b.order ?? 999));
			const requiredKeys = sortedInput.filter(([_, p]) => p.required).map(([k]) => k);
			const inputOrder = sortedInput.map(([k]) => k);
			const input = wrapParams(inputResult, { required: requiredKeys, order: inputOrder });

			const sortedOutput = Object.entries(outputResult).sort(([, a], [, b]) => (a.order ?? 999) - (b.order ?? 999));
			const outputOrder = sortedOutput.map(([k]) => k);
			const output = wrapParams(outputResult, { order: outputOrder });

			// Validate schemas before saving
			const inputErrors = validateSchema(input as Record<string, unknown>);
			const outputErrors = validateSchema(output as Record<string, unknown>);
			if (inputErrors.length || outputErrors.length) {
				const msgs = [...inputErrors.map((e) => `Input: ${e}`), ...outputErrors.map((e) => `Output: ${e}`)];
				console.error('Schema validation failed:', msgs);
				return;
			}

			const prodConfig = current.value?.configs?.find((c) => !c.test_environment);
			const prodCv = prodConfig?.config_version ? Number(prodConfig.config_version) : 0;
			const config_version = prodCv + 1;

			configPayload.input = input as any;
			configPayload.output = output as any;
			configPayload.config_version = String(config_version);
		}

		if (testConfig.value) {
			await updateConfig(testConfig.value.id, currentId.value, configPayload);
		} else {
			await createConfig(currentId.value, { ...configPayload, test_environment: true });
		}

		// Always sync allowlist to Formula API after config save
		const calcId = `${currentId.value}-test`;
		try {
			await api.patch(`/calc/access/${calcId}`);
		} catch {
			// Ignore — calculator may not be deployed yet
		}
	}
}


watch(currentId, (id) => {
	edits.value = {};
	if (id) fetchOne(id);
}, { immediate: true });

// Clear validation errors when params change
watch([localInput, localOutput], () => {
	if (validationErrors.value.length > 0) validationErrors.value = [];
}, { deep: true });

// Initialize local state when data loads
watch(testConfig, () => {
	localInput.value = extractParams<InputParameter>(testConfig.value?.input as Record<string, unknown> | null);
	localOutput.value = extractParams<OutputParameter>(testConfig.value?.output as Record<string, unknown> | null);
	localAllowedIps.value = [...(testConfig.value?.allowed_ips || [])];
	localAllowedOrigins.value = [...(testConfig.value?.allowed_origins || [])];
}, { immediate: true });
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.configure-content {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
	max-width: 960px;
}

/* Name / ID / Description header */
.detail-header {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 20px;
	margin-bottom: 32px;
}

.detail-header .field-full {
	grid-column: 1 / -1;
}


.field-label {
	margin-bottom: 8px;
	font-weight: 600;
	font-size: 14px;
	color: var(--theme--foreground-subdued);
}

.field-hint {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

/* Tabs */
.tabs-bar {
	display: flex;
	gap: 0;
	border-bottom: 2px solid var(--theme--border-color);
	margin-bottom: 0;
}

.tab-btn {
	padding: 10px 20px;
	font-size: 14px;
	font-weight: 600;
	background: none;
	border: none;
	border-bottom: 2px solid transparent;
	margin-bottom: -2px;
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	transition: color 0.15s, border-color 0.15s;
}

.tab-btn:hover:not(:disabled) {
	color: var(--theme--foreground);
}

.tab-btn.active {
	color: var(--theme--primary);
	border-bottom-color: var(--theme--primary);
}

.tab-btn:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}

.tab-content {
	margin-top: 0;
}

.tabs-hint {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 16px 0;
	font-size: 13px;
	color: var(--theme--foreground-subdued);
}

.module-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}

.sidebar-info {
	padding: 12px;
}

.sidebar-info p {
	margin: 0;
	line-height: 1.6;
}

/* API Preview */
.api-preview {
	margin-top: 24px;
	padding-top: 24px;
	border-top: var(--theme--border-width) solid var(--theme--border-color);
}

.preview-header {
	display: flex;
	align-items: center;
	gap: 8px;
	font-weight: 600;
	font-size: 14px;
	margin-bottom: 4px;
}

.preview-desc {
	margin: 0 0 12px;
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	line-height: 1.5;
}

.api-preview :deep(.code-block) {
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
}

/* Access Control */
.access-control {
	margin-top: 24px;
	padding-top: 24px;
	border-top: var(--theme--border-width) solid var(--theme--border-color);
}

.section-header {
	display: flex;
	align-items: center;
	gap: 8px;
	font-weight: 600;
	font-size: 14px;
	margin-bottom: 4px;
}

.section-desc {
	margin: 0 0 16px;
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	line-height: 1.5;
}

.access-control .field {
	margin-bottom: 16px;
}

.tag-input {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.tag-list {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.field-label-row {
	display: flex;
	justify-content: space-between;
	align-items: baseline;
	margin-bottom: 8px;
}

.field-label-row .field-label {
	margin-bottom: 0;
}

.link-btn {
	background: none;
	border: none;
	padding: 0;
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--primary);
	cursor: pointer;
}

.link-btn:hover:not(:disabled) {
	text-decoration: underline;
}

.link-btn:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

.access-chip {
	--v-chip-background-color: var(--theme--background-normal);
	--v-chip-color: var(--theme--foreground);
	--v-chip-close-color: var(--theme--foreground-subdued);
}

.tag-error {
	font-size: 12px;
	color: var(--theme--danger);
}

.validation-errors {
	display: flex;
	gap: 8px;
	padding: 12px 16px;
	margin-top: 16px;
	background: var(--theme--danger-background);
	color: var(--theme--danger);
	border-radius: var(--theme--border-radius);
	font-size: 14px;
	line-height: 1.6;
}

.validation-errors .v-icon {
	flex-shrink: 0;
	margin-top: 2px;
}

.validation-error-item strong {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
}
</style>
