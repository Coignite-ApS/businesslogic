<template>
	<private-view :title="testPageTitle">
		<template #headline>
			<v-breadcrumb
				v-if="current?.name"
				:items="[{ name: current.name, to: `/calculators/${currentId}` }]"
			/>
		</template>
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="play_arrow" />
			</v-button>
		</template>

		<template #actions>
			<v-dialog v-if="isDeployed" v-model="showGoLiveDialog" @esc="showGoLiveDialog = false">
				<template #activator="{ on }">
					<v-button
						v-tooltip.bottom="canGoLive ? 'Publish test version to live' : 'No changes to publish'"
						:loading="publishing"
						:disabled="!canGoLive"
						@click="on"
					>
						<v-icon name="rocket_launch" left />
						Go Live {{ testVersion }}
					</v-button>
				</template>

				<v-card>
					<v-card-title>Publish Test Version?</v-card-title>
					<v-card-text>
						<template v-if="hasLiveConfig">
							You're about to publish test version {{ testVersion }}, replacing the current live version {{ liveVersion }}.
						</template>
						<template v-else>
							You're about to publish test version {{ testVersion }} as the first live version.
						</template>
						<br /><br />
						This will make version {{ testVersion }} available to all API consumers, widgets, and AI integrations.
					</v-card-text>
					<v-card-actions>
						<v-button secondary @click="showGoLiveDialog = false">Cancel</v-button>
						<v-button :loading="publishing" @click="handleGoLive">
							<v-icon name="rocket_launch" left />
							Go Live {{ testVersion }}
						</v-button>
					</v-card-actions>
				</v-card>
			</v-dialog>
		</template>

		<template #navigation>
			<calculator-navigation
				:calculators="calculators"
				:current-id="currentId"
				:loading="loading"
				:creating="saving"
				:has-excel="hasExcel"
				:has-config="hasConfig"
				current-view="test"
				@create="handleCreate"
			/>
		</template>

		<div v-if="currentId && current && !hasConfig" class="prerequisite-notice">
			<v-info icon="tune" title="Configure Parameters First" center>
				Set up input and output parameters on the Configure page before testing your calculator.
			</v-info>
			<div class="prerequisite-action">
				<v-button secondary @click="router.push(`/calculators/${currentId}/configure`)">
					<v-icon name="tune" left />
					Go to Configure
				</v-button>
			</div>
		</div>

		<div v-else-if="currentId && current" class="test-content">
			<!-- Deploy notice -->
			<div v-if="!isDeployed" class="deploy-notice">
				<v-icon name="cloud_off" />
				<span>Not deployed to Formula API.</span>
				<v-button small :loading="deploying" @click="handleDeploy">Deploy now</v-button>
			</div>

			<!-- Unsupported functions warning -->
			<v-notice v-if="unresolvedFunctions?.length" type="warning" class="unresolved-notice">
				Unsupported Excel functions: {{ unresolvedFunctions.map((f: any) => f.name).join(', ') }}.
				These may cause #NAME? errors in calculations.
			</v-notice>

			<div class="test-columns">
				<!-- Left: Input form -->
				<div class="input-panel">
					<div class="panel-header">Input</div>
					<div v-if="inputParams.length > 0" class="input-fields">
						<div v-for="param in inputParams" :key="param.key" class="param-field" :class="{ 'has-error': validationErrors[param.key] }">
							<div class="param-title">
								{{ param.title || param.key }}<span v-if="param.required" class="required-mark"> *</span>
								<span v-if="param.type === 'percentage' || ((param.type === 'number' || param.type === 'integer' || param.type === 'currency') && param.display === 'slider' && param.minimum != null && param.maximum != null)" class="param-title-value">
									<span v-if="param.type === 'currency' && param.currency" class="input-affix">{{ param.currency }} </span>{{ param.type === 'percentage' ? (inputValues[param.key] ?? param.default ?? 0) + '%' : (inputValues[param.key] ?? param.default ?? param.minimum) }}
								</span>
							</div>

							<v-select
								v-if="param.oneOf && param.oneOf.length"
								:model-value="inputValues[param.key]"
								:items="param.oneOf.map((o: any) => ({ text: String(o.title), value: o.const }))"
								:placeholder="param.title"
								@update:model-value="inputValues[param.key] = $event"
							/>
							<v-select
								v-else-if="param.type === 'boolean'"
								:model-value="inputValues[param.key]"
								:items="[{ text: 'True', value: true }, { text: 'False', value: false }]"
								:placeholder="param.title"
								@update:model-value="inputValues[param.key] = $event"
							/>
							<v-input
								v-else-if="param.type === 'date'"
								type="date"
								:model-value="inputValues[param.key]"
								:placeholder="param.default != null ? String(param.default) : param.title"
								@update:model-value="inputValues[param.key] = $event"
							/>
							<v-input
								v-else-if="param.type === 'time'"
								type="time"
								:model-value="inputValues[param.key]"
								:placeholder="param.default != null ? String(param.default) : param.title"
								@update:model-value="inputValues[param.key] = $event"
							/>
							<v-input
								v-else-if="param.type === 'datetime'"
								type="datetime-local"
								:model-value="inputValues[param.key]"
								:placeholder="param.default != null ? String(param.default) : param.title"
								@update:model-value="inputValues[param.key] = $event"
							/>
							<!-- Percentage: always slider -->
							<div v-else-if="param.type === 'percentage'" class="slider-input">
								<input
									type="range"
									class="slider"
									:min="param.minimum ?? 0"
									:max="param.maximum ?? 100"
									:step="param.multipleOf ?? 1"
									:value="inputValues[param.key] ?? param.default ?? 0"
									@input="inputValues[param.key] = Number(($event.target as HTMLInputElement).value)"
								/>
								<div class="slider-bounds">
									<span>{{ param.minimum ?? 0 }}%</span>
									<span>{{ param.maximum ?? 100 }}%</span>
								</div>
							</div>
							<!-- Number/integer/currency with slider display -->
							<div v-else-if="(param.type === 'number' || param.type === 'integer' || param.type === 'currency') && param.display === 'slider' && param.minimum != null && param.maximum != null" class="slider-input">
								<input
									type="range"
									class="slider"
									:min="param.minimum"
									:max="param.maximum"
									:step="param.multipleOf ?? (param.type === 'integer' ? 1 : 'any')"
									:value="inputValues[param.key] ?? param.default ?? param.minimum"
									@input="inputValues[param.key] = Number(($event.target as HTMLInputElement).value)"
								/>
								<div class="slider-bounds">
									<span>{{ param.minimum }}</span>
									<span>{{ param.maximum }}</span>
								</div>
							</div>
							<!-- Currency input (no slider) -->
							<v-input
								v-else-if="param.type === 'currency'"
								type="number"
								:model-value="inputValues[param.key]"
								:placeholder="param.default != null ? String(param.default) : '0.00'"
								:min="param.minimum"
								:max="param.maximum"
								:step="param.multipleOf ?? 'any'"
								@update:model-value="inputValues[param.key] = $event === '' ? null : Number($event)"
							>
								<template v-if="param.currency" #prepend><span class="currency-label">{{ param.currency }}</span></template>
							</v-input>
							<v-input
								v-else-if="param.type === 'number' || param.type === 'integer'"
								type="number"
								:model-value="inputValues[param.key]"
								:placeholder="param.default != null ? String(param.default) : param.title"
								:min="param.minimum"
								:max="param.maximum"
								:step="param.multipleOf ?? (param.type === 'integer' ? 1 : 'any')"
								@update:model-value="inputValues[param.key] = $event === '' ? null : Number($event)"
							/>
							<v-input
								v-else
								:model-value="inputValues[param.key]"
								:placeholder="param.default != null ? String(param.default) : param.title"
								@update:model-value="inputValues[param.key] = $event"
							/>

							<div v-if="param.description" class="param-desc">{{ param.description }}</div>
							<div v-if="validationErrors[param.key]" class="param-error">{{ validationErrors[param.key] }}</div>
						</div>
					</div>
					<div v-else class="no-params">
						No input parameters defined. Will execute with empty input.
					</div>
				</div>

				<!-- Right: Tabs panel -->
				<div class="result-panel">
					<div class="tabs-bar">
						<button
							class="tab-btn"
							:class="{ active: activeTab === 'request' }"
							@click="activeTab = 'request'"
						>
							Request
						</button>
						<button
							class="tab-btn"
							:class="{ active: activeTab === 'response' }"
							@click="activeTab = 'response'"
						>
							Response
						</button>
						<button
							class="tab-btn"
							:class="{ active: activeTab === 'output' }"
							@click="activeTab = 'output'"
						>
							Output
						</button>
					</div>

					<!-- Error -->
					<div v-if="execError" class="error-box">{{ execError }}</div>

					<div class="tab-content">
						<div v-if="activeTab === 'request'">
							<pre v-if="requestPayload" class="json-box">{{ JSON.stringify(requestPayload, null, 2) }}</pre>
							<div v-else class="tab-empty">Run a calculation to see the request payload.</div>
						</div>

						<div v-if="activeTab === 'response'">
							<pre v-if="responseData" class="json-box">{{ JSON.stringify(responseData, null, 2) }}</pre>
							<div v-else-if="!execError" class="tab-empty">Run a calculation to see the response.</div>
						</div>

						<div v-if="activeTab === 'output'">
							<div v-if="compareEnabled && hasLiveConfig" class="compare-subtitle">
								Test {{ testVersion }} compared with Live {{ liveVersion }}
							</div>
							<table v-if="outputRows.length > 0" class="output-table" :class="{ 'compare-mode': compareEnabled && liveResponseData }">
								<thead>
									<tr v-if="compareEnabled && liveResponseData">
										<th>Label</th>
										<th>Test {{ testVersion }}</th>
										<th>Live {{ liveVersion }}</th>
									</tr>
									<tr v-else>
										<th>Label</th>
										<th>Value</th>
									</tr>
								</thead>
								<tbody>
									<template v-for="row in outputRows" :key="row.key">
										<tr v-if="row.divider" class="divider-row">
											<td :colspan="compareEnabled && liveResponseData ? 3 : 2"></td>
										</tr>
										<tr v-else-if="row.group" class="group-header">
											<td :colspan="compareEnabled && liveResponseData ? 3 : 2">{{ row.label }}</td>
										</tr>
										<tr v-else-if="row.indent" class="indent-row">
											<td class="indent-label">{{ row.label }}</td>
											<td :class="{ 'value-diff': compareEnabled && liveResponseData && row.value !== row.liveValue }">{{ row.value }}</td>
											<td v-if="compareEnabled && liveResponseData" :class="{ 'value-diff': row.value !== row.liveValue }">{{ row.liveValue }}</td>
										</tr>
										<tr v-else>
											<td>{{ row.label }}</td>
											<td :class="{ 'value-diff': compareEnabled && liveResponseData && row.value !== row.liveValue }">{{ row.value }}</td>
											<td v-if="compareEnabled && liveResponseData" :class="{ 'value-diff': row.value !== row.liveValue }">{{ row.liveValue }}</td>
										</tr>
									</template>
								</tbody>
							</table>
							<div v-else class="tab-empty">
								{{ responseData ? 'No output parameters defined.' : 'Run a calculation to see output.' }}
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Saved test cases section -->
			<div v-if="testCases.length > 0 || showAddTestCase" class="saved-tests-section">
				<div class="saved-tests-header">
					<span class="saved-tests-title">Saved Tests</span>
					<div class="saved-tests-actions">
						<v-button
							v-if="testCases.length > 0"
							small
							secondary
							:loading="runningAll"
							:disabled="!isDeployed"
							@click="handleRunAll"
						>
							<v-icon name="play_circle" left small />
							Run All
						</v-button>
						<v-button small secondary @click="showAddTestCase = !showAddTestCase">
							<v-icon name="add" left small />
							Add Test
						</v-button>
					</div>
				</div>

				<!-- Add test case form -->
				<div v-if="showAddTestCase" class="add-tc-form">
					<div class="add-tc-fields">
						<v-input v-model="testCaseName" placeholder="Test case name" />
						<p class="add-tc-hint">Current inputs will be saved. If you ran a calculation, the response will be saved as expected outputs.</p>
					</div>
					<div class="add-tc-footer">
						<v-button secondary small @click="showAddTestCase = false">Cancel</v-button>
						<v-button small :loading="savingTestCase" :disabled="!testCaseName.trim()" @click="handleSaveNewTestCase">
							Save Test Case
						</v-button>
					</div>
				</div>

				<!-- Test case list -->
				<div class="tc-list">
					<div
						v-for="tc in testCases"
						:key="tc.id"
						class="tc-row"
						:class="{
							'tc-row--passed': testResults[tc.id]?.passed === true,
							'tc-row--failed': testResults[tc.id]?.passed === false,
						}"
					>
						<div class="tc-row-main">
							<span
								v-if="tc.id in testResults"
								class="tc-badge"
								:class="testResults[tc.id].passed ? 'tc-badge--pass' : 'tc-badge--fail'"
							>
								{{ testResults[tc.id].passed ? 'PASS' : 'FAIL' }}
							</span>
							<span class="tc-name">{{ tc.name }}</span>
							<span v-if="tc.expected_outputs && Object.keys(tc.expected_outputs).length > 0" class="tc-expected-count">
								{{ Object.keys(tc.expected_outputs).length }} expected
							</span>
							<div class="tc-row-actions">
								<v-button
									x-small
									secondary
									:loading="runningSingleId === tc.id"
									:disabled="!isDeployed"
									@click="handleRunSingle(tc.id)"
								>
									<v-icon name="play_arrow" small />
								</v-button>
								<v-button x-small secondary @click="handleLoadTestCase(tc.id)">
									<v-icon name="edit" small />
								</v-button>
								<v-button x-small secondary @click="handleDeleteTestCase(tc.id)">
									<v-icon name="delete" small />
								</v-button>
							</div>
						</div>

						<!-- Diff display for failed tests -->
						<div v-if="testResults[tc.id]?.passed === false" class="tc-diff">
							<div v-if="testResults[tc.id].error" class="tc-diff-error">
								{{ testResults[tc.id].error }}
							</div>
							<table v-else-if="Object.keys(testResults[tc.id].diff).length > 0" class="diff-table">
								<thead>
									<tr>
										<th>Field</th>
										<th>Expected</th>
										<th>Actual</th>
									</tr>
								</thead>
								<tbody>
									<tr v-for="(entry, key) in testResults[tc.id].diff" :key="key">
										<td class="diff-field">{{ key }}</td>
										<td class="diff-expected">{{ entry.expected }}</td>
										<td class="diff-actual">{{ entry.actual }}</td>
									</tr>
								</tbody>
							</table>
							<div v-else class="tc-diff-error">Execution failed — no diff available.</div>
						</div>
					</div>
				</div>
			</div>
			<div v-else-if="testCases.length === 0 && isDeployed" class="saved-tests-empty">
				<v-button small secondary @click="showAddTestCase = true">
					<v-icon name="add" left small />
					Save current inputs as test case
				</v-button>
			</div>

			<!-- Bottom bar -->
			<div class="bottom-bar">
				<div class="bar-left">
					<div class="tc-save-group">
						<input
							v-model="testCaseName"
							placeholder="Test case name…"
							class="tc-name-input"
						/>
						<button
							class="tc-save-btn"
							:title="selectedTestCaseId ? 'Update test case' : 'Save test case'"
							:disabled="!testCaseName.trim() || savingTestCase"
							@click="handleSaveTestCase"
						>
							<v-icon name="save" small />
						</button>
					</div>
				</div>
				<div class="bar-right">
					<label
						class="compare-toggle"
						:class="{ disabled: !hasLiveConfig }"
						:title="hasLiveConfig ? '' : 'No live config deployed'"
					>
						<v-checkbox
							:model-value="compareEnabled"
							:disabled="!hasLiveConfig"
							@update:model-value="compareEnabled = $event"
						/>
						Compare with live
					</label>
					<div v-if="testCases.length > 0" class="tc-dropdown-wrapper">
						<button class="tc-dropdown-trigger" @click="tcDropdownOpen = !tcDropdownOpen">
							{{ selectedTestCaseName || 'Test cases' }}
							<v-icon name="expand_more" small />
						</button>
						<div v-if="tcDropdownOpen" class="tc-dropdown-menu">
							<div
								v-for="tc in testCases"
								:key="tc.id"
								class="tc-dropdown-item"
								:class="{ active: tc.id === selectedTestCaseId }"
							>
								<button class="tc-item-name" @click="handleLoadTestCase(tc.id); tcDropdownOpen = false">
									{{ tc.name }}
								</button>
								<button
									class="tc-item-delete"
									@click.stop="handleDeleteTestCase(tc.id)"
								>
									Delete
								</button>
							</div>
						</div>
					</div>
					<v-button
						:loading="executing"
						:disabled="!isDeployed"
						@click="handleCalculate"
					>
						<v-icon name="play_arrow" left />
						Calculate
					</v-button>
				</div>
			</div>
		</div>

		<div v-else-if="loading" class="module-loading">
			<v-progress-circular indeterminate />
		</div>

		<template #sidebar>
			<sidebar-detail icon="info" title="Information" close>
				<div class="sidebar-info">
					<p v-if="current">
						Test execution for <strong>{{ current.name }}</strong>.
					</p>
					<p v-else>Select a calculator to test.</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import { useCalculators } from '../composables/use-calculators';
