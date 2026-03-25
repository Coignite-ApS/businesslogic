import { describe, it, expect } from 'vitest';
import type { IntegrationConfig, McpConfig } from '../types';

/**
 * Tests for AI name & response template fallback logic.
 *
 * Rule: if a per-integration name/template override is empty/falsy,
 * fall back to the general ai_name / responseTemplate.
 */

function resolveIntegrationName(
	aiName: string,
	override: string | undefined | null,
): string {
	return override?.trim() ? override.trim() : aiName;
}

function resolveIntegrationTemplate(
	generalTemplate: string,
	override: string | undefined | null,
): string {
	return override?.trim() ? override.trim() : generalTemplate;
}

function resolveMcpName(
	aiName: string,
	toolName: string,
): string {
	// MCP always uses toolName (its own field); ai_name is fallback when toolName is blank
	return toolName.trim() ? toolName.trim() : aiName;
}

function resolveEffectiveSkillConfig(
	aiName: string,
	generalTemplate: string,
	integration: IntegrationConfig,
): { name: string; template: string } {
	return {
		name: resolveIntegrationName(aiName, integration.skillName),
		template: resolveIntegrationTemplate(generalTemplate, integration.skillResponseOverride),
	};
}

function resolveEffectivePluginConfig(
	aiName: string,
	generalTemplate: string,
	integration: IntegrationConfig,
): { name: string; template: string } {
	return {
		name: resolveIntegrationName(aiName, integration.coworkName),
		template: resolveIntegrationTemplate(generalTemplate, integration.pluginResponseOverride),
	};
}

describe('ai name fallback — resolveIntegrationName', () => {
	it('uses override when provided', () => {
		expect(resolveIntegrationName('Mortgage Calculator', 'Mortgage Check')).toBe('Mortgage Check');
	});

	it('falls back to ai_name when override empty', () => {
		expect(resolveIntegrationName('Mortgage Calculator', '')).toBe('Mortgage Calculator');
	});

	it('falls back to ai_name when override undefined', () => {
		expect(resolveIntegrationName('Mortgage Calculator', undefined)).toBe('Mortgage Calculator');
	});

	it('falls back to ai_name when override null', () => {
		expect(resolveIntegrationName('Mortgage Calculator', null)).toBe('Mortgage Calculator');
	});

	it('trims whitespace-only override (treat as empty)', () => {
		expect(resolveIntegrationName('Mortgage Calculator', '   ')).toBe('Mortgage Calculator');
	});
});

describe('template fallback — resolveIntegrationTemplate', () => {
	it('uses override when provided', () => {
		expect(resolveIntegrationTemplate('Global template', 'Skill-specific template')).toBe('Skill-specific template');
	});

	it('falls back to general template when override empty', () => {
		expect(resolveIntegrationTemplate('Global template', '')).toBe('Global template');
	});

	it('falls back to general template when override undefined', () => {
		expect(resolveIntegrationTemplate('Global template', undefined)).toBe('Global template');
	});

	it('treats whitespace-only override as empty', () => {
		expect(resolveIntegrationTemplate('Global template', '   ')).toBe('Global template');
	});
});

describe('MCP name resolution — resolveMcpName', () => {
	it('uses toolName when set', () => {
		expect(resolveMcpName('Mortgage Calculator', 'mortgage_check')).toBe('mortgage_check');
	});

	it('falls back to ai_name when toolName is empty', () => {
		expect(resolveMcpName('Mortgage Calculator', '')).toBe('Mortgage Calculator');
	});
});

describe('effective Skill config — resolveEffectiveSkillConfig', () => {
	it('uses skillName and skillResponseOverride when set', () => {
		const integration: IntegrationConfig = {
			responseTemplate: 'Global',
			skill: true,
			plugin: false,
			skillName: 'Mortgage Tool',
			skillResponseOverride: 'Skill template',
		};
		const result = resolveEffectiveSkillConfig('AI Name', 'Global', integration);
		expect(result.name).toBe('Mortgage Tool');
		expect(result.template).toBe('Skill template');
	});

	it('falls back to ai_name and global template when overrides empty', () => {
		const integration: IntegrationConfig = {
			responseTemplate: 'Global template',
			skill: true,
			plugin: false,
			skillName: '',
			skillResponseOverride: '',
		};
		const result = resolveEffectiveSkillConfig('AI Name', 'Global template', integration);
		expect(result.name).toBe('AI Name');
		expect(result.template).toBe('Global template');
	});

	it('applies mixed partial overrides correctly', () => {
		const integration: IntegrationConfig = {
			responseTemplate: 'Global template',
			skill: true,
			plugin: false,
			skillName: 'Custom Skill Name',
			skillResponseOverride: '',
		};
		const result = resolveEffectiveSkillConfig('AI Name', 'Global template', integration);
		expect(result.name).toBe('Custom Skill Name');
		expect(result.template).toBe('Global template');
	});
});

