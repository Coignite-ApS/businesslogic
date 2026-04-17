<template>
	<div class="admin-nav">
		<v-list nav>
			<v-list-item
				v-for="item in navItems"
				:key="item.to"
				:to="item.to"
				:active="isActive(item.to)"
				clickable
			>
				<v-list-item-icon><v-icon :name="item.icon" /></v-list-item-icon>
				<v-list-item-content>{{ item.label }}</v-list-item-content>
			</v-list-item>
		</v-list>
	</div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();

const navItems = [
	{ to: '/admin-dashboard/overview', icon: 'dashboard', label: 'Overview' },
	{ to: '/admin-dashboard/accounts', icon: 'people', label: 'Accounts' },
	{ to: '/admin-dashboard/calculators', icon: 'calculate', label: 'Calculators' },
	{ to: '/admin-dashboard/infrastructure', icon: 'dns', label: 'Infrastructure' },
	{ to: '/admin-dashboard/ai', icon: 'smart_toy', label: 'AI' },
	{ to: '/admin-dashboard/features', icon: 'toggle_on', label: 'Features' },
];

function isActive(path: string): boolean {
	return route.path.startsWith(path);
}
</script>

<style scoped>
.admin-nav {
	padding: 8px 0;
}
</style>