import { useActiveAccount } from '../composables/use-active-account';
import { useSubscription } from '../composables/use-subscription';
import CalculatorNavigation from '../components/navigation.vue';
import { formatValue, toLogicalType } from '../utils/param-transforms';
import { extractErrorMessage } from '../utils/error';

const api = useApi();
const route = useRoute();
const router = useRouter();

const {
	calculators, current, testCases, loading, saving,
	fetchAll, fetchOne, create,
	deployConfig, executeConfig,
	enableTest,
	fetchTestCases, createTestCase, updateTestCase, deleteTestCase,
	runAllTests, runSingleTest,
	launchConfig, activateCalc, updateConfig,
} = useCalculators(api);

const { fetchSubscriptionInfo } = useSubscription(api);

const { activeAccountId, fetchActiveAccount } = useActiveAccount(api);

const isTestActive = computed(() => {
	if (!current.value?.test_expires_at) return false;
	return new Date(current.value.test_expires_at) > new Date();
});

const inputValues = ref<Record<string, unknown>>({});
const validationErrors = ref<Record<string, string>>({});
const activeTab = ref<'request' | 'response' | 'output'>('output');
const requestPayload = ref<Record<string, unknown> | null>(null);
const responseData = ref<unknown>(null);
const liveResponseData = ref<unknown>(null);
const execError = ref<string | null>(null);
const executing = ref(false);
const deploying = ref(false);
const compareEnabled = ref(false);
const testCaseName = ref('');
const selectedTestCaseId = ref<string | null>(null);
const savingTestCase = ref(false);
const tcDropdownOpen = ref(false);
const showGoLiveDialog = ref(false);
const publishing = ref(false);

