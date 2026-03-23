<template>
	<div class="calculator-detail">
		<!-- Onboarding: shown when no Excel uploaded yet -->
		<div v-if="!hasStarted" class="onboarding">
			<!-- Step 1: Name your calculator -->
			<div class="onboarding-step" :class="{ completed: step1Complete }">
				<div class="step-number">
					<v-icon v-if="step1Complete" name="check" small />
					<span v-else>1</span>
				</div>
				<div class="step-body">
					<div class="step-title">Name your calculator</div>
					<p class="step-desc">Give it a unique name and identifier. The identifier is used in API calls and cannot be changed later.</p>
					<template v-if="!step1Complete">
						<div class="setup-fields">
							<div class="setup-field">
								<label class="field-label">Name</label>
								<v-input
									:model-value="edits.name ?? calculator.name ?? ''"
									placeholder="e.g. Mortgage Calculator"
									@update:model-value="handleNameChange"
								/>
							</div>
							<div class="setup-field">
								<label class="field-label">Identifier</label>
								<v-input
									:model-value="edits.id ?? (isUuid(calculator.id) ? '' : calculator.id) ?? ''"
									placeholder="auto-generated-from-name"
									monospace
									@update:model-value="handleIdChange"
								/>
								<div class="id-feedback-row">
									<span v-if="idChanged && idAvailable" class="id-feedback available">
										<v-icon name="check_circle" x-small />
										Available
									</span>
									<span v-else-if="idChanged && !idAvailable" class="id-feedback taken">
										<v-icon name="error" x-small />
										Already taken
									</span>
									<span v-else class="field-hint">Auto-generated from name. Used in API endpoints.</span>
								</div>
							</div>
							<div class="setup-field">
								<label class="field-label">Description</label>
								<v-textarea
									:model-value="edits.description ?? calculator.description ?? ''"
									placeholder="What does this calculator do?"
									@update:model-value="(v: string) => edits.description = v || null"
								/>
							</div>
						</div>
						<v-button
							:disabled="!canSaveSetup"
							:loading="loading"
							@click="handleSaveSetup"
						>
							Save
						</v-button>
					</template>
				</div>
			</div>

			<!-- Step 2: Upload Excel or pick template -->
			<div class="onboarding-step" :class="{ disabled: !step1Complete, completed: step2Complete }">
				<div class="step-number">
					<v-icon v-if="step2Complete" name="check" small />
					<span v-else>2</span>
				</div>
				<div class="step-body">
					<div class="step-title">Upload Excel workbook</div>
					<p class="step-desc">Upload the Excel file containing your calculation logic.</p>
					<template v-if="step1Complete && !step2Complete">
						<div
							class="excel-file-display clickable"
							:class="{ 'drag-over': dragging }"
							@click="$emit('select-file')"
							@dragenter="onDragEnter"
							@dragleave="onDragLeave"
							@dragover="onDragOver"
							@drop="onDrop"
						>
							<v-icon name="upload_file" class="drop-icon" />
							<span v-if="pendingFileName" class="file-name">{{ pendingFileName }}</span>
							<span v-else class="muted">Drop Excel file here or click to browse (.xlsx, .xls)</span>
						</div>
						<div class="excel-actions">
							<v-button
								:disabled="!pendingFileName"
								:loading="loading"
								@click="$emit('upload-file')"
							>
								Upload
							</v-button>
						</div>

						<template v-if="templates.length > 0">
							<div class="template-divider">
								<span class="template-divider-line" />
								<span class="template-divider-text">or start from a template</span>
								<span class="template-divider-line" />
							</div>
							<div class="template-grid">
								<div
									v-for="tmpl in templates"
									:key="tmpl.id"
									class="template-card"
									@click="$emit('apply-template', tmpl)"
								>
									<v-icon :name="tmpl.icon || 'calculate'" class="template-icon" />
									<div class="template-name">{{ tmpl.name }}</div>
									<div v-if="tmpl.description" class="template-desc">{{ tmpl.description }}</div>
								</div>
							</div>
						</template>
					</template>
				</div>
			</div>

			<!-- Step 3: Input parameters -->
			<div class="onboarding-step" :class="{ disabled: !step2Complete, completed: (hasInputSaved || hasConfig) && !editingInput }">
				<div class="step-number">
					<v-icon v-if="(hasInputSaved || hasConfig) && !editingInput" name="check" small />
					<span v-else>3</span>
				</div>
				<div class="step-body">
					<div class="step-title">
						Input parameters
						<a v-if="(hasInputSaved || hasConfig) && !editingInput" class="edit-link" @click="editingInput = true">Edit</a>
					</div>
					<p class="step-desc">Click the pick button to select Excel cells that accept input values. Each cell becomes an API parameter.</p>
					<template v-if="step2Complete && ((!hasInputSaved && !hasConfig) || editingInput)">
						<input-parameters
							:model-value="localInput"
							:sheets="testConfig?.sheets || null"
							compact
							@update:model-value="localInput = $event"
						/>
						<v-button
							:disabled="!hasInputDefined"
							:loading="loading"
							@click="handleSaveInput"
						>
							Save Input Parameters
						</v-button>
					</template>
				</div>
			</div>

			<!-- Step 4: Output parameters -->
			<div class="onboarding-step" :class="{ disabled: !hasInputSaved, completed: hasOutputSaved && !editingOutput }">
				<div class="step-number">
					<v-icon v-if="hasOutputSaved && !editingOutput" name="check" small />
					<span v-else>4</span>
				</div>
				<div class="step-body">
					<div class="step-title">
						Output parameters
						<a v-if="hasOutputSaved && !editingOutput" class="edit-link" @click="editingOutput = true">Edit</a>
					</div>
					<p class="step-desc">Click the pick button to select Excel cells that return calculated results.</p>
					<template v-if="hasInputSaved && (!hasOutputSaved || editingOutput)">
						<output-parameters
							:model-value="localOutput"
							:sheets="testConfig?.sheets || null"
							compact
							@update:model-value="localOutput = $event"
						/>
						<v-button
							:disabled="!hasOutputDefined"
							:loading="loading"
							@click="handleSaveConfig"
						>
							Save Output Parameters
						</v-button>
					</template>
				</div>
			</div>

			<!-- Step 5: Test & Launch -->
			<div class="onboarding-step" :class="{ disabled: !hasOutputSaved, completed: calculator.activated }">
				<div class="step-number">
					<v-icon v-if="calculator.activated" name="check" small />
					<span v-else>5</span>
				</div>
				<div class="step-body">
					<div class="step-title">Test your calculator</div>
					<p class="step-desc">Fill in test values, run a test, then launch to go live.</p>
					<template v-if="hasOutputSaved">
						<div class="test-grid">
							<div class="test-inputs">
								<div v-for="param in testInputParams" :key="param.key" class="test-field">
									<label class="field-label">{{ param.title || param.key }}</label>
									<v-input
										:model-value="inlineInputValues[param.key] ?? param.default ?? ''"
										:type="(param.type === 'number' || param.type === 'integer' || param.type === 'percentage') ? 'number' : 'text'"
										:placeholder="param.key"
										@update:model-value="inlineInputValues[param.key] = $event"
									/>
								</div>
								<div class="step-actions">
									<v-button :loading="testRunning" @click="handleRunTest">
										<v-icon name="play_arrow" left />
										Run Test
									</v-button>
									<v-button :disabled="!testResult" :loading="loading" @click="$emit('launch')">
										<v-icon name="rocket_launch" left />
										Launch
									</v-button>
								</div>
							</div>
							<div class="test-results">
								<label class="field-label">Results</label>
								<template v-if="testError">
									<v-notice type="danger">{{ testError }}</v-notice>
								</template>
								<template v-else-if="testOutputRows.length > 0">
									<table class="result-table">
										<tr v-for="row in testOutputRows" :key="row.key">
											<td class="result-label">{{ row.label }}</td>
											<td class="result-value">{{ row.value }}</td>
										</tr>
									</table>
								</template>
								<template v-else>
									<div class="result-placeholder">Results will appear here</div>
								</template>
							</div>
						</div>
					</template>
				</div>
			</div>

			<!-- Step 6: Go Live -->
			<div class="onboarding-step" :class="{ disabled: !calculator.activated, completed: calculator.activated }">
				<div class="step-number">
					<v-icon v-if="calculator.activated" name="check" small />
					<span v-else>6</span>
				</div>
				<div class="step-body">
					<div class="step-title">Go Live</div>
					<p class="step-desc">Your calculator is live. Use these code examples to integrate it.</p>
					<template v-if="calculator.activated">
						<v-notice v-if="liveTestError" type="danger">Live test failed: {{ liveTestError }}</v-notice>
						<v-notice v-else type="success">Your calculator has been published and is accepting API calls.</v-notice>

						<code-examples :snippet-params="snippetParams" />

						<p class="code-section-hint">See the <a class="link" @click="router.push(`/calculators/${calculator.id}/integration`)">Integration page</a> for more languages and examples.</p>

						<div class="step-actions">
							<v-button @click="$emit('complete-onboarding')">
								Continue to dashboard
								<v-icon name="arrow_forward" right />
							</v-button>
						</div>
					</template>
				</div>
			</div>
		</div>

		<!-- Normal layout: shown once Excel exists -->
		<template v-else>
			<!-- Over-limit warning — page top -->
			<v-notice v-if="calculator.activated && calculator.over_limit" type="warning" class="overlimit-notice">
				<div class="overlimit-content">
					<span v-if="activationExpired">Over plan limit — this calculator is being deactivated. Upgrade your plan or deactivate another calculator.</span>
					<span v-else>Over plan limit — deactivating in {{ countdownText(calculator.activation_expires_at) }}. Upgrade your plan or deactivate another calculator.</span>
					<v-button class="overlimit-btn" small @click="liveCardRef?.openUpgradeDialog()">
						<v-icon name="upgrade" left />
						Upgrade plan
					</v-button>
				</div>
			</v-notice>

			<!-- Unsupported functions warning -->
			<v-notice v-if="unresolvedFunctions?.length" type="warning" class="unresolved-notice">
				Unsupported Excel functions: {{ unresolvedFunctions.map((f: any) => f.name).join(', ') }}.
				These may cause #NAME? errors in calculations.
			</v-notice>

			<!-- Usage Stats -->
			<calculator-stats :calculator-id="calculator.id" :activated="calculator.activated" />

			<!-- Excel Document Section -->
			<div class="excel-section">
				<div class="section-header">
					<h2 class="section-title">Update calculator</h2>
					<p class="section-desc">Upload a new Excel workbook to create a new test version you can configure and test before going live.</p>
				</div>

				<div
					class="excel-file-display clickable"
					:class="{ 'drag-over': dragging }"
					@click="$emit('select-file')"
					@dragenter="onDragEnter"
					@dragleave="onDragLeave"
					@dragover="onDragOver"
					@drop="onDrop"
				>
					<v-icon name="upload_file" class="drop-icon" />
					<span v-if="pendingFileName" class="file-name">{{ pendingFileName }}</span>
					<span v-else class="muted">Drop Excel file here or click to browse (.xlsx, .xls)</span>
				</div>

				<div class="excel-actions">
					<v-button
						:disabled="!pendingFileName"
						:loading="loading"
						@click="$emit('upload-file')"
					>
						Upload
					</v-button>
					<span v-if="uploadedFileName" class="upload-message">Excel uploaded. Next, configure input and output parameters.</span>
				</div>
			</div>

			<!-- Test Version Section -->
			<config-card
				:config="testConfig"
				label="Test"
				title="Test version"
				subtitle="Configure and test your calculator before launching a new live version."
				:editable="true"
				:loading="loading"
				:config-changed="configChanged"
				:can-launch="canLaunch"
				:calculator-id="calculator.id"
				:test-enabled="!!calculator.test_enabled_at"
				:test-expires-at="calculator.test_expires_at"
				@launch="$emit('launch')"
				@configure="navigateToConfigure"
				@test="navigateToTest"
				@regenerate-api-key="$emit('regenerate-api-key', 'test')"
				@enable-test="$emit('enable-test')"
				@disable-test="$emit('disable-test')"
				@download="$emit('download-excel', testConfig!.id, `${calculator.id}-test-v${versionKey(testConfig)}.xlsx`)"
			/>

			<!-- Live Version Section -->
			<config-card
				ref="liveCardRef"
				:config="prodConfig"
				label="Live"
				title="Live version"
				:subtitle="prodSubtitle"
				:editable="false"
				:loading="loading"
				:config-changed="false"
				:can-launch="false"
				:activated="calculator.activated || false"
				:calculator-id="calculator.id"
				:over-limit="calculator.over_limit || false"
				:activation-expires-at="calculator.activation_expires_at"
				:action-error="actionError"
				@activate="$emit('activate')"
				@deactivate="$emit('deactivate')"
				@regenerate-api-key="$emit('regenerate-api-key', 'prod')"
				@download="$emit('download-excel', prodConfig!.id, `${calculator.id}-live-v${versionKey(prodConfig)}.xlsx`)"
			/>
		</template>
	</div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Calculator, CalculatorConfig, CalculatorTemplate, DirectusFile, InputParameter, OutputParameter, OutputArrayItem } from '../types';
