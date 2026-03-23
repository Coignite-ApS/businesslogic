import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'BusinessLogicWidget',
      formats: ['es', 'iife'],
      fileName: (format) => `bl-calculator.${format === 'es' ? 'es' : 'iife'}.js`,
    },
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
