<template>
	<private-view title="Formulas">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="functions" />
			</v-button>
		</template>

		<template #navigation>
			<formula-navigation current-view="test" />
		</template>

		<!-- Feature gate -->
		<div v-if="featureLoading" class="feature-gate-loading">
			<v-progress-circular indeterminate />
		</div>
		<div v-else-if="!featureAllowed" class="feature-gate-unavailable">
			<v-info icon="block" title="Feature Unavailable" center>
				Formula testing is not available for your account. Contact your administrator.
			</v-info>
		</div>
		<template v-else>
		<!-- No-token notice -->
		<div v-if="!hasToken && !tokenLoading" class="no-token-notice">
			<v-info icon="vpn_key" title="API Key Required" center>
				Create an API key in your Account settings to start using formulas.
				<template #append>
					<v-button secondary @click="$router.push('/account')">
						<v-icon name="manage_accounts" left />
						Go to Account
					</v-button>
				</template>
			</v-info>
		</div>

		<div v-else-if="tokenLoading" class="module-loading">
			<v-progress-circular indeterminate />
		</div>

		<div v-else class="formulas-content">
			<!-- Mode tabs (advanced only) -->
			<div v-if="advanced" class="mode-bar">
				<button class="tab-btn" :class="{ active: mode === 'single' }" @click="switchMode('single')">Single</button>
				<button class="tab-btn" :class="{ active: mode === 'batch' }" @click="switchMode('batch')">Batch</button>
				<button class="tab-btn" :class="{ active: mode === 'sheet' }" @click="switchMode('sheet')">Sheet</button>
			</div>

			<div v-if="advanced" class="mode-desc">
				<template v-if="mode === 'single'">Evaluate a single Excel formula. Use <code>data</code> for cell references like A1, B2.</template>
				<template v-else-if="mode === 'batch'">Evaluate multiple formulas in one request. All share the same data and locale.</template>
				<template v-else>Define formulas at specific cell addresses, like a real spreadsheet.</template>
			</div>

			<div v-if="!advanced" class="simple-desc">
				Enter an Excel formula or pick an example to test.
			</div>

			<div class="test-columns">
				<!-- Left: Input panel -->
				<div class="input-panel">
					<div class="panel-header">Input</div>

					<!-- Example selector -->
					<example-selector :examples="currentExamples" @select="loadExample" />

					<!-- Single mode (simple + advanced) -->
					<div v-if="mode === 'single'" class="input-fields">
						<div class="param-field">
							<div class="param-title">Formula <span class="required-mark">*</span></div>
							<v-input
								v-model="singleFormula"
								:placeholder="placeholderFormula"
								font="monospace"
							/>
						</div>
						<div v-if="advanced" class="param-field">
							<div class="param-title">Locale</div>
							<v-select
								v-model="locale"
								:items="LOCALES"
								placeholder="en (default)"
								:allow-none="true"
							/>
						</div>
						<div v-if="advanced || showDataField" class="param-field">
							<div class="param-title">Data</div>
							<v-textarea
								v-model="dataJson"
								placeholder='[[1, 2], [3, 4]]'
								font="monospace"
								:nullable="true"
							/>
							<div class="param-desc">Each inner array is a row: <code>[[1,2],[3,4]]</code> → A1=1, B1=2, A2=3, B2=4</div>
						</div>
					</div>

					<!-- Batch mode (advanced only) -->
					<div v-if="mode === 'batch'" class="input-fields">
						<div class="param-field">
							<div class="param-title">Formulas <span class="required-mark">*</span></div>
							<div v-for="(f, i) in batchFormulas" :key="i" class="list-row">
								<v-input
									:model-value="f"
									:placeholder="placeholderFormula"
									font="monospace"
									@update:model-value="batchFormulas[i] = $event"
								/>
								<button v-if="batchFormulas.length > 1" class="row-remove" @click="batchFormulas.splice(i, 1)">
									<v-icon name="close" small />
								</button>
							</div>
							<button class="add-row-btn" @click="batchFormulas.push('')">
								<v-icon name="add" small /> Add formula
							</button>
						</div>
						<div class="param-field">
							<div class="param-title">Locale</div>
							<v-select
								v-model="locale"
								:items="LOCALES"
								placeholder="en (default)"
								:allow-none="true"
							/>
						</div>
						<div class="param-field">
							<div class="param-title">Data</div>
							<v-textarea
								v-model="dataJson"
								placeholder='[[1, 2], [3, 4]]'
								font="monospace"
								:nullable="true"
							/>
							<div class="param-desc">Each inner array is a row: <code>[[1,2],[3,4]]</code> → A1=1, B1=2, A2=3, B2=4</div>
						</div>
					</div>

					<!-- Sheet mode (advanced only) -->
					<div v-if="mode === 'sheet'" class="input-fields">
						<div class="param-field">
							<div class="param-title">Data Mode</div>
							<v-select
								v-model="sheetDataMode"
								:items="[{ text: 'Single sheet (data)', value: 'data' }, { text: 'Multi-sheet (sheets)', value: 'sheets' }]"
							/>
						</div>
						<div class="param-field">
							<div class="param-title">{{ sheetDataMode === 'data' ? 'Data' : 'Sheets' }}</div>
							<v-textarea
								v-model="sheetDataJson"
								:placeholder="sheetDataPlaceholder"
								font="monospace"
								:nullable="true"
							/>
							<div class="param-desc">{{ sheetDataMode === 'data' ? 'Each inner array is a row: [[1,2],[3,4]] → A1=1, B1=2, A2=3, B2=4' : 'Object keyed by sheet name, each value is rows: {"Sheet1": [[1,2]], "Sheet2": [[3,4]]}' }}</div>
						</div>
						<div class="param-field">
							<div class="param-title">Formulas <span class="required-mark">*</span></div>
							<div v-for="(sf, i) in sheetFormulas" :key="i" class="list-row sheet-formula-row">
								<v-input
									:model-value="sf.cell"
									placeholder="A1"
									font="monospace"
									class="cell-input"
									@update:model-value="sheetFormulas[i] = { ...sf, cell: $event }"
								/>
								<v-input
									:model-value="sf.formula"
									:placeholder="placeholderSheet"
									font="monospace"
									class="formula-input"
									@update:model-value="sheetFormulas[i] = { ...sf, formula: $event }"
								/>
								<v-input
									v-if="sheetDataMode === 'sheets'"
									:model-value="sf.sheet"
									placeholder="Sheet1"
									class="sheet-input"
									@update:model-value="sheetFormulas[i] = { ...sf, sheet: $event }"
								/>
								<button v-if="sheetFormulas.length > 1" class="row-remove" @click="sheetFormulas.splice(i, 1)">
									<v-icon name="close" small />
								</button>
							</div>
							<button class="add-row-btn" @click="sheetFormulas.push({ cell: '', formula: '', sheet: '' })">
								<v-icon name="add" small /> Add formula
							</button>
						</div>
						<div class="param-field">
							<div class="param-title">Locale</div>
							<v-select
								v-model="locale"
								:items="LOCALES"
								placeholder="en (default)"
								:allow-none="true"
							/>
						</div>
					</div>
				</div>

				<!-- Right: Results panel -->
				<div class="result-panel">
					<div class="tabs-bar">
						<button class="tab-btn" :class="{ active: activeTab === 'request' }" @click="activeTab = 'request'">Request</button>
						<button class="tab-btn" :class="{ active: activeTab === 'response' }" @click="activeTab = 'response'">Response</button>
						<button class="tab-btn" :class="{ active: activeTab === 'result' }" @click="activeTab = 'result'">Result</button>
					</div>

					<div v-if="formulaError" class="error-box">{{ formulaError }}</div>

					<div class="tab-content">
						<div v-if="activeTab === 'request'">
							<pre v-if="requestPayload" class="json-box">{{ JSON.stringify(requestPayload, null, 2) }}</pre>
							<div v-else class="tab-empty">Execute a formula to see the request payload.</div>
						</div>

						<div v-if="activeTab === 'response'">
							<div v-if="statusCode" class="status-badge" :class="statusCode >= 200 && statusCode < 300 ? 'status-ok' : 'status-err'">
								{{ statusCode }}
							</div>
							<pre v-if="resultData" class="json-box">{{ JSON.stringify(resultData, null, 2) }}</pre>
							<div v-else-if="!formulaError" class="tab-empty">Execute a formula to see the response.</div>
						</div>

						<div v-if="activeTab === 'result'">
							<!-- Single result -->
							<div v-if="mode === 'single' && resultData && !formulaError">
								<table class="output-table">
									<thead>
										<tr>
											<th>Formula</th>
											<th>Result</th>
										</tr>
									</thead>
									<tbody>
										<tr v-if="resultData.result !== undefined">
											<td class="mono">{{ singleFormula }}</td>
											<td class="result-value">{{ resultData.result }}</td>
										</tr>
										<tr v-if="resultData.error">
											<td class="mono">{{ singleFormula }}</td>
											<td class="result-error">
												{{ resultData.error }}{{ resultData.detail ? ': ' + resultData.detail : '' }}
												<div v-if="resultData.unresolvedFunctions?.length" class="unresolved-hint">
													Unsupported functions: {{ resultData.unresolvedFunctions.join(', ') }}
												</div>
												<div v-else-if="resultData.type" class="unresolved-hint">
													#{{ resultData.type }}!
												</div>
											</td>
										</tr>
									</tbody>
								</table>
							</div>

							<!-- Batch result -->
							<div v-else-if="mode === 'batch' && resultData && Array.isArray(resultData.results)">
								<table class="output-table">
									<thead>
										<tr>
											<th>Formula</th>
											<th>Result</th>
										</tr>
									</thead>
									<tbody>
										<tr v-for="(r, i) in resultData.results" :key="i">
											<td class="mono">{{ batchFormulas[i] || `#${i + 1}` }}</td>
											<td :class="{ 'result-error': r.error }">
												{{ r.error ? r.error : r.result }}
												<span v-if="r.unresolvedFunctions?.length" class="unresolved-hint">
													({{ r.unresolvedFunctions.join(', ') }})
												</span>
												<span v-else-if="r.error && r.type" class="unresolved-hint">
													#{{ r.type }}!
												</span>
											</td>
										</tr>
									</tbody>
								</table>
							</div>

							<!-- Sheet result -->
							<div v-else-if="mode === 'sheet' && resultData && Array.isArray(resultData.results)">
								<table class="output-table">
									<thead>
										<tr>
											<th>Cell</th>
											<th>Formula</th>
											<th>Result</th>
										</tr>
									</thead>
									<tbody>
										<tr v-for="(sf, i) in sheetFormulas" :key="i">
											<td class="mono">{{ sf.cell }}</td>
											<td class="mono">{{ sf.formula }}</td>
											<td class="result-value">{{ getSheetCellValue(sf.cell, resultData.results) }}</td>
										</tr>
									</tbody>
								</table>
							</div>

							<!-- Error response -->
							<div v-else-if="resultData?.error" class="error-result">
								<div class="error-title">{{ resultData.error }}</div>
								<div v-if="resultData.detail" class="error-detail">{{ resultData.detail }}</div>
								<div v-if="resultData.unresolvedFunctions?.length" class="unresolved-hint">
									Unsupported functions: {{ resultData.unresolvedFunctions.join(', ') }}
								</div>
								<div v-else-if="resultData.type" class="unresolved-hint">
									#{{ resultData.type }}!
								</div>
							</div>

							<div v-else class="tab-empty">Execute a formula to see results.</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Bottom bar -->
			<div class="bottom-bar">
				<div class="advanced-toggle" @click="toggleAdvanced">
					<span class="advanced-label">Advanced</span>
					<div class="toggle-track" :class="{ on: advanced }">
						<div class="toggle-thumb" />
					</div>
				</div>
				<v-button
					:loading="executing"
					:disabled="!canExecute"
					@click="handleExecute"
				>
					<v-icon name="play_arrow" left />
					Calculate
				</v-button>
			</div>
		</div>

		</template>
		<template #sidebar>
			<sidebar-detail icon="help_outline" title="About Formulas" close>
				<div class="sidebar-info">
					<p>Evaluate Excel formulas via API. Single formulas, batches, or full spreadsheet models.</p>
					<p><strong>Features:</strong></p>
					<ul>
						<li>Cell references with data arrays</li>
						<li>16 locale formats (en, de, fr, …)</li>
						<li>Result caching</li>
						<li>Sheet-mode for multi-cell models</li>
					</ul>
					<p style="margin-top: 12px;">
						<strong>API Keys</strong> — managed in
						<a href="/admin/account" @click.prevent="$router.push('/account')">Account settings</a>.
					</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useFeatureGate } from '../../../project-extension-feature-gate/src/use-feature-gate';
