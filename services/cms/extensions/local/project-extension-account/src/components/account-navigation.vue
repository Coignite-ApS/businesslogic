<template>
	<v-list nav>
		<v-list-item to="/account" :active="isAccountRoute" clickable>
			<v-list-item-icon><v-icon name="settings" /></v-list-item-icon>
			<v-list-item-content><v-text-overflow text="Account Settings" /></v-list-item-content>
		</v-list-item>
		<v-list-item to="/account/subscription" :active="isSubscriptionRoute" clickable>
			<v-list-item-icon><v-icon name="credit_card" /></v-list-item-icon>
			<v-list-item-content><v-text-overflow text="Subscription" /></v-list-item-content>
		</v-list-item>
		<v-list-item to="/account/onboarding?mode=retry" :active="isOnboardingRoute" clickable>
			<v-list-item-icon><v-icon name="help_outline" /></v-list-item-icon>
			<v-list-item-content><v-text-overflow text="Getting Started" /></v-list-item-content>
		</v-list-item>
	</v-list>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const isSubscriptionRoute = computed(() => route.path.includes('/subscription'));
const isOnboardingRoute = computed(() => route.path.includes('/onboarding'));
const isAccountRoute = computed(() => !isSubscriptionRoute.value && !isOnboardingRoute.value);
</script>
