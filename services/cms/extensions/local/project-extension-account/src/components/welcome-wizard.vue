<template>
	<div class="wizard">
		<!-- Checkout-cancelled notice: shown when returning from Stripe via ?cancelled=true&module=X -->
		<v-notice
			v-if="cancelledModule && !cancelledDismissed"
			type="info"
			class="wizard-cancelled-notice"
			dismissible
			@dismiss="cancelledDismissed = true"
		>
			Checkout cancelled — you weren't charged. You can try again when you're ready.
		</v-notice>

		<!-- Step 1: Intent capture -->
		<div v-if="step === 1" class="wizard-step">
			<div class="wizard-hero">
				<v-icon name="rocket_launch" class="hero-icon" />
				<h1 class="wizard-title">Welcome to BusinessLogic</h1>
				<p class="wizard-subtitle">What brings you here? We'll help you get started.</p>
			</div>

			<div class="intent-grid">
				<button
					v-for="tile in intentTiles"
					:key="tile.intent"
					class="intent-tile"
					:class="{ selected: selectedIntent === tile.intent }"
					@click="selectIntent(tile.intent)"
				>
					<v-icon :name="tile.icon" class="tile-icon" />
					<span class="tile-label">{{ tile.label }}</span>
					<span class="tile-desc">{{ tile.desc }}</span>
				</button>
			</div>

			<div class="wizard-actions">
				<v-button :disabled="!selectedIntent" :loading="saving" @click="handleIntentNext">
					Continue
					<v-icon name="arrow_forward" right />
				</v-button>
			</div>
		</div>

		<!-- Step 2: Module quick-start (or tour for "unsure") -->
		<div v-else-if="step === 2" class="wizard-step">
			<!-- Tour mode for "unsure" -->
			<template v-if="selectedIntent === 'unsure'">
				<div class="wizard-hero">
					<v-icon name="explore" class="hero-icon" />
					<h1 class="wizard-title">Here's what BusinessLogic can do</h1>
					<p class="wizard-subtitle">Explore each module — activate the one that fits.</p>
				</div>
				<div class="tour-cards">
					<div v-for="card in tourCards" :key="card.module" class="tour-card">
						<div class="tour-card-header">
							<v-icon :name="card.icon" />
							<span class="tour-card-name">{{ card.name }}</span>
						</div>
						<p class="tour-card-body">{{ card.body }}</p>
						<v-button small @click="activateFromTour(card.module)">
							Start {{ card.name }} trial
						</v-button>
					</div>
				</div>
				<div class="wizard-actions">
					<v-button secondary @click="handleSkip">Maybe later</v-button>
					<v-button secondary @click="step = 1">
						<v-icon name="arrow_back" left />
						Back
					</v-button>
				</div>
			</template>

			<!-- Module-specific quick-start -->
			<template v-else>
				<div class="wizard-hero">
					<v-icon :name="activeModuleCard!.icon" class="hero-icon" />
					<h1 class="wizard-title">{{ activeModuleCard!.name }}</h1>
					<p class="wizard-subtitle">{{ activeModuleCard!.body }}</p>
				</div>

				<div class="module-details">
					<div class="detail-row">
						<v-icon name="hourglass_empty" />
						<span><strong>14-day free trial</strong> — no card needed during trial</span>
					</div>
					<div class="detail-row" v-if="starterPlan">
						<v-icon name="payments" />
						<span>
							After trial: <strong>{{ formatEur(starterPlan.price_eur_monthly) }}/mo</strong>
							{{ starterAllowanceLine }}
						</span>
					</div>
				</div>

				<div class="wizard-actions">
					<v-button secondary @click="step = 1">
						<v-icon name="arrow_back" left />
						Back
					</v-button>
					<v-button secondary @click="handleSkip">Maybe later</v-button>
					<v-button :loading="activating" @click="handleActivate">
						<v-icon name="play_circle" left />
						Activate {{ activeModuleCard!.name }} trial
					</v-button>
				</div>
			</template>
		</div>

		<!-- Step 3: Confirmation -->
		<div v-else-if="step === 3" class="wizard-step">
			<div class="wizard-hero success">
				<v-icon name="check_circle" class="hero-icon success-icon" />
				<h1 class="wizard-title">{{ confirmedModule }} is active for 14 days!</h1>
				<p class="wizard-subtitle">
					You have <strong>€5 AI Wallet credit</strong> — spend it on AI assistant and Q&amp;A.
				</p>
			</div>

			<div class="next-step-card">
				<p class="next-step-label">Next up:</p>
				<v-button large @click="handleNextStep">
					<v-icon :name="activeNextStep!.icon" left />
					{{ activeNextStep!.label }}
				</v-button>
			</div>

			<div class="wizard-actions">
				<v-button secondary @click="$emit('done')">Go to dashboard</v-button>
			</div>
		</div>

		<v-notice v-if="error" type="danger" class="wizard-error">{{ error }}</v-notice>
	</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import { useAccount } from '../composables/use-account';