// Test management state
const expectedOutputValues = ref<Record<string, unknown>>({});
const runningAll = ref(false);
const runningSingleId = ref<string | null>(null);
const testResults = ref<Record<string, { passed: boolean; actual: Record<string, unknown>; diff: Record<string, { expected: unknown; actual: unknown }>; error?: string | null }>>({});
const showAddTestCase = ref(false);

const currentId = computed(() => (route.params.id as string) || null);

// viewTitle removed — title is static "Test", calculator name in #headline breadcrumb

const testConfig = computed(
	() => current.value?.configs?.find((c) => c.test_environment) || null,
);

const hasExcel = computed(() => !!testConfig.value?.excel_file);

const hasConfig = computed(() => {
	const input = testConfig.value?.input as any;
	const p = input?.properties || input;
	return !!(p && typeof p === 'object' && Object.keys(p).length > 0);
});

const prodConfig = computed(
	() => current.value?.configs?.find((c) => !c.test_environment) || null,
);

const isDeployed = computed(() => {
	const c = testConfig.value;
	return !!(c?.sheets && c?.formulas && c?.input && c?.output);
});

const unresolvedFunctions = computed(() => testConfig.value?.unresolved_functions || null);


const hasLiveConfig = computed(() => {
	const c = prodConfig.value;
	return !!(c?.sheets && c?.formulas && c?.input && c?.output);
});