import { extractParams, toSchemaParam, generateOneOf, wrapParams, formatValue } from '../utils/param-transforms';
import type { SnippetParams } from '../utils/code-snippets';
import ConfigCard from './config-card.vue';
import CodeExamples from './code-examples.vue';
import CalculatorStats from './calculator-stats.vue';
import InputParameters from './input-parameters.vue';
import OutputParameters from './output-parameters.vue';

const props = defineProps<{
	calculator: Calculator;
	calculators: Calculator[];
	templates: CalculatorTemplate[];
	hasConfig: boolean;
	loading: boolean;
	pendingFileName: string | null;
	uploadedFileName: string | null;
	testResult: unknown;
	testError: string | null;
	testRunning: boolean;
	formulaApiUrl: string | null;
	liveTestResult: unknown;
	liveTestError: string | null;
	actionError?: string | null;
}>();

const emit = defineEmits<{
	'select-file': [];
	'upload-file': [];
	'drop-file': [file: File];
	'update-calculator': [edits: Partial<Calculator>];
	'save-config': [payload: { input: Record<string, unknown>; output: Record<string, unknown> }];
	'run-test': [payload: Record<string, unknown>];
	'apply-template': [template: CalculatorTemplate];
	launch: [];
	'complete-onboarding': [];
	activate: [];
	deactivate: [];
	'regenerate-api-key': [env: string];
	'enable-test': [];
	'disable-test': [];
	'download-excel': [configId: string, filename: string];
}>();