import { useApi } from '@directus/extensions-sdk';
import { useFormulas } from '../composables/use-formulas';
import FormulaNavigation from '../components/navigation.vue';
import ExampleSelector from '../components/example-selector.vue';
import type { FormulaExample } from '../types';
import type { SheetFormula } from '../types';

const api = useApi();
const { allowed: featureAllowed, loading: featureLoading } = useFeatureGate(api, 'calc.execute');
const {
	executing, error: formulaError, result: resultData,
	requestPayload, statusCode,
	executeSingle, executeBatch, executeSheet, reset,
	examples, fetchExamples,
} = useFormulas(api);

const LOCALES = [
	{ text: 'English (en)', value: 'en' },
	{ text: 'German (de)', value: 'de' },
	{ text: 'French (fr)', value: 'fr' },
	{ text: 'Spanish (es)', value: 'es' },
	{ text: 'Italian (it)', value: 'it' },
	{ text: 'Portuguese (pt)', value: 'pt' },
	{ text: 'Dutch (nl)', value: 'nl' },
	{ text: 'Swedish (sv)', value: 'sv' },
	{ text: 'Norwegian (nb)', value: 'nb' },
	{ text: 'Danish (da)', value: 'da' },
	{ text: 'Finnish (fi)', value: 'fi' },
	{ text: 'Polish (pl)', value: 'pl' },
	{ text: 'Czech (cs)', value: 'cs' },
	{ text: 'Turkish (tr)', value: 'tr' },
	{ text: 'Russian (ru)', value: 'ru' },
	{ text: 'Japanese (ja)', value: 'ja' },
];