const canGoLive = computed(() => {
	if (!isDeployed.value) return false;
	if (hasLiveConfig.value && testVersion.value === liveVersion.value) return false;
	return true;
});

const testPageTitle = computed(() => {
	if (!testConfig.value) return 'Test';
	return `Test ${testVersion.value}`;
});

const testVersion = computed(() => {
	const c = testConfig.value;
	return c?.config_version != null ? `${c.config_version}.${c.file_version || 0}` : 'test';
});
const liveVersion = computed(() => {
	const c = prodConfig.value;
	return c?.config_version != null ? `${c.config_version}.${c.file_version || 0}` : 'live';
});

const selectedTestCaseName = computed(() => {
	if (!selectedTestCaseId.value) return null;
	return testCases.value.find((t) => t.id === selectedTestCaseId.value)?.name || null;
});

const inputParams = computed(() => {
	if (!testConfig.value?.input) return [];
	const raw = testConfig.value.input as any;
	const props = raw?.properties || raw;
	if (!props || typeof props !== 'object') return [];

	const requiredKeys: string[] = Array.isArray(raw?.required) ? raw.required : [];
	const orderKeys: string[] = Array.isArray(raw?.order) ? raw.order : [];

	const entries = Object.entries(props).map(([key, param]: [string, any]) => {
		const logical = toLogicalType(param);
		return {
			key,
			...logical,
			required: logical.required || requiredKeys.includes(key),
			order: orderKeys.length > 0 ? (orderKeys.indexOf(key) >= 0 ? orderKeys.indexOf(key) : 999) : (logical.order ?? 999),
		};
	});

	entries.sort((a: any, b: any) => a.order - b.order);
	return entries;
});