import { useOnboarding } from '../composables/use-onboarding';
import type { OnboardingIntent } from '../composables/use-onboarding';
import type { Module } from '../types';

const props = defineProps<{
	initialIntent?: OnboardingIntent | null;
	// If returning from Stripe with ?success=true&module=X, jump straight to step 3
	successModule?: Module | null;
	// If returning from Stripe with ?cancelled=true&module=X, show a dismissible notice
	cancelledModule?: Module | null;
}>();

const emit = defineEmits<{
	done: [];
	skip: [];
}>();

const router = useRouter();
const api = useApi();
const { plans, fetchPlans, startCheckout } = useAccount(api);
const { captureIntent, markActivated, markCompleted, error } = useOnboarding(api);

const step = ref(props.successModule ? 3 : 1);
const selectedIntent = ref<OnboardingIntent | null>(props.initialIntent ?? null);
const confirmedModuleRef = ref<Module | null>(props.successModule ?? null);
const saving = ref(false);
const activating = ref(false);
const cancelledDismissed = ref(false);

const MODULE_LABELS: Record<Module, string> = {
	calculators: 'Calculators',
	kb: 'Knowledge Base',
	flows: 'Flows',
};

const intentTiles = [
	{
		intent: 'calculators' as OnboardingIntent,
		icon: 'calculate',
		label: 'Expose a calculator as an API',
		desc: 'Upload your Excel model and serve it as a hosted API endpoint.',
	},
	{
		intent: 'kb' as OnboardingIntent,
		icon: 'auto_stories',
		label: 'Build a Knowledge Base for AI Q&A',
		desc: 'Index your documents and let an AI assistant answer questions over them.',
	},
	{
		intent: 'flows' as OnboardingIntent,
		icon: 'account_tree',
		label: 'Automate workflows with AI',
		desc: 'Build DAG pipelines that connect APIs, data sources, and AI actions.',
	},
	{
		intent: 'unsure' as OnboardingIntent,
		icon: 'explore',
		label: "I'm not sure yet — show me around",
		desc: 'Browse all modules and decide what fits.',
	},
];

const tourCards = [
	{
		module: 'calculators' as Module,
		icon: 'calculate',
		name: 'Calculators',
		body: 'Turn Excel models into hosted API endpoints in minutes. No code. Any formula.',
	},
	{
		module: 'kb' as Module,
		icon: 'auto_stories',
		name: 'Knowledge Base',
		body: 'Upload PDFs, docs, or text. Power an AI Q&A assistant over your own content.',
	},
	{
		module: 'flows' as Module,
		icon: 'account_tree',
		name: 'Flows',
		body: 'Visual DAG workflow engine: chain AI steps, API calls, and data transforms.',
	},
];

const NEXT_STEPS: Record<Module, { icon: string; label: string; route: string }> = {
	calculators: { icon: 'upload_file', label: 'Upload your first Excel', route: '/calculators/new' },
	kb: { icon: 'add_circle', label: 'Create your first knowledge base', route: '/knowledge' },
	flows: { icon: 'account_tree', label: 'Open the flow editor', route: '/flows' },
};

const intentToModule: Record<Exclude<OnboardingIntent, 'unsure'>, Module> = {
	calculators: 'calculators',
	kb: 'kb',
	flows: 'flows',
};

const activeModule = computed<Module | null>(() => {
	if (!selectedIntent.value || selectedIntent.value === 'unsure') return null;
	return intentToModule[selectedIntent.value];
});

const confirmedModule = computed<string>(() => {
	const m = confirmedModuleRef.value;
	return m ? MODULE_LABELS[m] : '';
});

const activeModuleCard = computed(() => {
	const m = activeModule.value;
	return m ? tourCards.find((c) => c.module === m) ?? null : null;
});

const activeNextStep = computed(() => {
	const m = confirmedModuleRef.value;
	return m ? NEXT_STEPS[m] : null;
});

const starterPlan = computed(() => {
	const m = activeModule.value;
	if (!m || !plans.value.length) return null;
	return plans.value.find((p) => p.module === m && p.tier === 'starter') ?? null;
});

