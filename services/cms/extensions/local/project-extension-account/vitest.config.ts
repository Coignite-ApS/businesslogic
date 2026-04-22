import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
	plugins: [vue()],
	resolve: {
		alias: {
			// vue-router is provided by the Directus host at runtime but not installed
			// as a devDependency. Provide a minimal stub for unit tests so components
			// that import useRouter can be mounted without the real package.
			'vue-router': fileURLToPath(new URL('./__tests__/__mocks__/vue-router.ts', import.meta.url)),
		},
	},
	test: {
		environment: 'jsdom',
	},
});
