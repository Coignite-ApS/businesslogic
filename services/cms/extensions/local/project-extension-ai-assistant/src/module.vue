<template>
	<private-view title="AI Assistant">
		<template #navigation>
			<conversation-nav
				:conversations="conversations"
				:loading="convLoading"
				:usage="usageData"
				:is-unlimited="isUnlimited"
				:usage-percent="usagePercent"
				:usage-level="usageLevel"
				@new-chat="handleNewChat"
				@archive="handleArchive"
				@upgrade="showUpgradeDialog = true"
			/>
		</template>

		<!-- Feature gate -->
		<div v-if="featureLoading" class="feature-gate-loading">
			<v-progress-circular indeterminate />
		</div>
		<div v-else-if="!featureAllowed" class="feature-gate-unavailable">
			<v-info icon="block" title="Feature Unavailable" center>
				AI Assistant is not available for your account. Contact your administrator.
			</v-info>
		</div>
		<template v-else>
		<div class="ai-assistant">
			<!-- Low-balance banner — slim warning above conversation area -->
			<low-balance-banner
				:balance-eur="walletBalance"
				@topup="showUpgradeDialog = true"
			/>

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

		<!-- AI Wallet top-up dialog -->
		<v-dialog v-model="showUpgradeDialog" @esc="showUpgradeDialog = false">
			<v-card class="wallet-dialog">
				<v-card-title>AI Wallet</v-card-title>
				<v-card-text>
					<div v-if="walletLoading" style="text-align: center; padding: 20px;">
						<v-progress-circular indeterminate />
					</div>
					<div v-else>
						<div class="wallet-current">
							<span class="wallet-label">Current balance</span>
							<span class="wallet-balance" :class="{ low: isWalletLow }">{{ formatWalletEur(walletBalance) }}</span>
						</div>
						<v-notice v-if="isWalletLow" type="warning" style="margin-bottom: 12px;">
							Your balance is low. AI calls will be blocked once it reaches €0.
						</v-notice>
						<p class="wallet-hint">AI usage is billed from your wallet at cost. Top up to keep going.</p>
						<div class="topup-grid">
							<v-button
								v-for="amt in standardTopups"
								:key="amt"
								:loading="checkoutLoading === amt"
								:disabled="checkoutLoading !== null && checkoutLoading !== amt"
								@click="handleTopup(amt)"
							>€{{ amt }}</v-button>
						</div>
					</div>
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="showUpgradeDialog = false">Close</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useFeatureGate } from '../../project-extension-feature-gate/src/use-feature-gate';
import { useApi } from '@directus/extensions-sdk';
import { useRoute, useRouter } from 'vue-router';
import { useActiveAccount } from './composables/use-active-account';
import { useConversations } from './composables/use-conversations';
import { useChat } from './composables/use-chat';
import { useUsage } from './composables/use-usage';
import ConversationNav from './components/conversation-nav.vue';
import LowBalanceBanner from './components/low-balance-banner.vue';
import PromptPicker from './components/prompt-picker.vue';
import MessageBubble from './components/message-bubble.vue';

const api = useApi();
const { allowed: featureAllowed, loading: featureLoading } = useFeatureGate(api, 'ai.chat');
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

// Upgrade dialog state — v2: AI Wallet top-up (no per-month query plans).
const showUpgradeDialog = ref(false);
const walletBalance = ref<number | string>(0);
const walletLoading = ref(false);
const checkoutLoading = ref<number | null>(null);
const standardTopups = [20, 50, 200] as const;

// Init
onMounted(async () => {
	await fetchActiveAccount();
	await Promise.all([fetchConversations(), fetchPrompts(), fetchUsage(), fetchWalletBalance()]);

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

// Wallet dialog — v2: top-up AI Wallet directly (no per-month query plans).
const isWalletLow = computed(() => Number(walletBalance.value) < 1);

watch(showUpgradeDialog, async (open) => {
	if (open) {
		await fetchWalletBalance();
	}
});

async function fetchWalletBalance() {
	walletLoading.value = true;
	try {
		const { data } = await api.get('/wallet/balance');
		walletBalance.value = data.balance_eur ?? 0;
	} catch {
		walletBalance.value = 0;
	} finally {
		walletLoading.value = false;
	}
}

function formatWalletEur(n: number | string | null | undefined): string {
	const v = Number(n || 0);
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(v);
}

async function handleTopup(amount: 20 | 50 | 200) {
	checkoutLoading.value = amount;
	try {
		const { data } = await api.post('/stripe/wallet-topup', { amount_eur: amount });
		if (data.checkout_url) {
			window.location.href = data.checkout_url;
		}
	} catch {
		// Top-up failed
	} finally {
		checkoutLoading.value = null;
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

.wallet-dialog {
	min-width: 380px;
	max-width: 480px;
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
}
.feature-gate-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}
.feature-gate-unavailable {
	padding: var(--content-padding);
	padding-top: 120px;
}
</style>