type Mode = 'single' | 'batch' | 'sheet';
const mode = ref<Mode>('single');
const activeTab = ref<'request' | 'response' | 'result'>('result');
const advanced = ref(false);

// Token check
const hasToken = ref(true);
const tokenLoading = ref(true);

// Single mode
const singleFormula = ref('');
const locale = ref<string | null>(null);
const dataJson = ref('');

// Batch mode
const batchFormulas = ref<string[]>(['']);

// Sheet mode
const sheetDataMode = ref<'data' | 'sheets'>('data');
const sheetDataJson = ref('');
const sheetFormulas = ref<SheetFormula[]>([{ cell: '', formula: '', sheet: '' }]);

const sheetDataPlaceholder = computed(() =>
	sheetDataMode.value === 'data' ? '[[1, 2], [3, 4]]' : '{"Sheet1": [[1, 2]], "Sheet2": [[3, 4]]}',
);

// Track whether data field was auto-shown by example selection
const showDataField = computed(() => !advanced.value && !!dataJson.value);

// Locales that use semicolon as formula argument delimiter
const SEMICOLON_LOCALES = new Set(['de', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'nb', 'da', 'fi', 'pl', 'cs', 'tr', 'ru']);
const sep = computed(() => SEMICOLON_LOCALES.has(locale.value || '') ? ';' : ',');
const placeholderFormula = computed(() => `SUM(1${sep.value}2${sep.value}3)`);
const placeholderSheet = computed(() => `SUM(A1${sep.value}B1)`);

