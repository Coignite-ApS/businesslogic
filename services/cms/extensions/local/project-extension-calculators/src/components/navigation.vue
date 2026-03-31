<template>
	<div class="calculator-navigation">
		<v-button full-width @click="$emit('create')" :disabled="creating">
			<v-icon name="add" left />
			New calculator
		</v-button>

		<v-list class="account-links">
			<v-list-item
				:active="currentView === 'account-mcp'"
				clickable
				@click="$router.push('/calculators/account-mcp')"
			>
				<v-list-item-icon>
					<v-icon name="smart_toy" small />
				</v-list-item-icon>
				<v-list-item-content>
					<v-text-overflow text="Account MCP" />
				</v-list-item-content>
			</v-list-item>
		</v-list>

		<v-list v-if="calculators.length > 0" class="calculator-list">
			<template v-for="calc in calculators" :key="calc.id">
				<v-list-item
					:active="calc.id === currentId && currentView === 'dashboard'"
					clickable
					@click="$router.push(`/calculators/${calc.id}`)"
				>
					<v-list-item-icon>
						<v-icon :name="calc.icon || 'calculate'" small />
					</v-list-item-icon>
					<v-list-item-content>
						<v-text-overflow :text="calc.name || 'New Calculator'" />
					</v-list-item-content>
					<span class="status-dot" :class="statusDotClass(calc)" />
				</v-list-item>

				<template v-if="calc.id === currentId">
					<v-list-item
						v-if="hasExcel"
						class="sub-item"
						:active="currentView === 'configure'"
						clickable
						@click="$router.push(`/calculators/${calc.id}/configure`)"
					>
						<v-list-item-icon>
							<v-icon name="tune" small />
						</v-list-item-icon>
						<v-list-item-content>
							<v-text-overflow text="Configure" />
						</v-list-item-content>
					</v-list-item>

					<v-list-item
						v-if="hasConfig"
						class="sub-item"
						:active="currentView === 'test'"
						clickable
						@click="$router.push(`/calculators/${calc.id}/test`)"
					>
						<v-list-item-icon>
							<v-icon name="play_arrow" small />
						</v-list-item-icon>
						<v-list-item-content>
							<v-text-overflow text="Test" />
						</v-list-item-content>
					</v-list-item>

					<v-list-item
						v-if="hasConfig"
						class="sub-item"
						:active="currentView === 'integration'"
						clickable
						@click="$router.push(`/calculators/${calc.id}/integration`)"
					>
						<v-list-item-icon>
							<v-icon name="integration_instructions" small />
						</v-list-item-icon>
						<v-list-item-content>
							<v-text-overflow text="Integrate" />
						</v-list-item-content>
					</v-list-item>
				</template>
			</template>
		</v-list>

		<v-info v-else-if="!loading" icon="calculate" title="No Calculators">
			Create your first calculator to get started.
		</v-info>
	</div>
</template>

<script setup lang="ts">
import type { Calculator } from '../types';

defineProps<{
	calculators: Calculator[];
	currentId: string | null;
	loading: boolean;
	creating: boolean;
	currentView?: 'dashboard' | 'configure' | 'test' | 'integration' | 'account-mcp' | null;
	hasExcel?: boolean;
	hasConfig?: boolean;
}>();

defineEmits<{
	create: [];
}>();

function statusDotClass(calc: Calculator): string {
	if (calc.activated && !calc.over_limit) return 'dot-live';
	if (calc.activated && calc.over_limit) return 'dot-overlimit';
	if (!calc.activated && calc.test_expires_at && new Date(calc.test_expires_at) > new Date()) return 'dot-test';
	return 'dot-inactive';
}
</script>

<style scoped>
.calculator-navigation {
	padding: 12px;
}

.account-links {
	margin-top: 8px;
	margin-bottom: 4px;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
	padding-bottom: 8px;
}

.calculator-list {
	margin-top: 12px;
}

.calculator-list :deep(.v-list-item-content) {
	flex: 1;
	min-width: 0;
	margin-right: 8px;
}

.sub-item {
	padding-left: 20px;
}

.status-dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	flex-shrink: 0;
	margin-right: 16px;
}

.dot-live {
	background-color: var(--theme--success);
}

.dot-test,
.dot-overlimit {
	background-color: var(--theme--warning);
}

.dot-inactive {
	background-color: var(--theme--foreground-subdued);
	opacity: 0.4;
}
</style>
