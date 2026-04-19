import { ref, computed } from 'vue';

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
			error.value = err.message;
			state.value = emptyState();
		} finally {
			loading.value = false;
		}
	}

	async function _patchOnboardingState(patch: Partial<OnboardingState>): Promise<void> {
		error.value = null;
		try {
			// Fetch current metadata first to avoid overwriting other keys
			const { data } = await api.get('/users/me', {
				params: { fields: ['metadata'] },
			});
			const existingMeta = data?.data?.metadata || {};
			const existingOnboarding = existingMeta?.onboarding_state || {};

			const newOnboarding = { ...existingOnboarding, ...patch };
			await api.patch('/users/me', {
				metadata: { ...existingMeta, onboarding_state: newOnboarding },
			});
			// Update local state
			state.value = { ...state.value, ...patch };
		} catch (err: any) {
			error.value = err.message;
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
