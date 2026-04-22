/**
 * Minimal vue-router stub for unit tests.
 * The real vue-router is provided by the Directus host at runtime; this stub
 * satisfies imports during vitest runs without requiring the package.
 */
import { vi } from 'vitest';

export const useRouter = vi.fn(() => ({
	push: vi.fn(),
	replace: vi.fn(),
	go: vi.fn(),
	back: vi.fn(),
	forward: vi.fn(),
	currentRoute: { value: { path: '/', query: {}, params: {} } },
}));

export const useRoute = vi.fn(() => ({
	path: '/',
	query: {},
	params: {},
	name: null,
	meta: {},
}));

export const RouterLink = { template: '<a><slot /></a>' };
export const RouterView = { template: '<div><slot /></div>' };
