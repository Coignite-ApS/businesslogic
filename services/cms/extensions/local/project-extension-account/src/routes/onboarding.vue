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
				@done="handleDone"
				@skip="handleSkip"
			/>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AccountNavigation from '../components/account-navigation.vue';
import WelcomeWizard from '../components/welcome-wizard.vue';
import type { OnboardingIntent } from '../composables/use-onboarding';
import type { Module } from '../types';

const route = useRoute();
const router = useRouter();

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

// Preserve intent across Stripe redirect if passed in query
const initialIntent = computed<OnboardingIntent | null>(() => {
	const i = route.query.intent as string;
	if (i === 'calculators' || i === 'kb' || i === 'flows' || i === 'unsure') {
		return i as OnboardingIntent;
	}
	return null;
});

function handleDone() {
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
