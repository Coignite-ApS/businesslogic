<template>
	<private-view title="AI Assistant">
		<template #navigation>
			<conversation-nav
				:conversations="conversations"
				:current-id="currentConversationId"
				:loading="convLoading"
				:usage="usageData"
				:is-unlimited="isUnlimited"
				:usage-percent="usagePercent"
				:usage-level="usageLevel"
				@new-chat="handleNewChat"
				@select="handleSelectConversation"
				@archive="handleArchive"
				@upgrade="showUpgradeDialog = true"
			/>
		</template>

		<div class="ai-assistant">
			<!-- Empty state / prompt picker -->
			<template v-if="!currentConversationId && !streaming">
				<prompt-picker :prompts="prompts" @select="handlePromptSelect" />
			</template>

			<!-- Chat view -->
			<template v-else>
				<div class="chat-messages" ref="messagesContainer">
					<message-bubble
						v-for="(msg, i) in messages"
						:key="i"
						:message="msg"
						:conversation-id="currentConversationId"
						@feedback="handleKbFeedback"
						@send-message="handleSendFromWidget"
					/>
				</div>
			</template>

			<!-- Error banner (hidden when at limit — limit card handles it) -->
			<div v-if="chatError && !isAtLimit" class="chat-error">
				<v-icon name="error" small />
				{{ chatError }}
			</div>

			<!-- Limit reached — replaces input area with friendly card -->
			<div v-if="isAtLimit && usageData" class="chat-limit-card">
				<div class="limit-card-inner">
					<p class="limit-heading">You've used all {{ usageData.queries_limit }} queries this month</p>
					<p class="limit-subtext">Your queries reset on {{ resetDate }}. You can still browse past conversations.</p>
					<div class="limit-actions">
						<v-button small @click="showUpgradeDialog = true">Upgrade for more</v-button>
					</div>
				</div>
			</div>

			<!-- Normal input area -->
			<div v-else class="chat-input-area">
				<div class="chat-input-wrapper">
					<textarea
						ref="inputEl"
						v-model="inputMessage"
						:placeholder="streaming ? 'Waiting for response...' : 'Type a message...'"
						:disabled="streaming"
						rows="1"
						@keydown="handleKeydown"
						@input="autoResize"
					></textarea>
					<v-button
						v-if="streaming"
						icon
						rounded
						small
						class="send-btn"
						@click="stopStreaming"
					>
						<v-icon name="stop" />
					</v-button>
					<v-button
						v-else
						icon
						rounded
						small
						class="send-btn"
						:disabled="!inputMessage.trim()"
						@click="handleSend"
					>
						<v-icon name="send" />
					</v-button>
				</div>
			</div>
		</div>

		<!-- Upgrade dialog -->
		<v-dialog v-model="showUpgradeDialog" @esc="showUpgradeDialog = false">
			<v-card>
				<v-card-title>Upgrade Your Plan</v-card-title>
				<v-card-text>
					<p style="margin-bottom: 16px;">Upgrade to get more AI queries per month.</p>
					<div v-if="upgradePlans.length" class="upgrade-plans">
						<div
							v-for="plan in upgradePlans"
							:key="plan.id"
							class="upgrade-plan-card"
							:class="{ current: plan.id === currentPlanId }"
						>
							<div class="plan-name">{{ plan.name }}</div>
							<div class="plan-price">${{ (plan.monthly_price / 100).toFixed(0) }}<span>/mo</span></div>
							<div class="plan-queries">
								{{ plan.ai_queries_per_month === null ? 'Unlimited' : plan.ai_queries_per_month }} AI queries/mo
							</div>
							<v-button
								v-if="plan.id !== currentPlanId"
								small
								full-width
								@click="handleCheckout(plan.id)"
								:loading="checkoutLoading"
							>
								{{ plan.sort > (currentPlanSort || 0) ? 'Upgrade' : 'Switch' }}
							</v-button>
							<v-button v-else small full-width disabled>Current Plan</v-button>
						</div>
					</div>
					<div v-else-if="plansLoading" style="text-align: center; padding: 20px;">
						<v-progress-circular indeterminate />
					</div>
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="showUpgradeDialog = false">Close</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</private-view>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useRoute, useRouter } from 'vue-router';
import { useActiveAccount } from './composables/use-active-account';
import { useConversations } from './composables/use-conversations';
import { useChat } from './composables/use-chat';
import { useUsage } from './composables/use-usage';
import ConversationNav from './components/conversation-nav.vue';
import PromptPicker from './components/prompt-picker.vue';
import MessageBubble from './components/message-bubble.vue';

