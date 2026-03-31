<template>
	<div v-if="!isDeployed" class="deploy-notice">
		<v-icon name="cloud_off" />
		<span>Not deployed to Formula API. Deploy from the dashboard first.</span>
	</div>
	<template v-else>
		<div class="code-section">
			<h2 class="section-title">Embed Widget (Gateway Mode)</h2>
			<p class="code-section-desc">
				Add this to your HTML page. The widget authenticates via your API key through the gateway.
			</p>
			<code-block :code="widgetEmbedGateway" :copy-code="widgetEmbedGateway" language="html" />
		</div>

		<div class="code-section">
			<h2 class="section-title">Embed Widget (Legacy Direct Mode)</h2>
			<p class="code-section-desc">
				Uses a per-calculator token to connect directly to the Formula API. Use Gateway Mode above for new integrations.
			</p>
			<code-block :code="widgetEmbedDirect" :copy-code="widgetEmbedDirect" language="html" />
		</div>
	</template>
</template>

<script setup lang="ts">
import CodeBlock from './code-block.vue';

defineProps<{
	isDeployed: boolean;
	widgetEmbedGateway: string;
	widgetEmbedDirect: string;
}>();
</script>