const currentExamples = computed(() => {
	if (!advanced.value) {
		return examples.value.filter((ex) => ex.mode === 'single' && !ex.advanced);
	}
	return examples.value.filter((ex) => ex.mode === mode.value && ex.advanced);
});

function loadExample(ex: FormulaExample) {
	reset();
	if (ex.mode === 'single' || (!advanced.value && mode.value === 'single')) {
		singleFormula.value = ex.formula || '';
		dataJson.value = ex.data || '';
		locale.value = null;
	} else if (ex.mode === 'batch') {
		batchFormulas.value = ex.formulas ? [...ex.formulas] : [''];
		dataJson.value = ex.data || '';
		locale.value = null;
	} else if (ex.mode === 'sheet') {
		sheetFormulas.value = ex.sheet_formulas
			? ex.sheet_formulas.map((f) => ({ cell: f.cell, formula: f.formula, sheet: f.sheet || '' }))
			: [{ cell: '', formula: '', sheet: '' }];
		sheetDataJson.value = ex.sheet_data || '';
		sheetDataMode.value = ex.sheet_data_mode || 'data';
		locale.value = null;
	}
}

function switchMode(m: Mode) {
	mode.value = m;
	reset();
}

function clearInputs() {
	singleFormula.value = '';
	locale.value = null;
	dataJson.value = '';
	batchFormulas.value = [''];
	sheetFormulas.value = [{ cell: '', formula: '', sheet: '' }];
	sheetDataJson.value = '';
	sheetDataMode.value = 'data';
	reset();
}

