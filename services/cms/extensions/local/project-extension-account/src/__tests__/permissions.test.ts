import { describe, it, expect } from 'vitest';
import { buildPermissions, parsePermissions, summarizePermissions } from '../utils/permissions';
import type { PermissionSelection, ResourcePermissions } from '../utils/permissions';

describe('buildPermissions', () => {
	it('builds calc-only permissions with specific resources', () => {
		const sel: PermissionSelection = {
			calcResources: ['calc-1', 'calc-2'],
			calcActions: ['execute', 'describe'],
			calcWildcard: false,
			kbResources: [],
			kbActions: ['search', 'ask'],
			kbWildcard: false,
		};
		const result = buildPermissions(sel);
		expect(result.services.calc).toEqual({
			enabled: true,
			resources: ['calc-1', 'calc-2'],
			actions: ['execute', 'describe'],
		});
		expect(result.services.kb).toBeUndefined();
	});

	it('builds wildcard calc permissions', () => {
		const sel: PermissionSelection = {
			calcResources: [],
			calcActions: ['execute'],
			calcWildcard: true,
			kbResources: [],
			kbActions: [],
			kbWildcard: false,
		};
		const result = buildPermissions(sel);
		expect(result.services.calc?.resources).toEqual(['*']);
	});

	it('builds both calc and KB permissions', () => {
		const sel: PermissionSelection = {
			calcResources: ['calc-1'],
			calcActions: ['execute'],
			calcWildcard: false,
			kbResources: ['kb-1'],
			kbActions: ['search'],
			kbWildcard: false,
		};
		const result = buildPermissions(sel);
		expect(result.services.calc?.enabled).toBe(true);
		expect(result.services.kb?.enabled).toBe(true);
		expect(result.services.kb?.resources).toEqual(['kb-1']);
		expect(result.services.kb?.actions).toEqual(['search']);
	});

	it('returns empty services when nothing selected', () => {
		const sel: PermissionSelection = {
			calcResources: [],
			calcActions: [],
			calcWildcard: false,
			kbResources: [],
			kbActions: [],
			kbWildcard: false,
		};
		const result = buildPermissions(sel);
		expect(result.services).toEqual({});
	});

	it('uses default actions when none selected but resources exist', () => {
		const sel: PermissionSelection = {
			calcResources: ['calc-1'],
			calcActions: [],
			calcWildcard: false,
			kbResources: ['kb-1'],
			kbActions: [],
			kbWildcard: false,
		};
		const result = buildPermissions(sel);
		expect(result.services.calc?.actions).toEqual(['execute', 'describe']);
		expect(result.services.kb?.actions).toEqual(['search', 'ask']);
	});
});

describe('parsePermissions', () => {
	it('parses calc permissions with specific resources', () => {
		const perms: ResourcePermissions = {
			services: {
				calc: { enabled: true, resources: ['calc-1', 'calc-2'], actions: ['execute'] },
			},
		};
		const sel = parsePermissions(perms);
		expect(sel.calcResources).toEqual(['calc-1', 'calc-2']);
		expect(sel.calcActions).toEqual(['execute']);
		expect(sel.calcWildcard).toBe(false);
	});

	it('parses wildcard as calcWildcard=true', () => {
		const perms: ResourcePermissions = {
			services: {
				calc: { enabled: true, resources: ['*'], actions: ['execute', 'describe'] },
			},
		};
		const sel = parsePermissions(perms);
		expect(sel.calcWildcard).toBe(true);
		expect(sel.calcResources).toEqual([]);
	});

	it('returns defaults for null/undefined input', () => {
		expect(parsePermissions(null).calcWildcard).toBe(false);
		expect(parsePermissions(undefined).kbResources).toEqual([]);
	});

	it('round-trips through build→parse', () => {
		const original: PermissionSelection = {
			calcResources: ['a', 'b'],
			calcActions: ['execute'],
			calcWildcard: false,
			kbResources: ['kb-1'],
			kbActions: ['search', 'ask'],
			kbWildcard: false,
		};
		const built = buildPermissions(original);
		const parsed = parsePermissions(built);
		expect(parsed.calcResources).toEqual(original.calcResources);
		expect(parsed.calcActions).toEqual(original.calcActions);
		expect(parsed.kbResources).toEqual(original.kbResources);
	});
});

describe('summarizePermissions', () => {
	it('summarizes specific calculator count', () => {
		const perms: ResourcePermissions = {
			services: {
				calc: { enabled: true, resources: ['a', 'b', 'c'], actions: ['execute'] },
			},
		};
		expect(summarizePermissions(perms)).toBe('3 calculators');
	});

	it('summarizes single calculator', () => {
		const perms: ResourcePermissions = {
			services: {
				calc: { enabled: true, resources: ['a'], actions: ['execute'] },
			},
		};
		expect(summarizePermissions(perms)).toBe('1 calculator');
	});

	it('summarizes wildcard', () => {
		const perms: ResourcePermissions = {
			services: {
				calc: { enabled: true, resources: ['*'], actions: ['execute'] },
			},
		};
		expect(summarizePermissions(perms)).toBe('All calculators');
	});

	it('summarizes both services', () => {
		const perms: ResourcePermissions = {
			services: {
				calc: { enabled: true, resources: ['a'], actions: ['execute'] },
				kb: { enabled: true, resources: ['*'], actions: ['search'] },
			},
		};
		expect(summarizePermissions(perms)).toBe('1 calculator, All KBs');
	});

	it('returns "No permissions" for empty', () => {
		expect(summarizePermissions(null)).toBe('No permissions');
		expect(summarizePermissions({ services: {} })).toBe('No permissions');
	});
});
