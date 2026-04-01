<template>
	<private-view :title="viewTitle">
		<template #headline>
			<v-breadcrumb v-if="false" :items="[]" />
		</template>
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="calculate" />
			</v-button>
		</template>

		<template #navigation>
			<calculator-navigation
				:calculators="calculators"
				:current-id="currentId"
				:loading="loading"
				:creating="saving"
				:has-excel="hasExcel"
				:has-config="hasConfig"
				current-view="dashboard"
				@create="handleCreate"
			/>
		</template>

		<template #actions>
			<v-chip v-if="currentId && current?.activated && !current?.over_limit" small class="chip-live">Live {{ liveVersion }}</v-chip>
			<v-chip v-else-if="currentId && current?.activated && current?.over_limit" small class="chip-danger">Over limit {{ countdownText(current.activation_expires_at) }}</v-chip>
			<v-chip v-else-if="currentId && current && isTestActive" small class="chip-test">Test {{ testVersion }}</v-chip>
			<v-chip v-else-if="currentId && current && (testConfig || prodConfig)" small class="chip-inactive">Deactivated</v-chip>

			<v-dialog v-if="currentId" v-model="confirmDelete" @esc="confirmDelete = false">
				<template #activator="{ on }">
					<v-button
						v-tooltip.bottom="'Delete'"
						rounded
						icon
						secondary
						@click="on"
					>
						<v-icon name="delete" />
					</v-button>
				</template>

				<v-card>
					<v-card-title>Delete "{{ current?.name || currentId }}"?</v-card-title>
					<v-card-text>This will remove both test and live versions from the Formula API, delete all configurations, and cannot be undone.</v-card-text>
					<v-card-actions>
						<v-button secondary @click="confirmDelete = false">Cancel</v-button>
						<v-button kind="danger" :loading="saving" @click="handleDelete">Delete</v-button>
					</v-card-actions>
				</v-card>
			</v-dialog>
		</template>

		<!-- Feature gate -->
		<div v-if="featureLoading" class="feature-gate-loading">
			<v-progress-circular indeterminate />
		</div>
		<div v-else-if="!featureAllowed" class="feature-gate-unavailable">
			<v-info icon="block" title="Feature Unavailable" center>
				Calculators are not available for your account. Contact your administrator.
			</v-info>
		</div>
		<template v-else>
		<div v-if="currentId && current" class="module-content">
			<calculator-detail
				:calculator="current"
				:calculators="calculators"
				:templates="templates"
				:has-config="hasConfig"
				:loading="saving"
				:pending-file-name="pendingFileName"
				:uploaded-file-name="uploadedFileName"
				:test-result="testResult"
				:test-error="testError"
				:test-running="testRunning"
				:formula-api-url="formulaApiUrl"
				:live-test-result="liveTestResult"
				:live-test-error="liveTestError"
				:action-error="actionError"
				@apply-template="handleApplyTemplate"
				@select-file="handleSelectFile"
				@drop-file="handleDropFile"
				@upload-file="handleUploadFile"
				@update-calculator="handleUpdateCalculator"
				@save-config="handleSaveConfig"
				@run-test="handleRunTest"
				@launch="handleLaunch"
				@complete-onboarding="handleCompleteOnboarding"
				@activate="handleActivate"
				@deactivate="handleDeactivate"
				@regenerate-api-key="handleRegenerateApiKey"
				@enable-test="handleEnableTest"
				@disable-test="handleDisableTest"
				@download-excel="handleDownloadExcel"
			/>

			<input
				ref="fileInput"
				type="file"
				accept=".xlsx,.xls"
				style="display: none"
				@change="onFileSelected"
			/>
		</div>

		<div v-else-if="!currentId" class="module-empty">
			<v-info icon="calculate" title="Calculators" center>
				Select a calculator from the sidebar or create a new one.
			</v-info>
		</div>

		<div v-else-if="loading" class="module-loading">
			<v-progress-circular indeterminate />
		</div>

		</template>
		<template #sidebar>
			<sidebar-detail icon="help_outline" title="About Calculators" close>
				<div class="sidebar-info">
					<p>Turn Excel models into live APIs. Upload a spreadsheet, define inputs and outputs, test, then deploy.</p>
					<p><strong>Features:</strong></p>
					<ul>
						<li>Excel upload with auto-parsing</li>
						<li>Input/output schema</li>
						<li>Test environment</li>
						<li>One-click live deployment</li>
						<li>Per-calculator API keys</li>
					</ul>
				</div>
			</sidebar-detail>
			<sidebar-detail icon="info" title="Information" close>
				<div class="sidebar-info" v-if="current">
					<div class="info-row">
						<span class="info-label">ID</span>
						<span class="info-value mono">{{ current.id }}</span>
					</div>
					<div class="info-row">
						<span class="info-label">Status</span>
						<span class="info-value">
							<v-chip x-small v-if="current.activated && !current.over_limit" class="chip-live">Live</v-chip>
							<v-chip x-small v-else-if="current.activated && current.over_limit" class="chip-danger">Over limit</v-chip>
							<v-chip x-small v-else-if="isTestActive" class="chip-test">Test</v-chip>
							<v-chip x-small v-else-if="testConfig || prodConfig" class="chip-inactive">Deactivated</v-chip>
							<v-chip x-small v-else class="chip-inactive">New</v-chip>
						</span>
					</div>
					<div class="info-row" v-if="prodConfig">
						<span class="info-label">Live version</span>
						<span class="info-value">{{ liveVersion }}</span>
					</div>
					<div class="info-row" v-if="testConfig">
						<span class="info-label">Test version</span>
						<span class="info-value">{{ testVersion }}</span>
					</div>
					<div class="info-row" v-if="inputCount > 0">
						<span class="info-label">Inputs</span>
						<span class="info-value">{{ inputCount }}</span>
					</div>
					<div class="info-row" v-if="outputCount > 0">
						<span class="info-label">Outputs</span>
						<span class="info-value">{{ outputCount }}</span>
					</div>
					<div class="info-row" v-if="excelFileName">
						<span class="info-label">Excel</span>
						<span class="info-value">{{ excelFileName }}</span>
					</div>
					<div class="info-row">
						<span class="info-label">Created</span>
						<span class="info-value">{{ formatDate(current.date_created) }}</span>
					</div>
					<div class="info-row" v-if="current.date_updated">
						<span class="info-label">Updated</span>
						<span class="info-value">{{ formatDate(current.date_updated) }}</span>
					</div>
				</div>
				<div class="sidebar-info" v-else>
					<p>Select a calculator to view details.</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useFeatureGate } from '../../../project-extension-feature-gate/src/use-feature-gate';