async function toggleAdvanced() {
	advanced.value = !advanced.value;

	// When switching off advanced, force single mode
	if (!advanced.value) {
		mode.value = 'single';
	}

	clearInputs();

	// Persist preference
	try {
		const { data: me } = await api.get('/users/me', { params: { fields: ['appearance_preferences'] } });
		const prefs = me?.data?.appearance_preferences || me?.appearance_preferences || {};
		await api.patch('/users/me', {
			appearance_preferences: { ...prefs, formulas_advanced: advanced.value },
		});
	} catch {
		// Preference save failed — non-critical
	}
}

/** Extract a value from the 2D results grid by cell address (e.g. "C1" → row 0, col 2) */
function getSheetCellValue(cell: string, results: unknown[][]): unknown {
	const match = cell.match(/^([A-Za-z]+)(\d+)$/);
	if (!match) return '—';
	const col = match[1].toUpperCase().split('').reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
	const row = parseInt(match[2], 10) - 1;
	if (row < 0 || row >= results.length) return '—';
	const rowData = results[row];
	if (!Array.isArray(rowData) || col < 0 || col >= rowData.length) return '—';
	const val = rowData[col];
	return val === null || val === undefined ? '—' : val;
}

const canExecute = computed(() => {
	if (executing.value) return false;
	if (mode.value === 'single') return !!singleFormula.value.trim();
	if (mode.value === 'batch') return batchFormulas.value.some((f) => f.trim());
	if (mode.value === 'sheet') return sheetFormulas.value.some((f) => f.cell.trim() && f.formula.trim());
	return false;
});

function parseJson(str: string): unknown | null {
	if (!str.trim()) return null;
	try {
		return JSON.parse(str);
	} catch {
		return null;
	}
}

