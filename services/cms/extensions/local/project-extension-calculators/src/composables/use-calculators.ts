import { ref } from 'vue';
import type { Calculator, CalculatorConfig, CalculatorTemplate, CalculatorTestCase, TestCaseResult } from '../types';

/** Build the Formula API calc ID: "{calculatorId}-test" or "{calculatorId}" */
function calcId(calculatorId: string, isTest: boolean): string {
	return isTest ? `${calculatorId}-test` : calculatorId;
}

// ── Module-scoped shared state ──
const calculators = ref<Calculator[]>([]);
const current = ref<Calculator | null>(null);
const templates = ref<CalculatorTemplate[]>([]);
const testCases = ref<CalculatorTestCase[]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
let lastAccountId: string | null | undefined = undefined;
let fetchedOnce = false;

export function useCalculators(api: any) {

	async function fetchAll(accountId?: string | null, force = false) {
		if (!force && fetchedOnce && accountId === lastAccountId) return;
		loading.value = true;
		error.value = null;
		try {
			const params: any = {
				sort: ['sort', 'name'],
				fields: ['id', 'name', 'sort', 'date_updated', 'activated', 'onboarded', 'test_expires_at', 'over_limit', 'activation_expires_at', 'icon'],
			};
			if (accountId) {
				params.filter = { account: { _eq: accountId } };
			}
			const { data } = await api.get('/items/calculators', { params });
			calculators.value = data.data;
			lastAccountId = accountId;
			fetchedOnce = true;
		} catch (err: any) {
			error.value = err.message;
		} finally {
			loading.value = false;
		}
	}

	async function fetchTemplates() {
		try {
			const { data } = await api.get('/items/calculator_templates', {
				params: {
					sort: ['sort', 'name'],
					fields: ['id', 'name', 'description', 'icon', 'sheets', 'formulas', 'input', 'output', 'sort', 'featured', 'industry'],
				},
			});
			templates.value = data.data;
		} catch {
			// silently fail — templates are optional
		}
	}

	async function fetchOne(id: string) {
		loading.value = true;
		error.value = null;
		try {
			const { data } = await api.get(`/items/calculators/${id}`, {
				params: {
					fields: ['*', 'configs.*', 'configs.excel_file.*'],
				},
			});
			current.value = data.data;
		} catch (err: any) {
			error.value = err.message;
			current.value = null;
		} finally {
			loading.value = false;
		}
	}

	async function create(data: Partial<Calculator>) {
		saving.value = true;
		error.value = null;
		try {
			const { data: res } = await api.post('/items/calculators', data);
			await fetchAll(lastAccountId, true);
			return res.data;
		} catch (err: any) {
			error.value = err.message;
			throw err;
		} finally {
			saving.value = false;
		}
	}

	async function update(id: string, data: Partial<Calculator>) {
		saving.value = true;
		error.value = null;
		try {
			await api.patch(`/items/calculators/${id}`, data);
			const effectiveId = (data as any).id || id;
			await fetchAll(lastAccountId, true);
			await fetchOne(effectiveId);
		} catch (err: any) {
			error.value = err.message;
			throw err;
		} finally {
			saving.value = false;
		}
	}

	async function remove(id: string) {
		saving.value = true;
		error.value = null;
		try {
			// Optimistically remove from list
			calculators.value = calculators.value.filter((c) => c.id !== id);
			current.value = null;
			await api.delete(`/items/calculators/${id}`);
			await fetchAll(lastAccountId, true);
		} catch (err: any) {
			error.value = err.message;
			throw err;
		} finally {
			saving.value = false;
		}
	}

	async function createConfig(calculatorId: string, data: Partial<CalculatorConfig>) {
		saving.value = true;
		error.value = null;
		try {
			const { data: res } = await api.post('/items/calculator_configs', {
				...data,
				calculator: calculatorId,
			});
			await fetchOne(calculatorId);
			return res.data;
		} catch (err: any) {
			error.value = err.message;
			throw err;
		} finally {
			saving.value = false;
		}
	}

	async function updateConfig(configId: string, calculatorId: string, data: Partial<CalculatorConfig>) {
		saving.value = true;
		error.value = null;
		try {
			await api.patch(`/items/calculator_configs/${configId}`, data);
			await fetchOne(calculatorId);
		} catch (err: any) {
			error.value = err.message;
			throw err;
		} finally {
			saving.value = false;
		}
	}

	async function uploadExcelFile(file: File): Promise<string> {
		const formData = new FormData();
		formData.append('file', file);
		const { data } = await api.post('/files', formData, {
			headers: { 'Content-Type': 'multipart/form-data' },
		});
		return data.data.id;
	}

	async function parseExcel(file: File): Promise<{ sheets: Record<string, unknown> | null; formulas: Record<string, unknown>[] | null; expressions: { name: string; expression: string; scope?: string }[] | null; profile: Record<string, unknown> | null }> {
		const formData = new FormData();
		formData.append('file', file);
		const { data } = await api.post('/parse/xlsx', formData, {
			headers: { 'Content-Type': 'multipart/form-data' },
		});
		return {
			sheets: data.sheets || null,
			formulas: data.formulas || null,
			expressions: data.expressions || null,
			profile: data.profile || null,
		};
	}

	/** Deploy config to Formula API (or re-sync if already deployed) */
	async function deployConfig(calculatorId: string, isTest: boolean) {
		saving.value = true;
		error.value = null;
		try {
			const { data: res } = await api.post(`/calc/deploy/${calcId(calculatorId, isTest)}`);
			await fetchOne(calculatorId);
			return res;
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message;
			throw err;
		} finally {
			saving.value = false;
		}
	}

	/** Remove config from Formula API */
	async function undeployConfig(calculatorId: string, isTest: boolean) {
		saving.value = true;
		error.value = null;
		try {
			await api.delete(`/calc/remove/${calcId(calculatorId, isTest)}`);
			await fetchOne(calculatorId);
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message;
			throw err;
		} finally {
			saving.value = false;
		}
	}

	/** Execute calculator with input values */
	async function executeConfig(calculatorId: string, isTest: boolean, input: Record<string, unknown>) {
		error.value = null;
		try {
			const { data } = await api.post(`/calc/execute/${calcId(calculatorId, isTest)}`, input);
			return data;
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message;
			throw err;
		}
	}

	/** Get calculator description from Formula API */
	async function describeConfig(calculatorId: string, isTest: boolean) {
		error.value = null;
		try {
			const { data } = await api.get(`/calc/describe/${calcId(calculatorId, isTest)}`);
			return data;
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message;
			throw err;
		}
	}

	/** Fetch the Formula API base URL from server */
	async function fetchFormulaApiUrl(): Promise<string> {
		const { data } = await api.get('/calc/formula-api-url');
		return data.url;
	}

	async function launchConfig(calculatorId: string, testConfig: CalculatorConfig) {
		const configs = current.value?.configs || [];
		const prodConfig = configs.find((c) => !c.test_environment);

		const payload: Partial<CalculatorConfig> = {
			description: testConfig.description,
			excel_file: typeof testConfig.excel_file === 'object' && testConfig.excel_file
				? testConfig.excel_file.id
				: testConfig.excel_file,
			sheets: testConfig.sheets,
			formulas: testConfig.formulas,
			input: testConfig.input,
			output: testConfig.output,
			file_version: testConfig.file_version,
			config_version: testConfig.config_version,
			test_environment: false,
			mcp: testConfig.mcp,
			integration: testConfig.integration,
			expressions: testConfig.expressions,
			profile: testConfig.profile,
		};

		if (prodConfig) {
			await updateConfig(prodConfig.id, calculatorId, payload);
		} else {
			await createConfig(calculatorId, payload);
		}
	}

	async function fetchTestCases(calculatorId: string) {
		try {
			const { data } = await api.get('/items/calculator_test_cases', {
				params: {
					filter: { calculator: { _eq: calculatorId } },
					sort: ['sort', 'name'],
					fields: ['id', 'name', 'input', 'expected_outputs', 'tolerance', 'sort', 'calculator'],
				},
			});
			testCases.value = data.data;
		} catch {
			testCases.value = [];
		}
	}

	/** Run all test cases for a calculator (batch) */
	async function runAllTests(calculatorId: string, isTest: boolean): Promise<Array<{ id: string; name: string } & TestCaseResult>> {
		const calcApiId = calcId(calculatorId, isTest);
		const { data } = await api.post(`/calc/test/${calcApiId}`);
		return data.results;
	}

	/** Run a single test case */
	async function runSingleTest(calculatorId: string, isTest: boolean, testCaseId: string): Promise<{ id: string; name: string } & TestCaseResult> {
		const calcApiId = calcId(calculatorId, isTest);
		const { data } = await api.post(`/calc/test/${calcApiId}/${testCaseId}`);
		return data;
	}

	async function createTestCase(payload: Partial<CalculatorTestCase>) {
		await api.post('/items/calculator_test_cases', payload);
		if (payload.calculator) await fetchTestCases(payload.calculator);
		// Return the newly created item from the refreshed list
		const match = testCases.value.find((tc) => tc.name === payload.name);
		return match || null;
	}

	async function updateTestCase(id: string, data: Partial<CalculatorTestCase>) {
		await api.patch(`/items/calculator_test_cases/${id}`, data);
		if (data.calculator) await fetchTestCases(data.calculator);
	}

	async function deleteTestCase(id: string, calculatorId: string) {
		await api.delete(`/items/calculator_test_cases/${id}`);
		await fetchTestCases(calculatorId);
	}

	/** Download annotated Excel via Formula API */
	async function downloadExcel(configId: string, filename: string) {
		const { data } = await api.post('/calc/generate-xlsx', { config_id: configId }, { responseType: 'blob' });
		const url = URL.createObjectURL(data);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	/** Enable 6h test window */
	async function enableTest(calculatorId: string) {
		error.value = null;
		try {
			const { data } = await api.post(`/calc/enable-test/${calcId(calculatorId, true)}`);
			await fetchOne(calculatorId);
			return data;
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message;
			throw err;
		}
	}

	/** Disable test window */
	async function disableTest(calculatorId: string) {
		error.value = null;
		try {
			const { data } = await api.post(`/calc/disable-test/${calcId(calculatorId, true)}`);
			await fetchOne(calculatorId);
			return data;
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message;
			throw err;
		}
	}

	/** Activate calculator (server checks subscription limit).
	 *  Returns { activated, over_limit, activation_expires_at }.
	 *  Does NOT re-fetch — caller should update() through Directus to invalidate cache. */
	async function activateCalc(calculatorId: string) {
		error.value = null;
		try {
			const { data } = await api.post(`/calc/activate/${calculatorId}`);
			return data;
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message;
			throw err;
		}
	}

	return {
		calculators,
		current,
		templates,
		testCases,
		loading,
		saving,
		error,
		fetchAll,
		fetchOne,
		fetchTemplates,
		create,
		update,
		remove,
		createConfig,
		updateConfig,
		uploadExcelFile,
		parseExcel,
		deployConfig,
		undeployConfig,
		executeConfig,
		describeConfig,
		launchConfig,
		fetchFormulaApiUrl,
		fetchTestCases,
		createTestCase,
		updateTestCase,
		deleteTestCase,
		runAllTests,
		runSingleTest,
		enableTest,
		disableTest,
		activateCalc,
		downloadExcel,
	};
}
