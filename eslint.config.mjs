import happyprimeConfig from '@happyprime/eslint-config';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';

export default [
	...happyprimeConfig,
	jsdoc.configs['flat/recommended'],
	{
		ignores: ['vitest.config.js', '**/*.test.js'],
	},
	{
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		settings: {
			jsdoc: {
				preferredTypes: {
					object: 'Object',
				},
				tagNamePreference: {
					returns: 'return',
					yields: 'yield',
				},
			},
		},
		rules: {
			curly: ['error', 'all'],
			'jsdoc/check-line-alignment': [
				'error',
				'always',
				{
					tags: ['param', 'arg', 'argument', 'property', 'prop'],
					preserveMainDescriptionPostDelimiter: true,
				},
			],
			'no-lonely-if': 'error',
			'jsdoc/check-types': 'error',
			'no-useless-return': 'error',
			'no-unused-expressions': 'error',
			'no-unused-vars': 'error',
			'no-undef': 'error',
			'prefer-const': 'error',
		},
	},
];
