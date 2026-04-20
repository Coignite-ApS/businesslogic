<template>
	<private-view title="Get Started">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="rocket_launch" />
			</v-button>
		</template>

		<template #navigation>
			<account-navigation />
		</template>

		<div class="onboarding-content">
			<welcome-wizard
				:initial-intent="initialIntent"
				:success-module="successModule"
				:cancelled-module="cancelledModule"
				@done="handleDone"
				@skip="handleSkip"
			/>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import AccountNavigation from '../components/account-navigation.vue';
import WelcomeWizard from '../components/welcome-wizard.vue';
import { useOnboarding, registerOnboardingGuard } from '../composables/use-onboarding';
import type { OnboardingIntent } from '../composables/use-onboarding';
import type { Module } from '../types';

const api = useApi();
const route = useRoute();
const router = useRouter();
const { needsWizard, fetchOnboardingState } = useOnboarding(api);

// ── Global session guard ─────────────────────────────────────────────────────
// Registered here because this is the page users actually land on after fresh
// login (server sets last_page=/account/onboarding on login).  Once registered,
// the guard persists for the entire app session.  registerOnboardingGuard
// ensures at most one guard is active at a time.
onMounted(async () => {
	await fetchOnboardingState();
	registerOnboardingGuard(router, () => needsWizard.value);
});

// ?mode=retry — skip the needsWizard check, just show the wizard again.
// (Handled upstream in the redirect logic; here we just render unconditionally.)

// If Stripe returns ?success=true&module=X, skip to step 3.
const successModule = computed<Module | null>(() => {
	if (route.query.success === 'true' && route.query.module) {
		const m = route.query.module as string;
		if (m === 'calculators' || m === 'kb' || m === 'flows') return m as Module;
	}
	return null;
});

// If Stripe returns ?cancelled=true&module=X, show a "you weren't charged" notice.
const cancelledModule = computed<Module | null>(() => {
	if (route.query.cancelled === 'true' && route.query.module) {
		const m = route.query.module as string;
		if (m === 'calculators' || m === 'kb' || m === 'flows') return m as Module;
	}
	return null;
});

// Preserve intent across Stripe redirect if passed in query
const initialIntent = computed<OnboardingIntent | null>(() => {
	const i = route.query.intent as string;
	if (i === 'calculators' || i === 'kb' || i === 'flows' || i === 'unsure') {
		return i as OnboardingIntent;
	}
	return null;
});

function handleDone() {
	// Targeted cleanup: remove only onboarding return params.
	const { success: _s, cancelled: _c, module: _m, ...rest } = route.query;
	router.replace({ query: rest });
	router.push('/');
}

function handleSkip() {
	router.push('/account');
}
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.onboarding-content {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
}
</style>