const starterAllowanceLine = computed(() => {
	const p = starterPlan.value;
	if (!p) return '';
	const parts: string[] = [];
	if (p.module === 'calculators') {
		if (p.slot_allowance != null) parts.push(`${p.slot_allowance} slots`);
		if (p.request_allowance != null) parts.push(`${p.request_allowance.toLocaleString()} req/mo`);
	} else if (p.module === 'kb') {
		if (p.storage_mb != null) parts.push(`${p.storage_mb.toLocaleString()} MB`);
	} else if (p.module === 'flows') {
		if (p.executions != null) parts.push(`${p.executions.toLocaleString()} executions/mo`);
	}
	return parts.length ? `· ${parts.join(' · ')}` : '';
});

function formatEur(n: number | string | null | undefined): string {
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
}

function selectIntent(intent: OnboardingIntent) {
	selectedIntent.value = intent;
}

async function handleIntentNext() {
	if (!selectedIntent.value) return;
	saving.value = true;
	await captureIntent(selectedIntent.value);
	if (selectedIntent.value !== 'unsure' && !plans.value.length) {
		await fetchPlans();
	}
	step.value = 2;
	saving.value = false;
}

async function activateFromTour(mod: Module) {
	selectedIntent.value = mod as unknown as OnboardingIntent;
	if (!plans.value.length) await fetchPlans();
	step.value = 2;
}

async function handleActivate() {
	const mod = activeModule.value;
	if (!mod) return;
	activating.value = true;
	// startCheckout redirects to Stripe; wizard returns via ?success=true&module=X
	await startCheckout({ module: mod, tier: 'starter', billing_cycle: 'monthly', source: 'onboarding' });
	activating.value = false;
}

async function handleSkip() {
	await markCompleted();
	emit('skip');
}

async function handleNextStep() {
	const ns = activeNextStep.value;
	if (!ns) return;
	emit('done');
	router.push(ns.route);
}

// Mark activated when returning from successful Stripe checkout (successModule prop set)
if (props.successModule) {
	markActivated();
	confirmedModuleRef.value = props.successModule;
}
</script>

<style scoped>
.wizard {
	max-width: 700px;
	margin: 0 auto;
}

.wizard-step {
	display: flex;
	flex-direction: column;
	gap: 32px;
}

.wizard-hero {
	text-align: center;
	padding: 24px 0 0;
}

.hero-icon {
	--v-icon-size: 48px;
	color: var(--theme--primary);
	margin-bottom: 16px;
}

.success-icon {
	color: var(--theme--success);
}

.wizard-title {
	font-size: 24px;
	font-weight: 700;
	margin: 0 0 8px;
	color: var(--theme--foreground);
}

.wizard-subtitle {
	font-size: 16px;
	color: var(--theme--foreground-subdued);
	margin: 0;
	line-height: 1.5;
}

/* Intent tiles */
.intent-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 16px;
}

@media (max-width: 600px) {
	.intent-grid {
		grid-template-columns: 1fr;
	}
}

.intent-tile {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 6px;
	padding: 20px;
	border: 2px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
	cursor: pointer;
	text-align: left;
	transition: border-color 0.15s, background 0.15s;
}

.intent-tile:hover {
	border-color: var(--theme--primary);
	background: var(--theme--primary-background);
}

.intent-tile.selected {
	border-color: var(--theme--primary);
	background: var(--theme--primary-background);
}

.tile-icon {
	--v-icon-size: 28px;
	color: var(--theme--primary);
	margin-bottom: 4px;
}

.tile-label {
	font-size: 15px;
	font-weight: 600;
	color: var(--theme--foreground);
}

.tile-desc {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	line-height: 1.4;
}

/* Module details */
.module-details {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 20px;
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
	border: 1px solid var(--theme--border-color);
}

.detail-row {
	display: flex;
	align-items: flex-start;
	gap: 12px;
	font-size: 15px;
	color: var(--theme--foreground);
	line-height: 1.5;
}

/* Tour cards */
.tour-cards {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.tour-card {
	padding: 20px;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.tour-card-header {
	display: flex;
	align-items: center;
	gap: 10px;
}

.tour-card-name {
	font-size: 17px;
	font-weight: 700;
}

.tour-card-body {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
	margin: 0;
	line-height: 1.5;
}

/* Next step */
.next-step-card {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 16px;
	padding: 32px;
	background: var(--theme--primary-background);
	border: 1px solid var(--theme--primary);
	border-radius: var(--theme--border-radius);
	text-align: center;
}

.next-step-label {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
	margin: 0;
	text-transform: uppercase;
	font-weight: 600;
	letter-spacing: 0.05em;
}

/* Wizard action row */
.wizard-actions {
	display: flex;
	justify-content: flex-end;
	gap: 12px;
	flex-wrap: wrap;
	padding-bottom: 16px;
}

.wizard-error {
	margin-top: 8px;
}

.wizard-cancelled-notice {
	margin-bottom: 16px;
}
</style>