async function handleExecute() {
	const data = parseJson(dataJson.value);
	const loc = locale.value || undefined;

	if (mode.value === 'single') {
		const payload: any = { formula: singleFormula.value };
		if (loc) payload.locale = loc;
		if (data) payload.data = data;
		await executeSingle(payload);
	} else if (mode.value === 'batch') {
		const formulas = batchFormulas.value.filter((f) => f.trim());
		const payload: any = { formulas };
		if (loc) payload.locale = loc;
		if (data) payload.data = data;
		await executeBatch(payload);
	} else if (mode.value === 'sheet') {
		const formulas = sheetFormulas.value
			.filter((f) => f.cell.trim() && f.formula.trim())
			.map((f) => {
				const entry: any = { cell: f.cell, formula: f.formula };
				if (f.sheet?.trim()) entry.sheet = f.sheet;
				return entry;
			});
		const payload: any = { formulas };
		if (loc) payload.locale = loc;

		const sheetData = parseJson(sheetDataJson.value);
		if (sheetDataMode.value === 'data' && sheetData) {
			payload.data = sheetData;
		} else if (sheetDataMode.value === 'sheets' && sheetData) {
			payload.sheets = sheetData;
		}
		await executeSheet(payload);
	}

	activeTab.value = 'result';
}

onMounted(async () => {
	// Load token status + examples + user preference in parallel
	const tokenPromise = api.get('/calc/api-keys').then(({ data }: any) => {
		const keys = data?.data || data;
		hasToken.value = Array.isArray(keys) && keys.length > 0;
	}).catch(() => {
		hasToken.value = false;
	}).finally(() => {
		tokenLoading.value = false;
	});

	const prefPromise = api.get('/users/me', { params: { fields: ['appearance_preferences'] } }).then(({ data }: any) => {
		const prefs = data?.data?.appearance_preferences || data?.appearance_preferences || {};
		if (prefs.formulas_advanced === true) {
			advanced.value = true;
		}
	}).catch(() => {});

	await Promise.all([tokenPromise, prefPromise, fetchExamples()]);
});
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.formulas-content {
	padding: var(--content-padding);
	padding-bottom: 0;
}

.no-token-notice {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: var(--content-padding);
	height: 400px;
}

.module-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}

/* Simple mode desc */
.simple-desc {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin-bottom: 24px;
}

/* Mode bar */
.mode-bar {
	display: flex;
	gap: 0;
	border-bottom: 2px solid var(--theme--border-color);
	margin-bottom: 8px;
}

.mode-desc {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin-bottom: 24px;
}

.mode-desc code {
	background: var(--theme--background-subdued);
	padding: 2px 6px;
	border-radius: 4px;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
}

/* Columns */
.test-columns {
	display: grid;
	grid-template-columns: 1fr 2fr;
	gap: 32px;
}

.panel-header {
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.5px;
	padding-bottom: 10px;
	border-bottom: 2px solid var(--theme--border-color);
	margin-bottom: 16px;
}

