<template>
	<div class="skill-section">
		<div v-if="!isDeployed" class="preview-notice">
			<v-icon name="info" />
			<span>Preview — deploy to Formula API to activate these endpoints.</span>
		</div>

		<div class="field">
			<div class="field-row">
				<label class="field-label">Override AI Name & Template</label>
				<v-checkbox
					:model-value="overrideOn"
					:disabled="env === 'live'"
					icon-on="toggle_on"
					icon-off="toggle_off"
					@update:model-value="toggleOverride"
				/>
			</div>
			<span class="field-hint">Override the global AI name and response template for Skill only.</span>
		</div>

		<template v-if="overrideOn">
			<div class="field">
				<label class="field-label">Skill Name</label>
				<v-input
					:model-value="integration.skillName || ''"
					:disabled="env === 'live'"
					placeholder="e.g. Mortgage Calculator"
					@update:model-value="emit('update:integration', { ...integration, skillName: $event })"
				/>
				<span class="field-hint">Name shown to the AI when using this Skill. Defaults to AI Name.</span>
			</div>
			<div class="field">
				<template-editor
					:model-value="integration.skillResponseOverride || ''"
					:input-params="inputParamKeys"
					:output-params="outputParamKeys"
					placeholder="Skill-specific response template..."
					:disabled="env === 'live'"
					@update:model-value="emit('update:integration', { ...integration, skillResponseOverride: $event })"
				/>
			</div>
			<div v-if="overrideDirty && env === 'test'" class="override-save">
				<v-button :loading="saving" @click="emit('save-overrides')">
					<v-icon name="check" left />
					Save Overrides
				</v-button>
			</div>
		</template>

		<h2 class="section-title">SKILL.md</h2>
		<p class="section-desc">This file tells Claude how to use your calculator as a skill.</p>

		<div class="view-code-tabs">
			<button
				class="view-code-tab"
				:class="{ active: viewMode === 'view' }"
				@click="viewMode = 'view'"
			>
				View
			</button>
			<button
				class="view-code-tab"
				:class="{ active: viewMode === 'code' }"
				@click="viewMode = 'code'"
			>
				Code
			</button>
		</div>

		<div v-if="viewMode === 'view'" class="rendered-md" v-html="renderedMd"></div>
		<code-block v-else :code="skillMd" language="markdown" />

		<div class="action-row">
			<v-button secondary @click="copySkillMd">
				<v-icon name="content_copy" left />
				{{ copied === 'md' ? 'Copied!' : 'Copy SKILL.md' }}
			</v-button>
			<v-button secondary @click="handleDownload">
				<v-icon name="download" left />
				Download Zip
			</v-button>
		</div>

		<h2 class="section-title">Install Instructions</h2>
		<div class="instructions">
			<h3>Project Skill</h3>
			<p>Place the <code>SKILL.md</code> file in your project's <code>.claude/skills/</code> directory:</p>
			<code-block :code="projectInstall" language="bash" />

			<h3>Global Skill</h3>
			<p>Place it in your home directory to make it available across all projects:</p>
			<code-block :code="globalInstall" language="bash" />

			<h3>Usage</h3>
			<p>Once installed, use it in Claude Code with:</p>
			<code-block :code="usageExample" language="bash" />
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import CodeBlock from './code-block.vue';

const ALLOWED_TAGS = [
	'p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i',
	'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
	'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
	'span', 'div', 'hr', 'del', 'sup', 'sub',
];

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class', 'id'];
import TemplateEditor from './template-editor.vue';
import { downloadZip } from '../utils/download-zip';
import { generateSkillMd } from '../utils/integration-files';
import type { IntegrationConfig, InputParameter, OutputParameter } from '../types';

const props = defineProps<{
	calculatorId: string;
	effectiveId: string;
	isDeployed: boolean;
	env: 'test' | 'live';
	integration: IntegrationConfig;
	storedIntegration: IntegrationConfig;
	inputParams: string[];
	outputParams: string[];
	calculatorName: string;
	calculatorDescription: string | null;
	formulaApiUrl: string;
	apiKey: string;
	toolName: string;
	inputConfig: Record<string, InputParameter>;
	outputConfig: Record<string, OutputParameter>;
	saving?: boolean;
}>();

const emit = defineEmits<{
	(e: 'update:integration', val: IntegrationConfig): void;
	(e: 'save-overrides'): void;
}>();

const copied = ref<string | null>(null);
const viewMode = ref<'view' | 'code'>('view');

const overrideOn = ref(
	!!(props.integration.skillResponseOverride || props.integration.skillName),
);

