import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('CMS-12: Unsaved changes guard', () => {
	describe('composable source', () => {
		const src = readFileSync(join(__dirname, '..', 'composables', 'use-unsaved-guard.ts'), 'utf8');

		it('exports useUnsavedGuard function', () => {
			expect(src).toContain('export function useUnsavedGuard');
		});

		it('uses onBeforeRouteLeave from vue-router', () => {
			expect(src).toContain('onBeforeRouteLeave');
			expect(src).toContain('vue-router');
		});

		it('registers beforeunload listener', () => {
			expect(src).toContain('beforeunload');
			expect(src).toContain('addEventListener');
		});

		it('removes beforeunload listener on unmount', () => {
			expect(src).toContain('onBeforeUnmount');
			expect(src).toContain('removeEventListener');
		});

		it('exposes showDialog, confirmLeave, cancelLeave', () => {
			expect(src).toContain('showDialog');
			expect(src).toContain('confirmLeave');
			expect(src).toContain('cancelLeave');
		});
	});

	describe('configure.vue integration', () => {
		const vue = readFileSync(join(__dirname, '..', 'routes', 'configure.vue'), 'utf8');

		it('imports useUnsavedGuard', () => {
			expect(vue).toContain('useUnsavedGuard');
		});

		it('calls useUnsavedGuard with hasChanges', () => {
			expect(vue).toContain('useUnsavedGuard(hasChanges)');
		});

		it('has unsaved changes dialog in template', () => {
			expect(vue).toContain('showUnsavedDialog');
			expect(vue).toContain('Unsaved Changes');
		});

		it('dialog has Stay and Leave buttons', () => {
			expect(vue).toContain('cancelLeave');
			expect(vue).toContain('confirmLeave');
		});
	});
});