const route = useRoute();
const router = useRouter();

const liveCardRef = ref<InstanceType<typeof ConfigCard> | null>(null);
const dragging = ref(false);
let dragCounter = 0;

function onDragEnter(e: DragEvent) {
	e.preventDefault();
	dragCounter++;
	dragging.value = true;
}
function onDragLeave() {
	dragCounter--;
	if (dragCounter <= 0) { dragCounter = 0; dragging.value = false; }
}
function onDragOver(e: DragEvent) { e.preventDefault(); }
function onDrop(e: DragEvent) {
	e.preventDefault();
	dragCounter = 0;
	dragging.value = false;
	const file = e.dataTransfer?.files?.[0];
	if (file && /\.xlsx?$/i.test(file.name)) emit('drop-file', file);
}

// Reactive tick for countdown (30s)
const countdownTick = ref(0);
let tickInterval: ReturnType<typeof setInterval> | null = null;
onMounted(() => { tickInterval = setInterval(() => { countdownTick.value++; }, 30_000); });
onBeforeUnmount(() => { if (tickInterval) clearInterval(tickInterval); });

const activationExpired = computed(() => {
	void countdownTick.value;
	if (!props.calculator.activation_expires_at) return false;
	return new Date(props.calculator.activation_expires_at).getTime() <= Date.now();
});

