<template>
	<v-list nav>
		<v-list-item to="/ai-observatory/cost" :active="$route.path.includes('/cost')">
			<v-list-item-icon><v-icon name="payments" /></v-list-item-icon>
			<v-list-item-content>Cost &amp; Budget</v-list-item-content>
		</v-list-item>
		<v-list-item to="/ai-observatory/quality" :active="$route.path.includes('/quality')">
			<v-list-item-icon><v-icon name="insights" /></v-list-item-icon>
			<v-list-item-content>Conversation Quality</v-list-item-content>
		</v-list-item>
		<v-list-item to="/ai-observatory/tools" :active="$route.path.includes('/tools')">
			<v-list-item-icon><v-icon name="build" /></v-list-item-icon>
			<v-list-item-content>Tool Analytics</v-list-item-content>
		</v-list-item>
		<v-list-item to="/ai-observatory/retrieval" :active="$route.path.includes('/retrieval')">
			<v-list-item-icon><v-icon name="manage_search" /></v-list-item-icon>
			<v-list-item-content>KB &amp; Retrieval</v-list-item-content>
		</v-list-item>
		<v-list-item to="/ai-observatory/models" :active="$route.path.includes('/models')">
			<v-list-item-icon><v-icon name="compare_arrows" /></v-list-item-icon>
			<v-list-item-content>Model Performance</v-list-item-content>
		</v-list-item>
		<v-list-item to="/ai-observatory/billing-health" :active="$route.path.includes('/billing-health')">
			<v-list-item-icon><v-icon name="health_and_safety" /></v-list-item-icon>
			<v-list-item-content>Billing Health</v-list-item-content>
		</v-list-item>
	</v-list>
</template>