.input-fields {
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.param-field {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.param-title {
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground);
}

.param-desc {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin-top: 2px;
}

.param-desc code {
	background: var(--theme--background-subdued);
	padding: 1px 4px;
	border-radius: 4px;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 12px;
}

.required-mark {
	color: var(--theme--danger, #e35169);
}

/* List rows (batch formulas, sheet formulas) */
.list-row {
	display: flex;
	gap: 8px;
	align-items: center;
	margin-bottom: 6px;
}

.list-row:last-of-type {
	margin-bottom: 0;
}

.sheet-formula-row .cell-input {
	max-width: 80px;
}

.sheet-formula-row .sheet-input {
	max-width: 100px;
}

.row-remove {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	flex-shrink: 0;
	background: none;
	border: none;
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	border-radius: var(--theme--border-radius);
	transition: color 0.15s, background 0.15s;
}

.row-remove:hover {
	color: var(--theme--danger);
	background: var(--theme--danger-background);
}

.add-row-btn {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 6px 12px;
	font-size: 13px;
	font-weight: 600;
	background: none;
	border: var(--theme--border-width) dashed var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	transition: color 0.15s, border-color 0.15s;
	margin-top: 6px;
}

.add-row-btn:hover {
	color: var(--theme--primary);
	border-color: var(--theme--primary);
}

/* Result panel */
.result-panel {
	display: flex;
	flex-direction: column;
}

.tabs-bar {
	display: flex;
	gap: 0;
	border-bottom: 2px solid var(--theme--border-color);
}

.tab-btn {
	padding: 0 20px 10px;
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

.tab-btn:first-child {
	padding-left: 0;
}

.tab-btn:hover {
	color: var(--theme--foreground);
}

.tab-btn.active {
	color: var(--theme--primary);
	border-bottom-color: var(--theme--primary);
}

.tab-content {
	padding-top: 16px;
}

.tab-empty {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
	padding: 24px 0;
}

.json-box {
	padding: 12px;
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
	white-space: pre-wrap;
	word-break: break-all;
	max-height: 500px;
	overflow-y: auto;
	margin: 0;
}

.error-box {
	margin-bottom: 12px;
	padding: 12px 16px;
	background: var(--theme--danger-background);
	color: var(--theme--danger);
	border-radius: var(--theme--border-radius);
	font-size: 14px;
	font-weight: 500;
	border: 1px solid var(--theme--danger, #e35169);
}

.status-badge {
	display: inline-block;
	padding: 2px 8px;
	font-size: 12px;
	font-weight: 700;
	border-radius: 4px;
	margin-bottom: 8px;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
}

.status-ok {
	background: var(--theme--success-background);
	color: var(--theme--success);
}

.status-err {
	background: var(--theme--danger-background);
	color: var(--theme--danger);
}

/* Output table */
.output-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 14px;
}

.output-table th,
.output-table td {
	padding: 10px 12px;
	text-align: left;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color);
}

.output-table th {
	font-weight: 600;
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.output-table tbody tr:hover {
	background: var(--theme--background-subdued);
}

.result-label {
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	width: 120px;
}

.result-value {
	font-weight: 600;
	font-size: 18px;
	color: var(--theme--primary);
}

.result-error {
	color: var(--theme--danger);
	font-weight: 500;
}

.mono {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
}

.error-result {
	padding: 16px;
	background: var(--theme--danger-background);
	border-radius: var(--theme--border-radius);
	border: 1px solid var(--theme--danger, #e35169);
}

.error-title {
	font-weight: 600;
	color: var(--theme--danger);
	font-size: 15px;
}

.error-detail {
	color: var(--theme--danger);
	font-size: 14px;
	margin-top: 4px;
}

.unresolved-hint {
	color: var(--theme--warning);
	font-size: 12px;
	margin-top: 4px;
}

/* Sidebar */
.sidebar-info {
	padding: 12px;
}

.sidebar-info p {
	margin: 0 0 8px;
	line-height: 1.6;
}

.sidebar-info ul {
	margin: 0;
	padding-left: 18px;
}

.sidebar-info li {
	font-size: 14px;
	line-height: 1.6;
}

.sidebar-info a {
	color: var(--theme--primary);
}

/* Bottom bar */
.bottom-bar {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 16px;
	padding: 16px 0;
	border-top: var(--theme--border-width) solid var(--theme--border-color);
	margin-top: 24px;
	position: sticky;
	bottom: 0;
	background: var(--theme--background);
	z-index: 5;
}

/* Advanced toggle */
.advanced-toggle {
	display: flex;
	align-items: center;
	gap: 8px;
	cursor: pointer;
	user-select: none;
}

.advanced-label {
	font-size: 14px;
	font-weight: 500;
	color: var(--theme--foreground-subdued);
}

.toggle-track {
	width: 36px;
	height: 20px;
	border-radius: 10px;
	background: var(--theme--border-color);
	position: relative;
	transition: background 0.2s;
}

.toggle-track.on {
	background: var(--theme--primary);
}

.toggle-thumb {
	width: 16px;
	height: 16px;
	border-radius: 50%;
	background: white;
	position: absolute;
	top: 2px;
	left: 2px;
	transition: left 0.2s;
}

.toggle-track.on .toggle-thumb {
	left: 18px;
}
.feature-gate-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}
.feature-gate-unavailable {
	padding: var(--content-padding);
	padding-top: 120px;
}
</style>