// Sync from parent when stored integration changes (e.g. env switch)
watch(() => props.storedIntegration, () => {
	overrideOn.value = !!(props.integration.skillResponseOverride || props.integration.skillName);
});

const inputParamKeys = computed(() => props.inputParams);
const outputParamKeys = computed(() => props.outputParams);

const overrideDirty = computed(() => {
	const stored = props.storedIntegration;
	return (props.integration.skillName ?? '') !== (stored.skillName ?? '')
		|| (props.integration.skillResponseOverride ?? '') !== (stored.skillResponseOverride ?? '');
});

function toggleOverride(on: boolean) {
	overrideOn.value = on;
	if (!on) {
		emit('update:integration', {
			...props.integration,
			skillName: '',
			skillResponseOverride: '',
		});
	}
}

const skillMd = computed(() =>
	generateSkillMd({
		calculatorName: props.calculatorName,
		calculatorDescription: props.calculatorDescription,
		effectiveId: props.effectiveId,
		toolName: props.toolName,
		formulaApiUrl: props.formulaApiUrl,
		apiKey: props.apiKey,
		inputParams: props.inputConfig,
		outputParams: props.outputConfig,
	}),
);

const renderedMd = computed(() => {
	if (!skillMd.value) return '';
	const raw = marked(skillMd.value) as string;
	return DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR });
});

const projectInstall = computed(() =>
	`mkdir -p .claude/skills/${props.toolName}/\ncp SKILL.md .claude/skills/${props.toolName}/SKILL.md`,
);

const globalInstall = computed(() =>
	`mkdir -p ~/.claude/skills/${props.toolName}/\ncp SKILL.md ~/.claude/skills/${props.toolName}/SKILL.md`,
);

const usageExample = computed(() =>
	`# In Claude Code, type:\n/${props.toolName}`,
);

function copySkillMd() {
	navigator.clipboard.writeText(skillMd.value);
	copied.value = 'md';
	setTimeout(() => { copied.value = null; }, 2000);
}

async function handleDownload() {
	await downloadZip(
		{ 'SKILL.md': skillMd.value },
		`${props.toolName}-skill`,
	);
}
</script>

<style scoped>
.skill-section {
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.field {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.field-row {
	display: flex;
	align-items: center;
	gap: 12px;
}

.field-label {
	font-weight: 600;
	font-size: 14px;
}

.field-hint {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.preview-notice {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 16px;
	background: var(--theme--primary-background);
	border-radius: var(--theme--border-radius);
	font-size: 14px;
	color: var(--theme--primary);
}

.section-title {
	font-size: 18px;
	font-weight: 700;
	margin: 8px 0 0;
}

.section-desc {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin: 0;
}

.view-code-tabs {
	display: flex;
	gap: 0;
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
	width: fit-content;
}

.view-code-tab {
	padding: 6px 16px;
	font-size: 13px;
	font-weight: 600;
	background: var(--theme--background);
	border: none;
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	transition: background 0.15s, color 0.15s;
}

.view-code-tab:not(:last-child) {
	border-right: var(--theme--border-width) solid var(--theme--border-color);
}

.view-code-tab:hover {
	color: var(--theme--foreground);
}

.view-code-tab.active {
	background: var(--theme--primary);
	color: var(--theme--primary-foreground, #fff);
}

.rendered-md {
	padding: 16px;
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
	font-size: 14px;
	line-height: 1.6;
	overflow: auto;
}

.rendered-md :deep(h1) { font-size: 20px; font-weight: 700; margin: 16px 0 8px; }
.rendered-md :deep(h2) { font-size: 17px; font-weight: 700; margin: 14px 0 6px; }
.rendered-md :deep(h3) { font-size: 15px; font-weight: 600; margin: 12px 0 4px; }
.rendered-md :deep(p) { margin: 6px 0; }
.rendered-md :deep(code) {
	background: var(--theme--background-normal);
	padding: 2px 6px;
	border-radius: 4px;
	font-size: 13px;
}
.rendered-md :deep(pre) {
	background: var(--theme--background-normal);
	padding: 12px;
	border-radius: 6px;
	overflow-x: auto;
}
.rendered-md :deep(pre code) {
	background: none;
	padding: 0;
}
.rendered-md :deep(ul), .rendered-md :deep(ol) { padding-left: 20px; margin: 6px 0; }

.override-save {
	display: flex;
	gap: 8px;
}

.action-row {
	display: flex;
	gap: 8px;
}

.instructions {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.instructions h3 {
	font-size: 14px;
	font-weight: 600;
	margin: 8px 0 0;
}

.instructions p {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin: 0;
}

.instructions code {
	background: var(--theme--background-subdued);
	padding: 2px 6px;
	border-radius: 4px;
	font-size: 12px;
}
</style>
