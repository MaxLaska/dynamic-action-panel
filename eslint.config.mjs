import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
// The sentence-case rule's built-in list of product names. Imported rather than
// copied so that extending it below does not silently drop the defaults — the
// rule's `brands` option REPLACES the list instead of adding to it.
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';

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
			// DOM tests run under happy-dom, which is a standard DOM and not
			// one Obsidian has patched: `createDiv` does not exist there. A
			// fixture built with the standard call is the only one that runs.
			'obsidianmd/prefer-create-el': 'off',
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
	{
		// "Nexus Theme Studio" is a product name, in the same way "Obsidian"
		// is. The rule would lower-case it to "Nexus theme studio", which is a
		// different name. Declared as a brand so its casing is kept while the
		// rest of every string is still checked — narrower than switching the
		// rule off, and scoped to the one plugin that says it.
		files: ['companion/nexus-theme-studio/**/*.ts'],
		rules: {
			'obsidianmd/ui/sentence-case': [
				'warn',
				{ brands: [...DEFAULT_BRANDS, 'Nexus Theme Studio', 'Nexus'] },
			],
		},
	},
);
