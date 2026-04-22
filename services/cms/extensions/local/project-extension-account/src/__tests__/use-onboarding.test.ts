import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { useOnboarding, registerOnboardingGuard } from '../composables/use-onboarding';
import { needsOnboardingWizard } from '../utils/onboarding-needed';

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

// ─── needsOnboardingWizard (pure helper) ──────────────────────────────────────

describe('needsOnboardingWizard', () => {
	it('true when both fields null', () => {
		expect(needsOnboardingWizard({ first_module_activated_at: null, wizard_completed_at: null })).toBe(true);
	});

	it('false when first_module_activated_at set', () => {
		expect(needsOnboardingWizard({ first_module_activated_at: '2026-01-01T00:00:00Z', wizard_completed_at: null })).toBe(false);
	});

	it('false when wizard_completed_at set', () => {
		expect(needsOnboardingWizard({ first_module_activated_at: null, wizard_completed_at: '2026-01-01T00:00:00Z' })).toBe(false);
	});

	it('true when null/undefined passed', () => {
		expect(needsOnboardingWizard(null)).toBe(true);
		expect(needsOnboardingWizard(undefined)).toBe(true);
	});
});

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

// ─── registerOnboardingGuard ───────────────────────────────────────────────────

describe('registerOnboardingGuard', () => {
	function makeRouter() {
		const removeGuard = vi.fn();
		const router: any = {
			beforeEach: vi.fn().mockReturnValue(removeGuard),
		};
		return { router, removeGuard };
	}

	it('registers a beforeEach guard', () => {
		const { router } = makeRouter();
		registerOnboardingGuard(router, () => false);
		expect(router.beforeEach).toHaveBeenCalledOnce();
	});

	it('redirects to /account/onboarding when shouldRedirect returns true', () => {
		const { router } = makeRouter();
		registerOnboardingGuard(router, () => true);
		const guard = router.beforeEach.mock.calls[0][0];

		const next = vi.fn();
		guard({ path: '/calculators' }, {}, next);
		expect(next).toHaveBeenCalledWith('/account/onboarding');
	});

	it('does NOT redirect when shouldRedirect returns false', () => {
		const { router } = makeRouter();
		registerOnboardingGuard(router, () => false);
		const guard = router.beforeEach.mock.calls[0][0];

		const next = vi.fn();
		guard({ path: '/calculators' }, {}, next);
		expect(next).toHaveBeenCalledWith();
	});

	it('does NOT redirect when already on /account/onboarding', () => {
		const { router } = makeRouter();
		registerOnboardingGuard(router, () => true);
		const guard = router.beforeEach.mock.calls[0][0];

		const next = vi.fn();
		guard({ path: '/account/onboarding' }, {}, next);
		expect(next).toHaveBeenCalledWith();
	});

	it('does NOT redirect on auth routes', () => {
		const { router } = makeRouter();
		registerOnboardingGuard(router, () => true);
		const guard = router.beforeEach.mock.calls[0][0];

		const next = vi.fn();
		guard({ path: '/auth/login' }, {}, next);
		expect(next).toHaveBeenCalledWith();
	});

	it('removes old guard before registering new one (no stacking)', () => {
		const removeA = vi.fn();
		const routerA: any = { beforeEach: vi.fn().mockReturnValue(removeA) };
		const routerB: any = { beforeEach: vi.fn().mockReturnValue(vi.fn()) };

		registerOnboardingGuard(routerA, () => true);
		// Second call should remove the first guard
		registerOnboardingGuard(routerB, () => true);
		expect(removeA).toHaveBeenCalledOnce();
	});

	// ── Regression: logout → re-login stale-closure ───────────────────────────
	// Guard must always invoke the LATEST registered getter, not a captured ref
	// from a previous user's session.
	it('user-switch: re-registering with new getter reflects new user state', () => {
		const { router } = makeRouter();

		// User A: wizard completed (needsWizard = false)
		const userANeedsWizard = ref(false);
		registerOnboardingGuard(router, () => userANeedsWizard.value);

		const guardA = router.beforeEach.mock.calls[0][0];
		const nextA = vi.fn();
		guardA({ path: '/calculators' }, {}, nextA);
		// User A should NOT be redirected
		expect(nextA).toHaveBeenCalledWith();

		// User B logs in, mounts their component → re-registers with their getter
		// (needsWizard = true for User B)
		const userBNeedsWizard = ref(true);
		registerOnboardingGuard(router, () => userBNeedsWizard.value);

		const guardB = router.beforeEach.mock.calls[1][0];
		const nextB = vi.fn();
		guardB({ path: '/calculators' }, {}, nextB);
		// User B SHOULD be redirected to onboarding
		expect(nextB).toHaveBeenCalledWith('/account/onboarding');

		// Verify that stale User A closure is no longer used — only guardB exists
		// (guardA is the old closure; the singleton now holds guardB)
		const nextBAfterWizard = vi.fn();
		userBNeedsWizard.value = false; // User B completes wizard
		guardB({ path: '/calculators' }, {}, nextBAfterWizard);
		expect(nextBAfterWizard).toHaveBeenCalledWith(); // no redirect after completion
	});

	it('getter is evaluated fresh on every navigation (not captured at registration)', () => {
		const { router } = makeRouter();
		const needsWizard = ref(true);

		registerOnboardingGuard(router, () => needsWizard.value);
		const guard = router.beforeEach.mock.calls[0][0];

		// First navigation: needs wizard
		const next1 = vi.fn();
		guard({ path: '/calculators' }, {}, next1);
		expect(next1).toHaveBeenCalledWith('/account/onboarding');

		// Wizard completed → same guard, same getter, but getter now returns false
		needsWizard.value = false;
		const next2 = vi.fn();
		guard({ path: '/calculators' }, {}, next2);
		expect(next2).toHaveBeenCalledWith(); // no redirect
	});
});
