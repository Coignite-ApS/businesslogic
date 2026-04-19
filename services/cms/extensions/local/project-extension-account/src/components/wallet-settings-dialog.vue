<template>
	<v-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" @esc="$emit('update:modelValue', false)">
		<v-card class="wallet-settings-card">
			<v-card-title>Wallet Auto-Reload Settings</v-card-title>
			<v-card-text>
				<div class="settings-form">
					<div class="field-row toggle-row">
						<label class="field-label">Auto top-up</label>
						<v-toggle v-model="localEnabled" />
					</div>

					<template v-if="localEnabled">
						<div class="field-row">
							<label class="field-label">When balance drops below</label>
							<div class="input-with-prefix">
								<span class="currency-prefix">€</span>
								<input
									v-model.number="localThreshold"
									type="number"
									min="1"
									step="1"
									placeholder="e.g. 5"
									class="number-input"
								/>
							</div>
							<p v-if="showThresholdError" class="field-error">Must be greater than 0</p>
						</div>

						<div class="field-row">
							<label class="field-label">Top up by</label>
							<div class="input-with-prefix">
								<span class="currency-prefix">€</span>
								<input
									v-model.number="localAmount"
									type="number"
									min="1"
									step="1"
									placeholder="e.g. 20"
									class="number-input"
								/>
							</div>
							<div class="quick-amounts">
								<button
									v-for="amt in [20, 50, 200]"
									:key="amt"
									class="quick-btn"
									:class="{ active: localAmount === amt }"
									@click="localAmount = amt"
								>€{{ amt }}</button>
							</div>
							<p v-if="showAmountError" class="field-error">Must be greater than 0</p>
						</div>
					</template>

					<div class="field-row">
						<label class="field-label">Monthly spending cap <span class="optional">(optional)</span></label>
						<div class="input-with-prefix">
							<span class="currency-prefix">€</span>
							<input
								v-model.number="localCap"
								type="number"
								min="0"
								step="1"
								placeholder="No cap"
								class="number-input"
							/>
						</div>
						<p class="field-hint">Blocks new charges if monthly debits exceed this amount</p>
					</div>
				</div>

				<v-notice v-if="saveError" type="danger" class="save-error">{{ saveError }}</v-notice>
			</v-card-text>
			<v-card-actions>
				<v-button secondary @click="$emit('update:modelValue', false)">Cancel</v-button>
				<v-button :loading="saving" :disabled="!isValid" @click="handleSave">Save</v-button>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface WalletConfig {
	auto_reload_enabled: boolean;
	auto_reload_threshold_eur: number | null;
	auto_reload_amount_eur: number | null;
	monthly_cap_eur: number | null;
}

const props = defineProps<{
	modelValue: boolean;
	initialConfig: WalletConfig;
	saving: boolean;
	saveError: string | null;
}>();

const emit = defineEmits<{
	(e: 'update:modelValue', v: boolean): void;
	(e: 'save', config: WalletConfig): void;
}>();

const localEnabled = ref(false);
const localThreshold = ref<number | null>(null);
const localAmount = ref<number | null>(null);
const localCap = ref<number | null>(null);

// Sync local state when dialog opens
watch(
	() => props.modelValue,
	(open) => {
		if (open) {
			localEnabled.value = props.initialConfig.auto_reload_enabled;
			localThreshold.value = props.initialConfig.auto_reload_threshold_eur;
			localAmount.value = props.initialConfig.auto_reload_amount_eur;
			localCap.value = props.initialConfig.monthly_cap_eur;
		}
	},
	{ immediate: true },
);

const showThresholdError = computed(() => localEnabled.value && localThreshold.value != null && localThreshold.value <= 0);
const showAmountError = computed(() => localEnabled.value && localAmount.value != null && localAmount.value <= 0);

const isValid = computed(() => {
	if (!localEnabled.value) return true;
	return (
		localThreshold.value != null && localThreshold.value > 0
		&& localAmount.value != null && localAmount.value > 0
	);
});

function handleSave() {
	if (!isValid.value) return;
	emit('save', {
		auto_reload_enabled: localEnabled.value,
		auto_reload_threshold_eur: localEnabled.value ? (localThreshold.value ?? null) : null,
		auto_reload_amount_eur: localEnabled.value ? (localAmount.value ?? null) : null,
		monthly_cap_eur: localCap.value && localCap.value > 0 ? localCap.value : null,
	});
}
</script>

<style scoped>
.wallet-settings-card {
	min-width: 420px;
	max-width: 520px;
}

.settings-form {
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.field-row {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.toggle-row {
	flex-direction: row;
	align-items: center;
	justify-content: space-between;
}

.field-label {
	font-size: 13px;
	font-weight: 600;
	color: var(--theme--foreground);
}

.optional {
	font-weight: 400;
	color: var(--theme--foreground-subdued);
}

.input-with-prefix {
	display: flex;
	align-items: center;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
	background: var(--theme--background);
}

.currency-prefix {
	padding: 8px 10px;
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	background: var(--theme--background-subdued);
	border-right: 1px solid var(--theme--border-color);
}

.number-input {
	flex: 1;
	border: none;
	outline: none;
	padding: 8px 12px;
	font-size: 14px;
	color: var(--theme--foreground);
	background: transparent;
	font-family: var(--theme--fonts--sans--font-family);
}

.number-input::placeholder {
	color: var(--theme--foreground-subdued);
}

.quick-amounts {
	display: flex;
	gap: 6px;
}

.quick-btn {
	padding: 4px 12px;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background-subdued);
	font-size: 12px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	cursor: pointer;
	transition: all 0.1s;
}

.quick-btn:hover {
	border-color: var(--theme--primary);
	color: var(--theme--primary);
}

.quick-btn.active {
	background: var(--theme--primary-background);
	border-color: var(--theme--primary);
	color: var(--theme--primary);
}

.field-hint {
	margin: 0;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	line-height: 1.4;
}

.field-error {
	margin: 0;
	font-size: 12px;
	color: var(--theme--danger);
}

.save-error {
	margin-top: 8px;
}
</style>