const outputParams = computed(() => {
	if (!testConfig.value?.output) return [];
	const raw = testConfig.value.output as any;
	const props = raw?.properties || raw;
	if (!props || typeof props !== 'object') return [];
	return Object.entries(props).map(([key, param]: [string, any]) => ({
		key,
		...param,
	}));
});

function isObjectArray(val: unknown): val is Array<Record<string, unknown>> {
	return Array.isArray(val) && val.length > 0 && val.every((item) => item && typeof item === 'object' && !Array.isArray(item));
}

interface OutputRow {
	key: string;
	label: string;
	value: string;
	liveValue: string | null;
	indent?: boolean;
	group?: boolean;
	divider?: boolean;
}

function expandObjectArray(paramKey: string, paramTitle: string, arr: Array<Record<string, unknown>>, liveArr: Array<Record<string, unknown>> | null, itemTitles: Record<string, string>): OutputRow[] {
	const rows: OutputRow[] = [];
	rows.push({ key: paramKey, label: paramTitle, value: '', liveValue: null, group: true });
	for (let i = 0; i < arr.length; i++) {
		if (i > 0) {
			rows.push({ key: `${paramKey}_div_${i}`, label: '', value: '', liveValue: null, divider: true });
		}
		const obj = arr[i];
		const liveObj = liveArr?.[i] || null;
		for (const [k, v] of Object.entries(obj)) {
			rows.push({
				key: `${paramKey}_${i}_${k}`,
				label: itemTitles[k] || k,
				value: formatValue(v),
				liveValue: liveObj ? formatValue(liveObj[k]) : null,
				indent: true,
			});
		}
	}
	return rows;
}

const outputRows = computed(() => {
	if (!responseData.value || outputParams.value.length === 0) return [];
	const data = responseData.value as Record<string, unknown>;
	const live = liveResponseData.value as Record<string, unknown> | null;
	const rows: OutputRow[] = [];

	for (const param of outputParams.value) {
		const val = data[param.key];
		const liveVal = live?.[param.key];

		if (isObjectArray(val)) {
			const liveArr = isObjectArray(liveVal) ? liveVal : null;
			const itemProps = param.items?.properties as Record<string, any> | undefined;
			const itemTitles: Record<string, string> = {};
			if (itemProps) {
				for (const [k, v] of Object.entries(itemProps)) {
					if (v?.title) itemTitles[k] = v.title;
				}
			}
			rows.push(...expandObjectArray(param.key, param.title || param.key, val, liveArr, itemTitles));
		} else {
			rows.push({
				key: param.key,
				label: param.title || param.key,
				value: formatValue(val),
				liveValue: live ? formatValue(liveVal) : null,
			});
		}
	}
	return rows;
});

async function handleDeploy() {
	if (!testConfig.value || !currentId.value) return;
	deploying.value = true;
	execError.value = null;
	try {
		await deployConfig(currentId.value, true);
	} catch (err: any) {
		execError.value = extractErrorMessage(err, 'Deploy failed');
	} finally {
		deploying.value = false;
	}
}

