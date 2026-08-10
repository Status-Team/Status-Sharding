// @ts-check
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import js from '@eslint/js';

export default defineConfig({
	ignores: ['dist/**', '_old/**'],
}, {
	files: ['**/*.ts'],

	extends: [
		js.configs.recommended,
		tseslint.configs.recommended,
	],

	languageOptions: {
		parserOptions: {
			projectService: false,
		},
	},

	rules: {
		'@typescript-eslint/no-unsafe-declaration-merging': 'off',
		'@typescript-eslint/no-unused-vars': 'off',
		'@typescript-eslint/no-explicit-any': 'off',
		'@typescript-eslint/ban-ts-comment': 'off',
		'no-unused-vars': 'off',
		'prefer-const': 'off',
	},
});
