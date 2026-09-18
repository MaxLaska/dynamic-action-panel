import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';

export default tseslint.config(
	{
		ignores: [
			'**/node_modules/**',
			'**/dist/**',
			'**/scripts/**',
			'**/references/**',
			'esbuild.config.mjs',
			'eslint.config.mjs',
			'version-bump.mjs',
			'versions.json',
			'package.json',
			'main.js',
			'*.js',
		],
	},
	{
		languageOptions: {
			globals: {
				...globals.browser,
				activeDocument: 'readonly',
				activeWindow: 'readonly',
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.js', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Tests and the test runner config are Node-side tooling, not plugin
		// runtime code: Obsidian-specific runtime rules do not apply there.
		files: ['tests/**/*.ts', 'vitest.config.ts'],
		rules: {
			'obsidianmd/no-global-this': 'off',
			'obsidianmd/no-tfile-tfolder-cast': 'off',
			'obsidianmd/no-nodejs-modules': 'off',
			// The deploy tests build fake vaults on disk, where `.obsidian` is
			// a literal directory name and not something a Vault API could be
			// asked about.
			'obsidianmd/hardcoded-config-path': 'off',
		},
	},
);
