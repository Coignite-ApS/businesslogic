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
	</v-list>
</template>