async function handleGoLive() {
	if (!currentId.value || !testConfig.value) return;
	publishing.value = true;
	execError.value = null;
	try {
		await launchConfig(currentId.value, testConfig.value);
		await activateCalc(currentId.value);
		await fetchSubscriptionInfo();
		await fetchAll(activeAccountId.value);
		showGoLiveDialog.value = false;
	} catch (err: any) {
		execError.value = extractErrorMessage(err, 'Publish failed');
	} finally {
		publishing.value = false;
	}
}

function validateInputs(): boolean {
	const errors: Record<string, string> = {};
	for (const param of inputParams.value) {
		if (param.required) {
			const val = inputValues.value[param.key];
			if (val == null || val === '') {
				errors[param.key] = `${param.title || param.key} is required`;
			}
		}
	}
	validationErrors.value = errors;
	return Object.keys(errors).length === 0;
}

async function handleCalculate() {
	if (!testConfig.value || !currentId.value) return;
	if (!validateInputs()) return;
	executing.value = true;
	execError.value = null;
	requestPayload.value = { ...inputValues.value };
	responseData.value = null;
	liveResponseData.value = null;
	try {
		// Auto-enable test window if not active
		if (!isTestActive.value) {
			await enableTest(currentId.value);
		}

		const payload = { ...requestPayload.value };
		const promises: Promise<unknown>[] = [
			executeConfig(currentId.value, true, payload),
		];
		if (compareEnabled.value && prodConfig.value) {
			promises.push(executeConfig(currentId.value, false, payload));
		}
		const results = await Promise.all(promises);
		responseData.value = results[0];
		if (results.length > 1) liveResponseData.value = results[1];
		activeTab.value = 'output';
	} catch (err: any) {
		execError.value = extractErrorMessage(err, 'Execution failed');
		activeTab.value = 'response';
	} finally {
		executing.value = false;
	}
}

async function handleSaveTestCase() {
	if (!currentId.value || !testCaseName.value.trim()) return;
	savingTestCase.value = true;
	try {
		const payload: Record<string, unknown> = {
			name: testCaseName.value.trim(),
			input: { ...inputValues.value },
			calculator: currentId.value,
		};
		// Capture current response as expected outputs if present
		if (responseData.value && typeof responseData.value === 'object') {
			payload.expected_outputs = { ...(responseData.value as Record<string, unknown>) };
		}
		if (selectedTestCaseId.value) {
			await updateTestCase(selectedTestCaseId.value, payload);
		} else {
			const created = await createTestCase(payload);
			if (created) selectedTestCaseId.value = created.id;
		}
	} catch (err: any) {
		execError.value = extractErrorMessage(err, 'Save failed');
	} finally {
		savingTestCase.value = false;
	}
}

function handleLoadTestCase(id: string | null) {
	selectedTestCaseId.value = id;
	if (!id) {
		testCaseName.value = '';
		expectedOutputValues.value = {};
		return;
	}
	const tc = testCases.value.find((t) => t.id === id);
	if (!tc) return;
	testCaseName.value = tc.name;
	if (tc.input && typeof tc.input === 'object') {
		inputValues.value = { ...tc.input };
	}
	if (tc.expected_outputs && typeof tc.expected_outputs === 'object') {
		expectedOutputValues.value = { ...tc.expected_outputs };
	} else {
		expectedOutputValues.value = {};
	}
}

async function handleDeleteTestCase(id: string) {
	if (!currentId.value) return;
	try {
		await deleteTestCase(id, currentId.value);
		if (selectedTestCaseId.value === id) {
			selectedTestCaseId.value = null;
			testCaseName.value = '';
		}
	} catch (err: any) {
		execError.value = extractErrorMessage(err, 'Delete failed');
	}
}

async function handleRunAll() {
	if (!currentId.value || !isDeployed.value) return;
	runningAll.value = true;
	execError.value = null;
	try {
		if (!isTestActive.value) await enableTest(currentId.value);
		const results = await runAllTests(currentId.value, true);
		const map: typeof testResults.value = {};
		for (const r of results) {
			map[r.id] = { passed: r.passed, actual: r.actual, diff: r.diff, error: r.error };
		}
		testResults.value = map;
	} catch (err: any) {
		execError.value = extractErrorMessage(err, 'Run all failed');
	} finally {
		runningAll.value = false;
	}
}

async function handleRunSingle(id: string) {
	if (!currentId.value || !isDeployed.value) return;
	runningSingleId.value = id;
	execError.value = null;
	try {
		if (!isTestActive.value) await enableTest(currentId.value);
		const r = await runSingleTest(currentId.value, true, id);
		testResults.value = {
			...testResults.value,
			[id]: { passed: r.passed, actual: r.actual, diff: r.diff, error: r.error },
		};
	} catch (err: any) {
		execError.value = extractErrorMessage(err, 'Run failed');
	} finally {
		runningSingleId.value = null;
	}
}