const api = useApi();
const route = useRoute();
const router = useRouter();

const { activeAccountId, fetchActiveAccount } = useActiveAccount(api);
const {
	conversations,
	currentConversation,
	loading: convLoading,
	fetchConversations,
	fetchConversation,
	archiveConversation,
} = useConversations(api);
const {
	messages,
	streaming,
	error: chatError,
	loadMessages,
	sendMessage,
	stopStreaming,
	clearMessages,
} = useChat(api);
const {
	usage: usageData,
	isUnlimited,
	isAtLimit,
	usagePercent,
	usageLevel,
	resetDate,
	fetchUsage,
} = useUsage(api);

const currentConversationId = ref<string | null>(null);
const inputMessage = ref('');
const prompts = ref<any[]>([]);
const messagesContainer = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);
const pendingPromptId = ref<string | null>(null);

// Upgrade dialog state
const showUpgradeDialog = ref(false);
const upgradePlans = ref<any[]>([]);
const currentPlanId = ref<string | null>(null);
const currentPlanSort = ref<number | null>(null);
const plansLoading = ref(false);
const checkoutLoading = ref(false);

// Init
onMounted(async () => {
	await fetchActiveAccount();
	await Promise.all([fetchConversations(), fetchPrompts(), fetchUsage()]);

	// Load conversation from route param
	const routeId = route.params.id as string;
	if (routeId) {
		await loadConversation(routeId);
	}
});

// Watch route changes
watch(() => route.params.id, async (newId) => {
	if (newId && newId !== currentConversationId.value) {
		await loadConversation(newId as string);
	} else if (!newId) {
		currentConversationId.value = null;
		clearMessages();
	}
});

async function fetchPrompts() {
	try {
		const { data } = await api.get('/assistant/prompts');
		prompts.value = data.data || [];
	} catch {
		prompts.value = [];
	}
}

async function loadConversation(id: string) {
	currentConversationId.value = id;
	const conv = await fetchConversation(id);
	if (conv) {
		loadMessages(conv.messages || []);
		await nextTick();
		scrollToBottom();
	}
}

function handleNewChat() {
	currentConversationId.value = null;
	clearMessages();
	pendingPromptId.value = null;
	router.push('/ai-assistant');
}

async function handleSelectConversation(id: string) {
	router.push(`/ai-assistant/${id}`);
}

async function handleArchive(id: string) {
	await archiveConversation(id);
	if (currentConversationId.value === id) {
		handleNewChat();
	}
}

function handlePromptSelect(prompt: any) {
	if (prompt.user_prompt_template) {
		inputMessage.value = prompt.user_prompt_template;
		pendingPromptId.value = prompt.id;
		nextTick(() => inputEl.value?.focus());
	}
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault();
		handleSend();
	}
}

async function handleSend() {
	const msg = inputMessage.value.trim();
	if (!msg || streaming.value) return;

	inputMessage.value = '';
	resetTextareaHeight();

	const newId = await sendMessage(
		currentConversationId.value,
		msg,
		pendingPromptId.value || undefined,
	);

	pendingPromptId.value = null;

	if (newId && newId !== currentConversationId.value) {
		currentConversationId.value = newId;
		router.push(`/ai-assistant/${newId}`);
		// Refresh conversation list
		await fetchConversations();
	}

	// Refresh usage after each message
	await fetchUsage();

	await nextTick();
	scrollToBottom();
}

async function handleKbFeedback(data: any) {
	try {
		await api.post('/kb/feedback', data);
	} catch {
		// Silent fail — feedback is non-critical
	}
}

async function handleSendFromWidget(text: string) {
	if (!text || streaming.value) return;
	inputMessage.value = text;
	await handleSend();
}

// Upgrade dialog
watch(showUpgradeDialog, async (open) => {
	if (open && upgradePlans.value.length === 0) {
		await fetchUpgradeData();
	}
});

