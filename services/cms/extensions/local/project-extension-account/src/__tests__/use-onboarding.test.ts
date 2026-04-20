import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOnboarding } from '../composables/use-onboarding';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeMeta(onboarding_state: Record<string, any> | undefined = undefined) {
	return {
		data: {
			data: {
				metadata: onboarding_state !== undefined ? { onboarding_state } : {},
			},
		},
	};
}

function makeApi(overrides: { getMeta?: any; postFn?: any } = {}) {
	const postFn = overrides.postFn ?? vi.fn().mockResolvedValue({ data: { ok: true, onboarding_state: {} } });
	const getMeta = overrides.getMeta ?? {};
	const getFn = vi.fn().mockResolvedValue(makeMeta(getMeta));
	return { api: { get: getFn, post: postFn }, getFn, postFn };
}

// ─── needsWizard ──────────────────────────────────────────────────────────────

describe('useOnboarding: needsWizard', () => {
	it('true when both first_module_activated_at and wizard_completed_at are null', () => {
		const { api } = makeApi();
		const { needsWizard } = useOnboarding(api);
		expect(needsWizard.value).toBe(true);
	});

	it('false when first_module_activated_at is set', async () => {
		const { api, getFn } = makeApi({
			getMeta: {
				first_module_activated_at: '2026-01-01T00:00:00Z',
				wizard_completed_at: null,
				intent_captured: null,
			},
		});
		const { needsWizard, fetchOnboardingState } = useOnboarding(api);
		await fetchOnboardingState();
		expect(needsWizard.value).toBe(false);
	});

	it('false when wizard_completed_at is set (user dismissed)', async () => {
		const { api } = makeApi({
			getMeta: {
				first_module_activated_at: null,
				wizard_completed_at: '2026-01-01T00:00:00Z',
				intent_captured: null,
			},
		});
		const { needsWizard, fetchOnboardingState } = useOnboarding(api);
		await fetchOnboardingState();
		expect(needsWizard.value).toBe(false);
	});

	it('true when both are null even after fetch', async () => {
		const { api } = makeApi({
			getMeta: {
				first_module_activated_at: null,
				wizard_completed_at: null,
				intent_captured: null,
			},
		});
		const { needsWizard, fetchOnboardingState } = useOnboarding(api);
		await fetchOnboardingState();
		expect(needsWizard.value).toBe(true);
	});
});

// ─── fetchOnboardingState ─────────────────────────────────────────────────────

describe('useOnboarding: fetchOnboardingState', () => {
	it('populates state from metadata', async () => {
		const { api } = makeApi({
			getMeta: {
				intent_captured: 'calculators',
				first_module_activated_at: '2026-02-01T00:00:00Z',
				wizard_completed_at: '2026-02-01T00:01:00Z',
			},
		});
		const { state, fetchOnboardingState } = useOnboarding(api);
		await fetchOnboardingState();
		expect(state.value.intent_captured).toBe('calculators');
		expect(state.value.first_module_activated_at).toBe('2026-02-01T00:00:00Z');
		expect(state.value.wizard_completed_at).toBe('2026-02-01T00:01:00Z');
	});

	it('defaults to emptyState when no onboarding_state in metadata', async () => {
		const { api } = makeApi({ getMeta: undefined });
		const { state, fetchOnboardingState } = useOnboarding(api);
		await fetchOnboardingState();
		expect(state.value.intent_captured).toBeNull();
		expect(state.value.first_module_activated_at).toBeNull();
	});

	it('sets error and resets to empty on fetch failure', async () => {
		const errApi = { get: vi.fn().mockRejectedValue(new Error('network')), post: vi.fn() };
		const { state, error, fetchOnboardingState } = useOnboarding(errApi);
		await fetchOnboardingState();
		expect(error.value).toBe('network');
		expect(state.value.intent_captured).toBeNull();
	});
});

// ─── captureIntent ─────────────────────────────────────────────────────────────

describe('useOnboarding: captureIntent', () => {
	it('POSTs to /account/onboarding/state with intent and updates local state', async () => {
		const { api, postFn } = makeApi();
		const { state, captureIntent } = useOnboarding(api);
		await captureIntent('kb');
		expect(postFn).toHaveBeenCalledOnce();
		const [url, body] = postFn.mock.calls[0];
		expect(url).toBe('/account/onboarding/state');
		expect(body.intent_captured).toBe('kb');
		expect(state.value.intent_captured).toBe('kb');
	});

	it('sends only the changed field to the endpoint', async () => {
		const { api, postFn } = makeApi({
			getMeta: { intent_captured: 'calculators', some_other: 'key' },
		});
		const { captureIntent } = useOnboarding(api);
		await captureIntent('flows');
		const [, body] = postFn.mock.calls[0];
		// Flat patch — server handles the merge
		expect(body.intent_captured).toBe('flows');
		expect(body.metadata).toBeUndefined(); // no metadata wrapper
	});
});

// ─── markActivated ─────────────────────────────────────────────────────────────

describe('useOnboarding: markActivated', () => {
	it('sets first_module_activated_at and wizard_completed_at', async () => {
		const { api, postFn } = makeApi();
		const { state, markActivated } = useOnboarding(api);
		await markActivated();
		const [, body] = postFn.mock.calls[0];
		expect(body.first_module_activated_at).toBeTruthy();
		expect(body.wizard_completed_at).toBeTruthy();
		expect(state.value.first_module_activated_at).toBeTruthy();
	});

	it('needsWizard becomes false after markActivated', async () => {
		const { api } = makeApi();
		const { needsWizard, markActivated } = useOnboarding(api);
		expect(needsWizard.value).toBe(true);
		await markActivated();
		expect(needsWizard.value).toBe(false);
	});
});

// ─── markCompleted ─────────────────────────────────────────────────────────────

describe('useOnboarding: markCompleted', () => {
	it('sets wizard_completed_at — only sends that field', async () => {
		const { api, postFn } = makeApi();
		const { state, markCompleted } = useOnboarding(api);
		await markCompleted();
		const [url, body] = postFn.mock.calls[0];
		expect(url).toBe('/account/onboarding/state');
		expect(body.wizard_completed_at).toBeTruthy();
		// first_module_activated_at not in patch (server preserves it)
		expect(body.first_module_activated_at).toBeUndefined();
		expect(state.value.wizard_completed_at).toBeTruthy();
	});

	it('needsWizard becomes false after markCompleted', async () => {
		const { api } = makeApi();
		const { needsWizard, markCompleted } = useOnboarding(api);
		await markCompleted();
		expect(needsWizard.value).toBe(false);
	});
});
