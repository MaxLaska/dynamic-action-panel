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
			// Build configs, wherever they live: the root one and the
			// companion plugin's own.
			'**/esbuild.config.mjs',
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
	{
		// The companion plugin works inside the iframe document of the reader
		// ZotFlow embeds. That is a SEPARATE REALM: Obsidian augments its own
		// window's prototypes, never that frame's, so `createEl` and the rest
		// of the convenience API simply do not exist on those nodes. The plain
		// DOM call is not a missed shortcut here, it is the only thing that
		// works.
		files: ['companion/**/*.ts'],
		rules: {
			'obsidianmd/prefer-create-el': 'off',
		},
	},
);