async function fetchUpgradeData() {
	plansLoading.value = true;
	try {
		const [plansRes, subRes] = await Promise.all([
			api.get('/items/subscription_plans', {
				params: {
					filter: { status: { _eq: 'published' } },
					sort: ['sort'],
					fields: ['id', 'name', 'monthly_price', 'yearly_price', 'ai_queries_per_month', 'sort'],
				},
			}),
			api.get('/items/subscriptions', {
				params: {
					filter: { account: { _eq: activeAccountId.value } },
					fields: ['plan.id', 'plan.sort'],
					limit: 1,
				},
			}),
		]);
		upgradePlans.value = plansRes.data.data || [];
		const sub = subRes.data.data?.[0];
		if (sub?.plan) {
			currentPlanId.value = sub.plan.id || sub.plan;
			currentPlanSort.value = sub.plan.sort ?? null;
		}
	} catch {
		upgradePlans.value = [];
	} finally {
		plansLoading.value = false;
	}
}

async function handleCheckout(planId: string) {
	checkoutLoading.value = true;
	try {
		const { data } = await api.post('/stripe/checkout', { plan_id: planId });
		if (data.url) {
			window.location.href = data.url;
		}
	} catch {
		// Checkout failed
	} finally {
		checkoutLoading.value = false;
	}
}

// Auto-scroll on new content
watch(messages, () => {
	nextTick(() => scrollToBottom());
}, { deep: true });

function scrollToBottom() {
	if (messagesContainer.value) {
		messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
	}
}

function autoResize() {
	if (!inputEl.value) return;
	inputEl.value.style.height = 'auto';
	inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, 150) + 'px';
}

function resetTextareaHeight() {
	if (inputEl.value) {
		inputEl.value.style.height = 'auto';
	}
}
</script>

<style scoped>
.ai-assistant {
	display: flex;
	flex-direction: column;
	height: calc(100% - 4px);
	overflow: hidden;
}

.chat-messages {
	flex: 1;
	overflow-y: auto;
	padding: 20px 24px;
	display: flex;
	flex-direction: column;
}

.chat-error {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 16px;
	margin: 0 24px;
	background: var(--theme--danger-background);
	color: var(--theme--danger);
	border-radius: 8px;
	font-size: 13px;
}

.chat-input-area {
	padding: 12px 24px 20px;
	border-top: 1px solid var(--theme--border-color);
}

.chat-input-wrapper {
	display: flex;
	align-items: flex-end;
	gap: 8px;
	background: var(--theme--background-subdued);
	border: 1px solid var(--theme--border-color);
	border-radius: 12px;
	padding: 8px 12px;
	transition: border-color 0.15s;
}

.chat-input-wrapper:focus-within {
	border-color: var(--theme--primary);
}

.chat-input-wrapper textarea {
	flex: 1;
	border: none;
	background: none;
	resize: none;
	outline: none;
	font-size: 14px;
	line-height: 1.5;
	color: var(--theme--foreground);
	font-family: var(--theme--fonts--sans--font-family);
	min-height: 24px;
	max-height: 150px;
}

.chat-input-wrapper textarea::placeholder {
	color: var(--theme--foreground-subdued);
}

.send-btn {
	--v-button-background-color: var(--theme--primary);
	--v-button-color: var(--theme--primary-foreground, #fff);
	--v-button-background-color-hover: var(--theme--primary-accent);
	flex-shrink: 0;
}

.chat-limit-card {
	padding: 16px 24px 20px;
	border-top: 1px solid var(--theme--border-color);
}

.limit-card-inner {
	background: var(--theme--background-subdued);
	border: 1px solid var(--theme--border-color);
	border-radius: 12px;
	padding: 20px;
	text-align: center;
}

.limit-heading {
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground);
	margin: 0 0 6px;
}

.limit-subtext {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin: 0 0 16px;
	line-height: 1.5;
}

.limit-actions {
	display: flex;
	justify-content: center;
	gap: 10px;
}

.upgrade-plans {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	gap: 12px;
}

.upgrade-plan-card {
	padding: 16px;
	border: 2px solid var(--theme--border-color);
	border-radius: 8px;
	text-align: center;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.upgrade-plan-card.current {
	border-color: var(--theme--primary);
}

.plan-name {
	font-weight: 600;
	font-size: 16px;
}

.plan-price {
	font-size: 28px;
	font-weight: 700;
	color: var(--theme--foreground);
}

.plan-price span {
	font-size: 14px;
	font-weight: 400;
	color: var(--theme--foreground-subdued);
}

.plan-queries {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin-bottom: 8px;
}
</style>
