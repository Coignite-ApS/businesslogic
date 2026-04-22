/**
 * Pure helper — no Vue dependencies.
 *
 * Returns true when the user has NOT yet activated a module AND has NOT
 * explicitly dismissed the wizard.  Accepts the inner onboarding_state object
 * (i.e. metadata?.onboarding_state or an OnboardingState instance).
 *
 * Used by:
 *   - useOnboarding (computed) — passes state.value directly
 *   - registerOnboardingGuard callers — pass user.metadata?.onboarding_state
 *
 * NOTE: server-side account-api/src/index.ts has an inline duplicate of this
 * logic.  Keep in sync manually — cross-extension imports are fragile.
 */
export function needsOnboardingWizard(
	onboardingState: Record<string, any> | undefined | null,
): boolean {
	return !onboardingState?.first_module_activated_at && !onboardingState?.wizard_completed_at;
}
