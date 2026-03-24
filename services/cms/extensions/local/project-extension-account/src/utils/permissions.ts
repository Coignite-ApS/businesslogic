/** Permissions utility — builds/parses gateway ResourcePermissions JSONB */

export interface ServicePermission {
	enabled: boolean;
	resources: string[];
	actions: string[];
}

export interface ResourcePermissions {
	services: Record<string, ServicePermission>;
}

export interface PermissionSelection {
	calcResources: string[];
	calcActions: string[];
	calcWildcard: boolean;
	kbResources: string[];
	kbActions: string[];
	kbWildcard: boolean;
}

const DEFAULT_CALC_ACTIONS = ['execute', 'describe'];
const DEFAULT_KB_ACTIONS = ['search', 'ask'];

/** Build gateway-compatible permissions JSONB from UI selections */
export function buildPermissions(selection: PermissionSelection): ResourcePermissions {
	const services: Record<string, ServicePermission> = {};

	const hasCalc = selection.calcWildcard || selection.calcResources.length > 0;
	if (hasCalc) {
		services.calc = {
			enabled: true,
			resources: selection.calcWildcard ? ['*'] : [...selection.calcResources],
			actions: selection.calcActions.length > 0 ? [...selection.calcActions] : DEFAULT_CALC_ACTIONS,
		};
	}

	const hasKb = selection.kbWildcard || selection.kbResources.length > 0;
	if (hasKb) {
		services.kb = {
			enabled: true,
			resources: selection.kbWildcard ? ['*'] : [...selection.kbResources],
			actions: selection.kbActions.length > 0 ? [...selection.kbActions] : DEFAULT_KB_ACTIONS,
		};
	}

	return { services };
}

/** Parse gateway permissions JSONB back to UI selection state */
export function parsePermissions(perms: ResourcePermissions | null | undefined): PermissionSelection {
	const sel: PermissionSelection = {
		calcResources: [],
		calcActions: [...DEFAULT_CALC_ACTIONS],
		calcWildcard: false,
		kbResources: [],
		kbActions: [...DEFAULT_KB_ACTIONS],
		kbWildcard: false,
	};

	if (!perms?.services) return sel;

	const calc = perms.services.calc;
	if (calc?.enabled) {
		if (calc.resources.includes('*')) {
			sel.calcWildcard = true;
		} else {
			sel.calcResources = [...calc.resources];
		}
		if (calc.actions.length > 0) {
			sel.calcActions = [...calc.actions];
		}
	}

	const kb = perms.services.kb;
	if (kb?.enabled) {
		if (kb.resources.includes('*')) {
			sel.kbWildcard = true;
		} else {
			sel.kbResources = [...kb.resources];
		}
		if (kb.actions.length > 0) {
			sel.kbActions = [...kb.actions];
		}
	}

	return sel;
}

/** Summarize permissions for display (e.g. "3 calculators, 1 KB") */
export function summarizePermissions(perms: ResourcePermissions | null | undefined): string {
	if (!perms?.services) return 'No permissions';
	const parts: string[] = [];

	const calc = perms.services.calc;
	if (calc?.enabled) {
		if (calc.resources.includes('*')) {
			parts.push('All calculators');
		} else if (calc.resources.length > 0) {
			parts.push(`${calc.resources.length} calculator${calc.resources.length === 1 ? '' : 's'}`);
		}
	}

	const kb = perms.services.kb;
	if (kb?.enabled) {
		if (kb.resources.includes('*')) {
			parts.push('All KBs');
		} else if (kb.resources.length > 0) {
			parts.push(`${kb.resources.length} KB${kb.resources.length === 1 ? '' : 's'}`);
		}
	}

	return parts.length > 0 ? parts.join(', ') : 'No permissions';
}
