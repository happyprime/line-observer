import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'jsdom',
		globals: true,
		include: ['**/*.test.js'],
		coverage: {
			reporter: ['text', 'json', 'html'],
			include: ['line-observer.js'],
		},
	},
});