describe('effective Plugin config — resolveEffectivePluginConfig', () => {
	it('uses coworkName and pluginResponseOverride when set', () => {
		const integration: IntegrationConfig = {
			responseTemplate: 'Global',
			skill: false,
			plugin: true,
			coworkName: 'Mortgage Plugin',
			pluginResponseOverride: 'Plugin template',
		};
		const result = resolveEffectivePluginConfig('AI Name', 'Global', integration);
		expect(result.name).toBe('Mortgage Plugin');
		expect(result.template).toBe('Plugin template');
	});

	it('falls back to ai_name and global template when overrides missing', () => {
		const integration: IntegrationConfig = {
			responseTemplate: 'Global template',
			skill: false,
			plugin: true,
		};
		const result = resolveEffectivePluginConfig('AI Name', 'Global template', integration);
		expect(result.name).toBe('AI Name');
		expect(result.template).toBe('Global template');
	});
});

describe('override dirty detection', () => {
	function isSkillOverrideDirty(current: IntegrationConfig, stored: IntegrationConfig): boolean {
		return (current.skillName ?? '') !== (stored.skillName ?? '')
			|| (current.skillResponseOverride ?? '') !== (stored.skillResponseOverride ?? '');
	}

	function isPluginOverrideDirty(current: IntegrationConfig, stored: IntegrationConfig): boolean {
		return (current.coworkName ?? '') !== (stored.coworkName ?? '')
			|| (current.pluginResponseOverride ?? '') !== (stored.pluginResponseOverride ?? '');
	}

	it('detects skill name change as dirty', () => {
		const stored: IntegrationConfig = { responseTemplate: '', skill: true, plugin: false, skillName: '' };
		const current: IntegrationConfig = { ...stored, skillName: 'New Name' };
		expect(isSkillOverrideDirty(current, stored)).toBe(true);
	});

	it('detects skill template change as dirty', () => {
		const stored: IntegrationConfig = { responseTemplate: '', skill: true, plugin: false, skillResponseOverride: '' };
		const current: IntegrationConfig = { ...stored, skillResponseOverride: 'New template' };
		expect(isSkillOverrideDirty(current, stored)).toBe(true);
	});

	it('reports clean when skill overrides unchanged', () => {
		const stored: IntegrationConfig = { responseTemplate: '', skill: true, plugin: false, skillName: 'Same', skillResponseOverride: 'Same' };
		const current: IntegrationConfig = { ...stored };
		expect(isSkillOverrideDirty(current, stored)).toBe(false);
	});

	it('reports clean when both undefined', () => {
		const stored: IntegrationConfig = { responseTemplate: '', skill: true, plugin: false };
		const current: IntegrationConfig = { responseTemplate: '', skill: true, plugin: false };
		expect(isSkillOverrideDirty(current, stored)).toBe(false);
	});

	it('treats undefined and empty string as equal', () => {
		const stored: IntegrationConfig = { responseTemplate: '', skill: true, plugin: false, skillName: undefined };
		const current: IntegrationConfig = { responseTemplate: '', skill: true, plugin: false, skillName: '' };
		expect(isSkillOverrideDirty(current, stored)).toBe(false);
	});

	it('detects plugin name change as dirty', () => {
		const stored: IntegrationConfig = { responseTemplate: '', skill: false, plugin: true, coworkName: '' };
		const current: IntegrationConfig = { ...stored, coworkName: 'New Plugin' };
		expect(isPluginOverrideDirty(current, stored)).toBe(true);
	});

	it('detects plugin template change as dirty', () => {
		const stored: IntegrationConfig = { responseTemplate: '', skill: false, plugin: true, pluginResponseOverride: '' };
		const current: IntegrationConfig = { ...stored, pluginResponseOverride: 'New template' };
		expect(isPluginOverrideDirty(current, stored)).toBe(true);
	});

	it('reports clean when plugin overrides unchanged', () => {
		const stored: IntegrationConfig = { responseTemplate: '', skill: false, plugin: true, coworkName: 'Same', pluginResponseOverride: 'Same' };
		const current: IntegrationConfig = { ...stored };
		expect(isPluginOverrideDirty(current, stored)).toBe(false);
	});
});

describe('IntegrationConfig shape — new fields', () => {
	it('IntegrationConfig accepts skillName and coworkName', () => {
		const cfg: IntegrationConfig = {
			responseTemplate: '',
			skill: true,
			plugin: true,
			skillName: 'My Skill',
			coworkName: 'My Plugin',
		};
		expect(cfg.skillName).toBe('My Skill');
		expect(cfg.coworkName).toBe('My Plugin');
	});

	it('IntegrationConfig works without optional name fields', () => {
		const cfg: IntegrationConfig = {
			responseTemplate: '',
			skill: false,
			plugin: false,
		};
		expect(cfg.skillName).toBeUndefined();
		expect(cfg.coworkName).toBeUndefined();
	});
});
