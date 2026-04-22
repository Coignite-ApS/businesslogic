<template>
	<div v-if="show" class="low-balance-banner">
		<v-icon name="account_balance_wallet" small class="banner-icon" />
		<span class="banner-text">AI Wallet low: {{ formatEur(balanceEur) }} — Top up to keep using AI</span>
		<button class="banner-btn" @click="$emit('topup')">Top up</button>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
	balanceEur: number | string | null;
}>();

defineEmits<{
	(e: 'topup'): void;
}>();

const show = computed(() => Number(props.balanceEur ?? 0) < 1);

function formatEur(n: number | string | null | undefined): string {
	const v = Number(n || 0);
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(v);
}
</script>

<style scoped>
.low-balance-banner {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 16px;
	background: var(--theme--warning-background, rgba(216, 160, 78, 0.12));
	border-bottom: 1px solid var(--theme--warning, #d8a04e);
	color: var(--theme--warning, #b97c2a);
	font-size: 13px;
	flex-shrink: 0;
}

.banner-icon {
	flex-shrink: 0;
	color: var(--theme--warning, #d8a04e);
}

.banner-text {
	flex: 1;
	font-weight: 500;
}

.banner-btn {
	background: none;
	border: 1px solid currentColor;
	border-radius: var(--theme--border-radius);
	color: inherit;
	cursor: pointer;
	font-size: 12px;
	font-weight: 600;
	padding: 3px 10px;
	transition: background 0.1s;
}

.banner-btn:hover {
	background: rgba(0, 0, 0, 0.06);
}
</style>