function countdownText(expiresAt: string | null | undefined): string {
	void countdownTick.value;
	if (!expiresAt) return '';
	const ms = new Date(expiresAt).getTime() - Date.now();
	if (ms <= 0) return '(expired)';
	const h = Math.floor(ms / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

function navigateToConfigure() {
	router.push(`/calculators/${route.params.id}/configure`);
}

function navigateToTest() {
	router.push(`/calculators/${route.params.id}/test`);
}

// --- Onboarding state ---
const edits = reactive<Partial<Calculator>>({});
const idManuallyEdited = ref(false);

function isUuid(id: string | null | undefined): boolean {
	if (!id) return false;
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function slugify(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, '')
		.replace(/[\s_]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function handleNameChange(value: string) {
	edits.name = value || null;
	if (!idManuallyEdited.value) {
		edits.id = slugify(value);
	}
}

function handleIdChange(value: string | null) {
	if (!value || !slugify(value)) {
		idManuallyEdited.value = false;
		edits.id = slugify((edits.name ?? props.calculator.name) || '');
		return;
	}
	idManuallyEdited.value = true;
	edits.id = slugify(value);
}

const hasName = computed(() => {
	const name = edits.name ?? props.calculator.name;
	return !!(name && name.trim());
});

const idChanged = computed(() => {
	const id = edits.id ?? props.calculator.id;
	return id !== props.calculator.id;
});

const idAvailable = computed(() => {
	const id = edits.id ?? props.calculator.id;
	return !props.calculators.some((c) => c.id === id && c.id !== props.calculator.id);
});

const canSaveSetup = computed(() => {
	if (!hasName.value) return false;
	const id = edits.id;
	if (!id) return false;
	if (!idAvailable.value) return false;
	return true;
});

const step1Complete = computed(() => {
	const name = props.calculator.name;
	return !!(name && name.trim());
});

const configHasAllData = computed(() => {
	if (!testConfig.value) return false;
	return !!(testConfig.value.sheets && testConfig.value.input && testConfig.value.output);
});

const step2Complete = computed(() => !!excelFileId.value || configHasAllData.value);

function handleSaveSetup() {
	if (!canSaveSetup.value) return;
	const payload: Partial<Calculator> = {};
	if (edits.name !== undefined) payload.name = edits.name;
	if (edits.id !== undefined) payload.id = edits.id;
	if (edits.description !== undefined) payload.description = edits.description;
	if (edits.icon !== undefined) payload.icon = edits.icon;
	emit('update-calculator', payload);
	edits.name = undefined as any;
	edits.id = undefined as any;
	edits.description = undefined as any;
	edits.icon = undefined as any;
	idManuallyEdited.value = false;
}

// --- Re-editable state ---
const editingInput = ref(false);
const editingOutput = ref(false);

// --- Inline config (step 3) ---
const localInput = ref<Record<string, InputParameter>>({});
const localOutput = ref<Record<string, OutputParameter>>({});

const hasInputDefined = computed(() => Object.keys(localInput.value).length > 0);
const hasOutputDefined = computed(() => Object.keys(localOutput.value).length > 0);

const hasInputSaved = computed(() => {
	const input = testConfig.value?.input as Record<string, unknown> | null;
	if (!input) return false;
	return Object.keys(extractParams(input)).length > 0;
});

const hasOutputSaved = computed(() => {
	const output = testConfig.value?.output as Record<string, unknown> | null;
	if (!output) return false;
	return Object.keys(extractParams(output)).length > 0;
});

// --- Inline test state ---
const inlineInputValues = ref<Record<string, unknown>>({});

const testInputParams = computed(() => {
	if (!testConfig.value?.input) return [];
	const raw = testConfig.value.input as any;
	const paramProps = raw?.properties || raw;
	if (!paramProps || typeof paramProps !== 'object') return [];
	return Object.entries(paramProps).map(([key, param]: [string, any]) => ({
		key,
		...param,
	}));
});

const testOutputRows = computed(() => {
	if (!props.testResult || !testConfig.value?.output) return [];
	const raw = testConfig.value.output as any;
	const paramProps = raw?.properties || raw;
	if (!paramProps || typeof paramProps !== 'object') return [];
	const data = props.testResult as Record<string, unknown>;
	return Object.entries(paramProps).map(([key, param]: [string, any]) => ({
		key,
		label: param.title || key,
		value: data[key] != null ? formatValue(data[key]) : '—',
	}));
});

const sampleBody = computed(() => {
	if (!testConfig.value?.input) return undefined;
	const raw = testConfig.value.input as any;
	const paramProps = raw?.properties || raw;
	if (!paramProps || typeof paramProps !== 'object') return undefined;
	const body: Record<string, unknown> = {};
	for (const [key, param] of Object.entries(paramProps) as [string, any][]) {
		if (param.default != null) body[key] = param.default;
		else if (param.type === 'number' || param.type === 'integer' || param.type === 'percentage') body[key] = 0;
		else if (param.type === 'boolean') body[key] = false;
		else body[key] = '';
	}
	return Object.keys(body).length > 0 ? body : undefined;
});

const snippetParams = computed<SnippetParams>(() => ({
	baseUrl: props.formulaApiUrl || '',
	calculatorId: props.calculator.id,
	apiKey: prodConfig.value?.api_key || 'YOUR_API_KEY',
	sampleBody: sampleBody.value,
}));

function handleRunTest() {
	emit('run-test', { ...inlineInputValues.value });
}

function buildInputSchema(inputResult: Record<string, InputParameter>) {
	const sorted = Object.entries(inputResult).sort(([, a], [, b]) => (a.order ?? 999) - (b.order ?? 999));
	return wrapParams(inputResult, {
		required: sorted.filter(([_, p]) => p.required).map(([k]) => k),
		order: sorted.map(([k]) => k),
	});
}

function buildOutputSchema(outputResult: Record<string, OutputParameter>) {
	const sorted = Object.entries(outputResult).sort(([, a], [, b]) => (a.order ?? 999) - (b.order ?? 999));
	return wrapParams(outputResult, { order: sorted.map(([k]) => k) });
}

function handleSaveInput() {
	const inputResult: Record<string, InputParameter> = {};
	for (const [key, param] of Object.entries(localInput.value)) {
		inputResult[key] = toSchemaParam(generateOneOf(param, testConfig.value?.sheets || null));
	}
	emit('save-config', {
		input: buildInputSchema(inputResult),
		output: wrapParams({}),
	});
	editingInput.value = false;
}

function handleSaveConfig() {
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

	emit('save-config', {
		input: buildInputSchema(inputResult),
		output: buildOutputSchema(outputResult),
	});
	editingInput.value = false;
	editingOutput.value = false;
}

// --- Config computeds ---
const configs = computed(() => props.calculator.configs || []);
const testConfig = computed(() => configs.value.find((c) => c.test_environment) || null);
const prodConfig = computed(() => configs.value.find((c) => !c.test_environment) || null);

const unresolvedFunctions = computed(() =>
	testConfig.value?.unresolved_functions || prodConfig.value?.unresolved_functions || null,
);

const excelFileId = computed(() => {
	const file = testConfig.value?.excel_file;
	if (!file) return null;
	if (typeof file === 'object') return (file as DirectusFile).id;
	return file;
});

const hasStarted = computed(() => {
	if (props.calculator.onboarded) return true;
	// Backward compat: pre-existing calculators (onboarded===null) with excel + name skip onboarding
	if (props.calculator.onboarded === null && step1Complete.value && !!excelFileId.value) return true;
	return false;
});

function versionKey(cfg: CalculatorConfig | null): string {
	if (!cfg) return '';
	return `${cfg.config_version || '0'}.${cfg.file_version || 0}`;
}

const configChanged = computed(() => {
	if (!testConfig.value || !prodConfig.value) return false;
	return versionKey(testConfig.value) !== versionKey(prodConfig.value);
});

const canLaunch = computed(() => {
	if (!testConfig.value) return false;
	if (!prodConfig.value) return true;
	return versionKey(testConfig.value) !== versionKey(prodConfig.value);
});

const prodSubtitle = computed(() => {
	if (!prodConfig.value)
		return 'No live version yet. Launch a test version to go live.';
	if (props.calculator.activated)
		return 'Live and accepting API calls. Deactivate to temporarily remove from the API.';
	return 'Ready to go live. Click Activate to deploy to the Formula API.';
});

// Initialize inline config params from testConfig
watch(testConfig, () => {
	localInput.value = extractParams<InputParameter>(testConfig.value?.input as Record<string, unknown> | null);
	localOutput.value = extractParams<OutputParameter>(testConfig.value?.output as Record<string, unknown> | null);

	// Pre-fill test inputs with defaults
	const defaults: Record<string, unknown> = {};
	for (const p of testInputParams.value) {
		if (p.default != null) defaults[p.key] = p.default;
	}
	inlineInputValues.value = defaults;
}, { immediate: true });
</script>

<style scoped>
.calculator-detail {
	padding: 0 var(--content-padding) var(--content-padding);
	max-width: 960px;
}

/* Onboarding */
.onboarding {
	display: flex;
	flex-direction: column;
	gap: 24px;
	padding: 12px 0;
}

.onboarding-step {
	display: flex;
	gap: 16px;
	align-items: flex-start;
}

.onboarding-step.disabled {
	opacity: 0.45;
	pointer-events: none;
}

.onboarding-step.completed .step-body {
	color: var(--theme--foreground-subdued);
}

.step-number {
	width: 32px;
	height: 32px;
	border-radius: 50%;
	background: var(--theme--primary);
	color: #fff;
	font-weight: 700;
	font-size: 14px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
}

.onboarding-step.disabled .step-number {
	background: var(--theme--foreground-subdued);
}

.onboarding-step.completed .step-number {
	background: var(--theme--success);
}

.step-body {
	flex: 1;
	min-width: 0;
}

.step-title {
	font-weight: 700;
	font-size: 16px;
	margin-bottom: 4px;
}

.step-desc {
	margin: 0 0 12px;
	font-size: 14px;
	color: var(--theme--foreground-subdued);
}

.step-actions {
	display: flex;
	gap: 8px;
}

/* Setup fields */
.setup-fields {
	display: flex;
	flex-direction: column;
	gap: 12px;
	margin-bottom: 12px;
}

.setup-field {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.field-label {
	font-size: 14px;
	font-weight: 600;
}


.field-hint {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.id-feedback-row {
	margin-top: 4px;
	min-height: 18px;
}

.id-feedback {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	font-size: 12px;
	font-weight: 500;
}

.id-feedback.available {
	color: var(--theme--success);
}

.id-feedback.taken {
	color: var(--theme--danger);
}

/* Excel Section */
.excel-section {
	border-top: var(--theme--border-width) solid var(--theme--border-color);
	padding-top: 24px;
	margin-bottom: 24px;
}

.section-header {
	margin-bottom: 12px;
}

.section-title {
	margin: 0 0 4px;
	font-size: 18px;
	font-weight: 700;
}

.section-desc {
	margin: 0;
	font-size: 14px;
	color: var(--theme--foreground-subdued);
}

.excel-file-display {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 12px;
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
	margin-bottom: 12px;
}

.excel-file-display.clickable {
	cursor: pointer;
}

.excel-file-display.clickable:hover,
.excel-file-display.drag-over {
	border-color: var(--theme--primary);
	background: var(--theme--primary-background);
}

.drop-icon {
	--v-icon-color: var(--theme--foreground-subdued);
	flex-shrink: 0;
}

.file-name {
	font-size: 14px;
}

.upload-message {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
}

.excel-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	padding-bottom: 24px;
}

.muted {
	color: var(--theme--foreground-subdued);
	font-size: 14px;
}

/* Inline test */
.test-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 24px;
	align-items: stretch;
	margin-bottom: 12px;
}

.test-inputs {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.test-field {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.test-results {
	display: flex;
	flex-direction: column;
}

.result-table {
	width: 100%;
	border-collapse: collapse;
}

.result-table td {
	padding: 8px 12px;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color);
	font-size: 14px;
}

.result-label {
	font-weight: 600;
	color: var(--theme--foreground-subdued);
}

.result-value {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	text-align: right;
}

.result-placeholder {
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 24px;
	text-align: center;
	color: var(--theme--foreground-subdued);
	font-size: 14px;
	border: var(--theme--border-width) dashed var(--theme--border-color);
	border-radius: var(--theme--border-radius);
}

/* Edit link */
.edit-link {
	font-size: 13px;
	font-weight: 500;
	color: var(--theme--primary);
	cursor: pointer;
	margin-left: 8px;
}

.edit-link:hover {
	text-decoration: underline;
}

/* Template picker */
.template-divider {
	display: flex;
	align-items: center;
	gap: 12px;
	margin: 16px 0;
}

.template-divider-line {
	flex: 1;
	height: 1px;
	background: var(--theme--border-color);
}

.template-divider-text {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	white-space: nowrap;
}

.template-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
	gap: 12px;
}

.template-card {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6px;
	padding: 16px 12px;
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
	cursor: pointer;
	text-align: center;
	transition: border-color 0.15s;
}

.template-card:hover {
	border-color: var(--theme--primary);
}

.template-icon {
	--v-icon-color: var(--theme--primary);
	--v-icon-size: 28px;
}

.template-name {
	font-size: 14px;
	font-weight: 600;
}

.template-desc {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	line-height: 1.4;
}

.code-section-hint {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin: 20px 0 20px;
}

.link {
	color: var(--theme--primary);
	cursor: pointer;
}

.link:hover {
	text-decoration: underline;
}

.overlimit-notice {
	margin-bottom: 16px;
}

.unresolved-notice {
	margin-bottom: 16px;
}

.overlimit-content {
	display: flex;
	align-items: center;
	gap: 16px;
	width: 100%;
}

.overlimit-content span {
	flex: 1;
}

.overlimit-btn {
	flex-shrink: 0;
}
</style>
