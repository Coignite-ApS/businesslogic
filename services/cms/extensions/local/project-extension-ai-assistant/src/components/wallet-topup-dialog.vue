<!-- Duplicated in: project-extension-account/src/components/wallet-topup-dialog.vue -->
<!-- Keep in sync — no cross-extension imports (each extension builds independently). -->
<template>
	<v-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" @esc="$emit('update:modelValue', false)">
		<v-card class="wallet-topup-dialog">
			<v-card-title>AI Wallet</v-card-title>
			<v-card-text>
				<div v-if="loading" class="loading-state">
					<v-progress-circular indeterminate />
				</div>
				<div v-else>
					<div class="wallet-current">
						<span class="wallet-label">Current balance</span>
						<span class="wallet-balance" :class="{ low: isLow }">{{ formatEur(balance) }}</span>
					</div>
					<v-notice v-if="isLow" type="warning" style="margin-bottom: 12px;">
						Your balance is low. AI calls will be blocked once it reaches €0.
					</v-notice>
					<p class="wallet-hint">AI usage is billed from your wallet at cost. Top up to keep going.</p>
					<div class="topup-grid">
						<v-button
							v-for="amt in STANDARD_AMOUNTS"
							:key="amt"
							:loading="confirmLoading === amt"
							:disabled="confirmLoading !== null && confirmLoading !== amt"
							@click="handleSelect(amt)"
						>€{{ amt }}</v-button>
					</div>
					<div class="custom-amount-row">
						<v-input
							v-model="customAmountStr"
							type="number"
							min="1"
							placeholder="Custom amount (€)"
							class="custom-input"
						/>
						<v-button
							:disabled="!customAmountValid || confirmLoading !== null"
							:loading="confirmLoading === 'custom'"
							@click="handleCustom"
						>Top up</v-button>
					</div>
					<p v-if="customAmountStr && !customAmountValid" class="custom-error">Enter a positive amount.</p>
					<v-notice v-if="error" type="danger" style="margin-top: 12px;">{{ error }}</v-notice>
				</div>
			</v-card-text>
			<v-card-actions>
				<v-button secondary @click="$emit('update:modelValue', false)">Close</v-button>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const STANDARD_AMOUNTS = [20, 50, 200] as const;
type StandardAmount = typeof STANDARD_AMOUNTS[number];

const props = defineProps<{
	modelValue: boolean;
	balance?: number | string | null;
	loading?: boolean;
	error?: string | null;
}>();

const emit = defineEmits<{
	(e: 'update:modelValue', val: boolean): void;
	(e: 'confirm', amount: StandardAmount | number): void;
}>();

const confirmLoading = ref<StandardAmount | 'custom' | null>(null);
const customAmountStr = ref('');

const isLow = computed(() => Number(props.balance ?? 0) < 1);

const customAmountValid = computed(() => {
	const n = Number(customAmountStr.value);
	return Number.isFinite(n) && n > 0;
});

function formatEur(n: number | string | null | undefined): string {
	const v = Number(n || 0);
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(v);
}

async function handleSelect(amt: StandardAmount) {
	confirmLoading.value = amt;
	emit('confirm', amt);
	confirmLoading.value = null;
}

async function handleCustom() {
	const amt = Number(customAmountStr.value);
	if (!customAmountValid.value) return;
	confirmLoading.value = 'custom';
	emit('confirm', amt);
	confirmLoading.value = null;
	customAmountStr.value = '';
}
</script>

<style scoped>
.wallet-topup-dialog {
	min-width: 380px;
	max-width: 480px;
}

.loading-state {
	display: flex;
	justify-content: center;
	padding: 32px;
}

.wallet-current {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	margin-bottom: 12px;
}

.wallet-label {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.4px;
}

.wallet-balance {
	font-size: 28px;
	font-weight: 700;
	color: var(--theme--foreground);
}

.wallet-balance.low {
	color: var(--theme--warning, #d8a04e);
}

.wallet-hint {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin-bottom: 14px;
}

.topup-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 8px;
	margin-bottom: 12px;
}

.custom-amount-row {
	display: flex;
	gap: 8px;
	align-items: flex-start;
}

.custom-input {
	flex: 1;
}

.custom-error {
	font-size: 12px;
	color: var(--theme--danger);
	margin: 4px 0 0;
}
</style>