import { useRoute, useRouter } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import { useCalculators } from '../composables/use-calculators';
import { useActiveAccount } from '../composables/use-active-account';
import { useSubscription } from '../composables/use-subscription';
import CalculatorNavigation from '../components/navigation.vue';
import CalculatorDetail from '../components/calculator-detail.vue';
import type { Calculator, CalculatorConfig, CalculatorTemplate } from '../types';
import { extractErrorMessage } from '../utils/error';

const api = useApi();
const { allowed: featureAllowed, loading: featureLoading } = useFeatureGate(api, 'calc.execute');
const route = useRoute();
const router = useRouter();

const {
	calculators, current, templates, loading, saving,
	fetchAll, fetchOne, fetchTemplates, create, update, remove,
	createConfig, updateConfig, uploadExcelFile, parseExcel,
	launchConfig, deployConfig, undeployConfig, executeConfig,
	fetchFormulaApiUrl, enableTest, disableTest, activateCalc,
	downloadExcel,
} = useCalculators(api);

const {
	fetchSubscriptionInfo,
} = useSubscription(api);

const {
	activeAccountId,
	fetchActiveAccount,
} = useActiveAccount(api);

const pendingFile = ref<File | null>(null);
const pendingFileName = ref<string | null>(null);
const uploadedFileName = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const confirmDelete = ref(false);
const testResult = ref<unknown>(null);
const testError = ref<string | null>(null);
const testRunning = ref(false);
const formulaApiUrl = ref<string | null>(null);
const liveTestResult = ref<unknown>(null);
const liveTestError = ref<string | null>(null);
const lastTestInput = ref<Record<string, unknown>>({});
const actionError = ref<string | null>(null);
const countdownTick = ref(0);

let countdownInterval: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
	countdownInterval = setInterval(() => { countdownTick.value++; }, 60_000);
});
onUnmounted(() => {
	if (countdownInterval) clearInterval(countdownInterval);
});