async function handleSaveNewTestCase() {
	if (!currentId.value || !testCaseName.value.trim()) return;
	savingTestCase.value = true;
	try {
		const payload = {
			name: testCaseName.value.trim(),
			input: { ...inputValues.value },
			expected_outputs: Object.keys(expectedOutputValues.value).length > 0 ? { ...expectedOutputValues.value } : null,
			tolerance: null,
			calculator: currentId.value,
		};
		await createTestCase(payload);
		testCaseName.value = '';
		expectedOutputValues.value = {};
		showAddTestCase.value = false;
	} catch (err: any) {
		execError.value = extractErrorMessage(err, 'Save failed');
	} finally {
		savingTestCase.value = false;
	}
}

function prefillDefaults() {
	const defaults: Record<string, unknown> = {};
	for (const param of inputParams.value) {
		if (param.default != null) {
			defaults[param.key] = param.default;
		}
	}
	inputValues.value = defaults;
}

async function handleCreate() {
	const id = crypto.randomUUID();

	let accountId: string | null = null;
	try {
		const { data } = await api.get('/items/account');
		accountId = data.data?.id || null;
	} catch {
		// account may not exist yet
	}

	const created = await create({ id, name: null, account: accountId, onboarded: false });
	if (created) {
		router.push(`/calculators/${created.id}`);
	}
}

function onClickOutside(e: MouseEvent) {
	const wrapper = (e.target as HTMLElement)?.closest('.tc-dropdown-wrapper');
	if (!wrapper) tcDropdownOpen.value = false;
}

onMounted(() => document.addEventListener('click', onClickOutside));
onUnmounted(() => document.removeEventListener('click', onClickOutside));

fetchActiveAccount().then(() => {
	fetchAll(activeAccountId.value);
});

watch(activeAccountId, (id) => { fetchAll(id); });

watch(currentId, (id) => {
	requestPayload.value = null;
	responseData.value = null;
	liveResponseData.value = null;
	execError.value = null;
	selectedTestCaseId.value = null;
	testCaseName.value = '';
	expectedOutputValues.value = {};
	testResults.value = {};
	if (id) {
		fetchOne(id);
		fetchTestCases(id);
	}
}, { immediate: true });

watch(inputValues, () => {
	if (Object.keys(validationErrors.value).length > 0) validationErrors.value = {};
}, { deep: true });

// Only prefill when input param keys actually change (not on every refetch)
const inputParamKeys = computed(() => inputParams.value.map((p) => p.key).join(','));
watch(inputParamKeys, () => {
	prefillDefaults();
}, { immediate: true });
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.test-content {
	padding: var(--content-padding);
	padding-bottom: 0;
}

.deploy-notice {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 16px;
	background: var(--theme--warning-background);
	border-radius: var(--theme--border-radius);
	margin-bottom: 16px;
	font-size: 14px;
}

.unresolved-notice {
	margin-bottom: 16px;
}

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

