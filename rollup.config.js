import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

export default [
	{
		input: 'line-observer.js',
		output: {
			file: 'build/line-observer.js',
			format: 'iife',
			name: 'lineObserverBundle',
			exports: 'named',
			generatedCode: 'es2015',
		},
		plugins: [resolve(), terser()],
	},
];
