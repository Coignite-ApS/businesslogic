import { ref, computed } from 'vue';
import type { Ref } from 'vue';
import type { Router } from 'vue-router';
import { formatApiError } from '../utils/format-api-error';

export type OnboardingIntent = 'calculators' | 'kb' | 'flows' | 'unsure';

export interface OnboardingState {
	intent_captured: OnboardingIntent | null;
	first_module_activated_at: string | null;
	wizard_completed_at: string | null;
}

function emptyState(): OnboardingState {
	return {
		intent_captured: null,
		first_module_activated_at: null,
		wizard_completed_at: null,
	};
}

// ── Global onboarding guard ────────────────────────────────────────────────
// Singleton: only one guard is registered at a time.  Calling
// registerOnboardingGuard multiple times (e.g. user re-visits the onboarding
// page) replaces the old guard instead of stacking them.
let _removeGuard: (() => void) | null = null;

/**
 * Register a router.beforeEach guard that redirects to /account/onboarding
 * whenever needsWizard is true.  Idempotent — removes the previous guard first.
 *
 * Loop prevention:
 *   - Skips if destination is /account/onboarding (already there)
 *   - Skips auth/login routes (unauthenticated paths)
 *   - Only fires when needsWizard is true (reactive; auto-clears after completion)
 */
export function registerOnboardingGuard(router: Router, needsWizard: Ref<boolean>): void {
	// Remove previous guard if any (prevents stacking on re-mount)
	if (_removeGuard) {
		_removeGuard();
		_removeGuard = null;
	}
	_removeGuard = router.beforeEach((to, _from, next) => {
		const isOnboardingRoute = to.path.includes('/account/onboarding');
		const isAuthRoute = to.path.startsWith('/auth') || to.path.startsWith('/login');
		if (needsWizard.value && !isOnboardingRoute && !isAuthRoute) {
			next('/account/onboarding');
		} else {
			next();
		}
	});
}

export function useOnboarding(api: any) {
	const state = ref<OnboardingState>(emptyState());
	const loading = ref(false);
	const error = ref<string | null>(null);

	// needsWizard: true if no module activated AND wizard not explicitly completed
	const needsWizard = computed(() =>
		!state.value.first_module_activated_at && !state.value.wizard_completed_at,
	);

	async function fetchOnboardingState(): Promise<void> {
		loading.value = true;
		error.value = null;
		try {
			const { data } = await api.get('/users/me', {
				params: { fields: ['metadata'] },
			});
			const metadata = data?.data?.metadata || {};
			const onboarding = metadata?.onboarding_state || {};
			state.value = {
				intent_captured: onboarding.intent_captured ?? null,
				first_module_activated_at: onboarding.first_module_activated_at ?? null,
				wizard_completed_at: onboarding.wizard_completed_at ?? null,
			};
		} catch (err: any) {
			error.value = formatApiError(err);
			state.value = emptyState();
		} finally {
			loading.value = false;
		}
	}

	async function _patchOnboardingState(patch: Partial<OnboardingState>): Promise<void> {
		error.value = null;
		try {
			// POST to dedicated endpoint — bypasses User-role directus_users.update
			// restriction. Server merges patch into metadata.onboarding_state via admin DB.
			await api.post('/account/onboarding/state', patch);
			// Optimistic local update (no need to refetch full user)
			state.value = { ...state.value, ...patch };
		} catch (err: any) {
			error.value = formatApiError(err);
		}
	}

	async function captureIntent(intent: OnboardingIntent): Promise<void> {
		await _patchOnboardingState({ intent_captured: intent });
	}

	async function markActivated(): Promise<void> {
		await _patchOnboardingState({
			first_module_activated_at: new Date().toISOString(),
			wizard_completed_at: new Date().toISOString(),
		});
	}

	async function markCompleted(): Promise<void> {
		await _patchOnboardingState({
			wizard_completed_at: new Date().toISOString(),
		});
	}

	return {
		state,
		loading,
		error,
		needsWizard,
		fetchOnboardingState,
		captureIntent,
		markActivated,
		markCompleted,
	};
}