.input-panel {
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

.required-mark {
	color: var(--theme--danger, #e35169);
}

.param-error {
	font-size: 12px;
	color: var(--theme--danger, #e35169);
}

.has-error :deep(.v-input),
.has-error :deep(.v-select) {
	--v-input-border-color: var(--theme--danger, #e35169);
}

.no-params {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
}

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

.output-table .group-header td {
	font-weight: 600;
	color: var(--theme--foreground);
	padding-top: 16px;
	padding-bottom: 6px;
	border-bottom: none;
	vertical-align: top;
}

.output-table .divider-row td {
	padding: 0;
	border-bottom: 2px solid var(--theme--border-color);
}

.output-table .indent-row td {
	border-bottom: none;
}

.output-table .indent-row td:first-child {
	padding-left: 24px;
	color: var(--theme--foreground-subdued);
	font-weight: 500;
	text-align: right;
}

.output-table .indent-row td:not(:first-child) {
	text-align: right;
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

.compare-subtitle {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin-bottom: 12px;
}

.value-diff {
	color: var(--theme--warning);
	font-weight: 600;
}

.bottom-bar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	padding: 16px 0;
	border-top: var(--theme--border-width) solid var(--theme--border-color);
	margin-top: 24px;
	position: sticky;
	bottom: 0;
	background: var(--theme--background);
	z-index: 5;
}

.bar-left {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}

.bar-right {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-shrink: 0;
}

.tc-save-group {
	display: flex;
	height: 44px;
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
	transition: border-color 0.15s;
}

.tc-save-group:focus-within {
	border-color: var(--theme--primary);
}

.tc-name-input {
	min-width: 160px;
	width: 200px;
	height: 100%;
	padding: 0 12px;
	font-size: 14px;
	background: var(--theme--background);
	border: none;
	outline: none;
	color: var(--theme--foreground);
}

.tc-name-input::placeholder {
	color: var(--theme--foreground-subdued);
}

.tc-save-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 42px;
	flex-shrink: 0;
	background: var(--theme--background-subdued);
	border: none;
	border-left: var(--theme--border-width) solid var(--theme--border-color);
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	transition: color 0.15s, background 0.15s;
}

.tc-save-btn:hover:not(:disabled) {
	color: var(--theme--foreground);
	background: var(--theme--background-accent);
}

.tc-save-btn:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}

.compare-toggle {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 14px;
	white-space: nowrap;
	cursor: pointer;
}

.compare-toggle.disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

/* Test case dropdown */
.tc-dropdown-wrapper {
	position: relative;
}

.tc-dropdown-trigger {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 0 12px;
	height: 44px;
	font-size: 14px;
	font-weight: 600;
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	cursor: pointer;
	color: var(--theme--foreground);
	white-space: nowrap;
	transition: border-color 0.15s;
}

.tc-dropdown-trigger:hover {
	border-color: var(--theme--foreground-subdued);
}

.tc-dropdown-menu {
	position: absolute;
	bottom: calc(100% + 6px);
	right: 0;
	min-width: 200px;
	background: var(--theme--background);
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
	overflow: hidden;
	z-index: 10;
}

.tc-dropdown-item {
	display: flex;
	align-items: center;
}

.tc-dropdown-item.active {
	background: var(--theme--primary-background);
}

.tc-item-name {
	flex: 1;
	padding: 10px 12px;
	font-size: 14px;
	background: none;
	border: none;
	cursor: pointer;
	text-align: left;
	color: var(--theme--foreground);
}

.tc-item-name:hover {
	background: var(--theme--background-subdued);
}

.tc-item-delete {
	padding: 10px 12px;
	font-size: 12px;
	font-weight: 600;
	color: var(--theme--danger);
	background: none;
	border: none;
	border-left: var(--theme--border-width) solid var(--theme--border-color);
	cursor: pointer;
	white-space: nowrap;
}

.tc-item-delete:hover {
	background: var(--theme--danger-background);
}

.prerequisite-notice {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: var(--content-padding);
	height: 400px;
	gap: 24px;
}

.prerequisite-action {
	display: flex;
	justify-content: center;
}

.param-title-value {
	float: right;
	font-variant-numeric: tabular-nums;
	color: var(--theme--primary);
}

.slider-input {
	display: flex;
	flex-direction: column;
	gap: 0;
}

.slider {
	width: 100%;
	-webkit-appearance: none;
	appearance: none;
	height: 6px;
	border-radius: 3px;
	background: var(--theme--border-color);
	outline: none;
}

.slider::-webkit-slider-thumb {
	-webkit-appearance: none;
	appearance: none;
	width: 18px;
	height: 18px;
	border-radius: 50%;
	background: var(--theme--primary);
	cursor: pointer;
	border: 2px solid var(--theme--background);
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.slider::-moz-range-thumb {
	width: 18px;
	height: 18px;
	border-radius: 50%;
	background: var(--theme--primary);
	cursor: pointer;
	border: 2px solid var(--theme--background);
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.slider-bounds {
	display: flex;
	justify-content: space-between;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	margin-top: 4px;
}

.input-affix {
	color: var(--theme--foreground-subdued);
	font-weight: 500;
}

.currency-label {
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	white-space: nowrap;
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

/* Saved test cases section */
.saved-tests-section {
	margin-top: 28px;
	border-top: var(--theme--border-width) solid var(--theme--border-color);
	padding-top: 20px;
}

.saved-tests-empty {
	margin-top: 16px;
	padding: 16px 0;
}

.saved-tests-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 12px;
}

.saved-tests-title {
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.saved-tests-actions {
	display: flex;
	gap: 8px;
}

.add-tc-form {
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 16px;
	margin-bottom: 16px;
}

.add-tc-fields {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-bottom: 12px;
}

.add-tc-hint {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	margin: 0;
}

.add-tc-footer {
	display: flex;
	gap: 8px;
	justify-content: flex-end;
}

.tc-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.tc-row {
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

.tc-row--passed {
	border-color: var(--theme--success);
}

.tc-row--failed {
	border-color: var(--theme--danger);
}

.tc-row-main {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 12px;
	background: var(--theme--background);
}

.tc-badge {
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.5px;
	padding: 2px 7px;
	border-radius: 4px;
	flex-shrink: 0;
}

.tc-badge--pass {
	background: var(--theme--success-background, #e8f5e9);
	color: var(--theme--success, #4caf50);
}

.tc-badge--fail {
	background: var(--theme--danger-background, #fce4ec);
	color: var(--theme--danger, #e35169);
}

.tc-name {
	flex: 1;
	font-size: 14px;
	font-weight: 500;
	color: var(--theme--foreground);
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.tc-expected-count {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	flex-shrink: 0;
}

.tc-row-actions {
	display: flex;
	gap: 4px;
	flex-shrink: 0;
}

.tc-diff {
	padding: 12px;
	background: var(--theme--danger-background, #fce4ec);
	border-top: var(--theme--border-width) solid var(--theme--border-color);
}

.tc-diff-error {
	font-size: 13px;
	color: var(--theme--danger, #e35169);
	font-weight: 500;
}

.diff-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 13px;
}

.diff-table th,
.diff-table td {
	padding: 6px 10px;
	text-align: left;
	border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.diff-table th {
	font-weight: 600;
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: var(--theme--foreground-subdued);
}

.diff-field {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	color: var(--theme--foreground);
}

.diff-expected {
	color: var(--theme--success, #4caf50);
	font-family: var(--theme--fonts--monospace--font-family, monospace);
}

.diff-actual {
	color: var(--theme--danger, #e35169);
	font-family: var(--theme--fonts--monospace--font-family, monospace);
}
</style>