function countdownText(expiresAt: string | null | undefined): string {
	// force reactivity on tick
	void countdownTick.value;
	if (!expiresAt) return '';
	const ms = new Date(expiresAt).getTime() - Date.now();
	if (ms <= 0) return '(expired)';
	const h = Math.floor(ms / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	if (h > 0) return `(${h}h ${m}m)`;
	return `(${m}m)`;
}

const isTestActive = computed(() => {
	if (!current.value?.test_expires_at) return false;
	void countdownTick.value;
	return new Date(current.value.test_expires_at) > new Date();
});

const currentId = computed(() => (route.params.id as string) || null);

const viewTitle = computed(() => {
	if (!currentId.value) return 'Calculators';
	if (current.value?.name) return current.value.name;
	return 'New Calculator';
});

const testConfig = computed(
	() => current.value?.configs?.find((c) => c.test_environment) || null,
);

const prodConfig = computed(
	() => current.value?.configs?.find((c) => !c.test_environment) || null,
);

const hasExcel = computed(() => !!testConfig.value?.excel_file);


const hasConfig = computed(() => {
	const input = testConfig.value?.input as any;
	const props = input?.properties || input;
	return !!(props && typeof props === 'object' && Object.keys(props).length > 0);
});

function formatVersion(cfg: CalculatorConfig | null): string {
	if (!cfg) return '';
	const cv = cfg.config_version || '0';
	const fv = cfg.file_version || 0;
	return `${cv}.${fv}`;
}

const liveVersion = computed(() => formatVersion(prodConfig.value));
const testVersion = computed(() => formatVersion(testConfig.value));

const inputCount = computed(() => {
	const input = testConfig.value?.input as any;
	const props = input?.properties || input;
	return props && typeof props === 'object' ? Object.keys(props).length : 0;
});

const outputCount = computed(() => {
	const output = testConfig.value?.output as any;
	const props = output?.properties || output;
	return props && typeof props === 'object' ? Object.keys(props).length : 0;
});

const excelFileName = computed(() => {
	const file = testConfig.value?.excel_file;
	if (!file) return null;
	if (typeof file === 'object' && 'filename_download' in file) return file.filename_download;
	return null;
});

function handleSelectFile() {
	fileInput.value?.click();
}

function handleDropFile(file: File) {
	pendingFile.value = file;
	pendingFileName.value = file.name;
	uploadedFileName.value = null;
}

function onFileSelected(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;

	pendingFile.value = file;
	pendingFileName.value = file.name;
	uploadedFileName.value = null;

	input.value = '';
}

async function handleUploadFile() {
	if (!pendingFile.value || !currentId.value) return;

	try {
		const [{ sheets, formulas, expressions, profile }, fileId] = await Promise.all([
			parseExcel(pendingFile.value),
			uploadExcelFile(pendingFile.value),
		]);

		const prodVersion = prodConfig.value?.file_version || 0;
		const fileVersion = prodVersion + 1;

		const configData: Partial<CalculatorConfig> = {
			excel_file: fileId,
			file_version: fileVersion,
			...(sheets && { sheets }),
			...(formulas && { formulas }),
			expressions: expressions || null,
			profile: profile || null,
		};

		if (testConfig.value) {
			await updateConfig(testConfig.value.id, currentId.value, configData);
		} else {
			await createConfig(currentId.value, {
				...configData,
				test_environment: true,
			});
		}

		// Auto-generate test API key if not set
		const updatedTestCfg = current.value?.configs?.find((c) => c.test_environment);
		if (updatedTestCfg && !updatedTestCfg.api_key) {
			const newKey = crypto.randomUUID().replace(/-/g, '');
			await updateConfig(updatedTestCfg.id, currentId.value, { api_key: newKey });
		}

		uploadedFileName.value = pendingFile.value.name;
		pendingFile.value = null;
		pendingFileName.value = null;
	} catch {
		// error is set by composable
	}
}

function convertTemplateFormulas(obj: Record<string, unknown> | null): Array<{ sheet: string; cell: string; formula: string }> {
	if (!obj) return [];
	const result: Array<{ sheet: string; cell: string; formula: string }> = [];
	for (const [sheet, cells] of Object.entries(obj)) {
		if (cells && typeof cells === 'object') {
			for (const [cell, formula] of Object.entries(cells as Record<string, string>)) {
				result.push({ sheet, cell, formula });
			}
		}
	}
	return result;
}

async function handleApplyTemplate(template: CalculatorTemplate) {
	if (!currentId.value) return;

	const formulas = Array.isArray(template.formulas)
		? template.formulas
		: convertTemplateFormulas(template.formulas as Record<string, unknown> | null);

	const configData: Partial<CalculatorConfig> = {
		sheets: template.sheets as any,
		formulas: formulas as any,
		input: template.input as any,
		output: template.output as any,
		config_version: '1',
		test_environment: true,
	};

	if (testConfig.value) {
		await updateConfig(testConfig.value.id, currentId.value, configData);
	} else {
		await createConfig(currentId.value, configData);
	}

	// Auto-generate test API key if not set
	const updatedTestCfg = current.value?.configs?.find((c) => c.test_environment);
	if (updatedTestCfg && !updatedTestCfg.api_key) {
		const newKey = crypto.randomUUID().replace(/-/g, '');
		await updateConfig(updatedTestCfg.id, currentId.value, { api_key: newKey });
	}
}

async function handleLaunch() {
	if (!currentId.value || !testConfig.value) return;
	liveTestResult.value = null;
	liveTestError.value = null;

	await launchConfig(currentId.value, testConfig.value);

	// Launch activates the calculator via the activate endpoint (handles limits)
	const configs = current.value?.configs || [];
	const liveConfig = configs.find((c) => !c.test_environment);
	if (liveConfig) {
		// Auto-generate live API key if not set
		if (!liveConfig.api_key) {
			const newKey = crypto.randomUUID().replace(/-/g, '');
			await updateConfig(liveConfig.id, currentId.value, { api_key: newKey });
		}
	}
	await activateCalc(currentId.value);
	await fetchSubscriptionInfo();

	pendingFile.value = null;
	pendingFileName.value = null;
	uploadedFileName.value = null;

	// Run live test in background with last test input
	if (Object.keys(lastTestInput.value).length > 0) {
		try {
			const res = await executeConfig(currentId.value, false, lastTestInput.value);
			liveTestResult.value = res;
		} catch (err: any) {
			liveTestError.value = extractErrorMessage(err, 'Live test failed');
		}
	}
}

async function handleCompleteOnboarding() {
	if (!currentId.value) return;
	await update(currentId.value, { onboarded: true });
}

async function handleActivate() {
	if (!currentId.value || !prodConfig.value) return;
	actionError.value = null;
	saving.value = true;
	try {
		const result = await activateCalc(currentId.value);
		// PATCH through Directus to invalidate cache (activateCalc uses Knex directly)
		await update(currentId.value, {
			activated: true,
			over_limit: result.over_limit ?? false,
			activation_expires_at: result.activation_expires_at ?? null,
		} as any);
		await fetchSubscriptionInfo();
	} catch (err: any) {
		actionError.value = extractErrorMessage(err, 'Activation failed');
	} finally {
		saving.value = false;
	}
}

async function handleDeactivate() {
	if (!currentId.value || !prodConfig.value) return;
	actionError.value = null;
	saving.value = true;
	try {
		await undeployConfig(currentId.value, false);
		await update(currentId.value, { activated: false, over_limit: false, activation_expires_at: null } as any);
		await fetchSubscriptionInfo();
	} catch (err: any) {
		actionError.value = extractErrorMessage(err, 'Deactivation failed');
	} finally {
		saving.value = false;
	}
}

async function handleEnableTest() {
	if (!currentId.value) return;
	await enableTest(currentId.value);
	await fetchAll(activeAccountId.value);
}

async function handleDisableTest() {
	if (!currentId.value) return;
	await disableTest(currentId.value);
	await fetchAll(activeAccountId.value);
}

async function handleDownloadExcel(configId: string, filename: string) {
	try {
		await downloadExcel(configId, filename);
	} catch (err: any) {
		actionError.value = extractErrorMessage(err) || 'Download failed';
	}
}

async function handleDelete() {
	if (!currentId.value) return;
	confirmDelete.value = false;

	// Undeploy both configs from Formula API before deleting
	const configs = current.value?.configs || [];
	for (const config of configs) {
		try {
			await undeployConfig(currentId.value, !!config.test_environment);
		} catch {
			// continue even if undeploy fails
		}
	}

	await remove(currentId.value);
	router.push('/calculators');
}

async function handleRegenerateApiKey(env: string) {
	if (!currentId.value) return;
	const newKey = crypto.randomUUID().replace(/-/g, '');

	if (env === 'test') {
		if (testConfig.value) {
			await updateConfig(testConfig.value.id, currentId.value, { api_key: newKey });
		} else {
			await createConfig(currentId.value, { api_key: newKey, test_environment: true });
		}
	} else if (env === 'prod') {
		if (prodConfig.value) {
			await updateConfig(prodConfig.value.id, currentId.value, { api_key: newKey });
		} else {
			await createConfig(currentId.value, { api_key: newKey, test_environment: false });
		}
	}
}

async function handleSaveConfig(payload: { input: Record<string, unknown>; output: Record<string, unknown> }) {
	if (!currentId.value) return;
	const { input, output } = payload;
	const prodCv = prodConfig.value?.config_version ? Number(prodConfig.value.config_version) : 0;
	const config_version = String(prodCv + 1);

	if (testConfig.value) {
		await updateConfig(testConfig.value.id, currentId.value, { input, output, config_version });
	} else {
		await createConfig(currentId.value, { input, output, config_version, test_environment: true });
	}
}

async function handleRunTest(inputValues: Record<string, unknown>) {
	if (!testConfig.value || !currentId.value) return;
	testRunning.value = true;
	testResult.value = null;
	testError.value = null;
	lastTestInput.value = { ...inputValues };
	try {
		// Auto-enable test window if not active
		if (!isTestActive.value) {
			await enableTest(currentId.value);
		}
		const res = await executeConfig(currentId.value, true, inputValues);
		testResult.value = res;
	} catch (err: any) {
		testError.value = extractErrorMessage(err, 'Test failed');
	} finally {
		testRunning.value = false;
	}
}

async function handleUpdateCalculator(edits: Partial<Calculator>) {
	if (!currentId.value) return;
	const newId = edits.id as string | undefined;

	if (newId && newId !== currentId.value) {
		// Directus 403s on reads after primary key change — delete + recreate instead
		const oldCalc = current.value;
		await remove(currentId.value);
		await create({
			id: newId,
			name: edits.name ?? oldCalc?.name ?? null,
			description: edits.description ?? oldCalc?.description ?? null,
			account: oldCalc?.account ?? null,
		});
		router.push(`/calculators/${newId}`);
	} else {
		await update(currentId.value, edits);
	}
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

async function handleCreate() {
	const id = crypto.randomUUID();
	const accountId = activeAccountId.value || null;

	const created = await create({ id, name: null, account: accountId, onboarded: false });
	if (created) {
		router.push(`/calculators/${created.id}`);
	}
}

function formatDate(date: string | null | undefined): string {
	if (!date) return '—';
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	}).format(new Date(date));
}

fetchActiveAccount().then(() => {
	fetchAll(activeAccountId.value);
	fetchSubscriptionInfo();
});
fetchTemplates();
fetchFormulaApiUrl().then((url) => { formulaApiUrl.value = url; }).catch(() => {});

watch(activeAccountId, (id) => {
	fetchAll(id);
});

watch(currentId, (id) => {
	pendingFile.value = null;
	pendingFileName.value = null;
	uploadedFileName.value = null;
	testResult.value = null;
	testError.value = null;
	liveTestResult.value = null;
	liveTestError.value = null;
	if (id) fetchOne(id);
}, { immediate: true });
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.chip-live {
	--v-chip-background-color: var(--theme--success-background, rgba(46, 205, 167, 0.1));
	--v-chip-color: var(--theme--success);
}

.chip-test {
	--v-chip-background-color: var(--theme--warning-background);
	--v-chip-color: var(--theme--warning);
}



.chip-danger {
	--v-chip-background-color: var(--theme--danger-background);
	--v-chip-color: var(--theme--danger);
}

.chip-inactive {
	--v-chip-background-color: var(--theme--background-subdued);
	--v-chip-color: var(--theme--foreground-subdued);
}

.chip-live,
.chip-test,
.chip-danger,
.chip-inactive {
	margin-top: auto;
	margin-bottom: auto;
}

.module-content {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
}

.module-empty,
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

.info-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 6px 0;
	border-bottom: 1px solid var(--theme--border-color-subdued);
}

.info-row:last-child {
	border-bottom: none;
}

.info-label {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.info-value {
	font-size: 14px;
	text-align: right;
	max-width: 60%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.info-value.mono {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 12px;
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
