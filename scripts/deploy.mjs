// scripts/deploy.mjs
// Deployment script for the Obsidian plugin.
//
// Usage:
//   node scripts/deploy.mjs dev   // dev mode: symlink dist into the vault
//   node scripts/deploy.mjs build // build mode: copy dist into the vault plugin directory
//
// Conventions:
// - The mode argument ("dev" or "build") is required; without it the script exits with an error.
// - A .env file in the project root must define:
//     VAULT_PATH=/path/to/your/Obsidian/vault
// - The plugin id is read from the id field of manifest.json; the deploy target is:
//     <VAULT_PATH>/.obsidian/plugins/<pluginId>/
//
// Flow:
// 1. Parse the mode argument (dev/build).
// 2. Resolve and validate the vault path and the plugin id.
// 3. Prepare the dist directory, including the .hotreload marker.
// 4. Create or reuse the symlink in dev mode, or copy the build output in build mode.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Merges the key/value pairs of a .env file into process.env without overwriting existing variables (the dotenv default).
 * Only the common format is supported: KEY=value, optional quotes, # comment lines and blank lines.
 * @param {string} filePath Absolute path of the .env file
 */
function applyDotenvFile(filePath) {
	const content = fs.readFileSync(filePath, 'utf8');
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const eq = trimmed.indexOf('=');
		if (eq === -1) {
			continue;
		}
		const key = trimmed.slice(0, eq).trim();
		if (!key) {
			continue;
		}
		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../');
const envPath = path.join(projectRoot, '.env');
const distDir = path.join(projectRoot, 'dist');
const manifestPath = path.join(projectRoot, 'manifest.json');

// ==================== Helpers ====================

/**
 * Small logging helper that unifies the console output and prefixes it with an icon.
 * Prefer it over console.log/console.error inside this script.
 */
const log = {
	success: (msg) => console.log(`✅ ${msg}`),
	error: (msg) => console.error(`❌ ${msg}`),
	info: (msg) => console.log(`ℹ️  ${msg}`),
	warn: (msg) => console.warn(`⚠️  ${msg}`),
};

/**
 * Recursively copies a directory, including all sub-directories and files.
 * Used to copy the build output into the plugin directory.
 * @param src Source directory
 * @param dest Target directory
 */
function copyDir(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	
	const entries = fs.readdirSync(src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		
		if (entry.isDirectory()) {
			copyDir(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

/**
 * Builds a clickable path link using OSC 8 escape sequences, which some terminals render as a link.
 * Used to make local paths in the console output directly openable.
 * @param filePath Local file or directory path
 * @param displayText Text shown to the user (optional; defaults to the raw path)
 * @returns A string carrying the terminal hyperlink escape sequences
 */
function createClickablePath(filePath, displayText) {
	const resolvedPath = path.resolve(filePath);
	let targetPathForUrl = resolvedPath;

	// Append a trailing "/" for directories; some terminals and systems open them more reliably that way.
	try {
		if (fs.existsSync(resolvedPath) && fs.lstatSync(resolvedPath).isDirectory()) {
			targetPathForUrl = resolvedPath.endsWith(path.sep) ? resolvedPath : resolvedPath + path.sep;
		}
	} catch {
		// Ignored: producing the URL at all is enough.
	}

	// Build the file:// URL through the standard API, which handles Windows drive letters and spaces.
	const fileUrl = pathToFileURL(targetPathForUrl).href;
	const text = displayText ?? path.basename(resolvedPath);
	return `\x1b]8;;${fileUrl}\x1b\\${text}\x1b]8;;\x1b\\`;
}

// ==================== Argument and config parsing ====================

/**
 * Parses the command line arguments and returns the mode.
 * Two modes are supported: dev and build.
 * - "dev"   -> dev mode
 * - "build" -> build mode
 * - anything else, or no argument at all, is rejected and exits with an error
 * @param argv The Node.js process.argv array
 * @returns The mode string: "dev" | "build"
 */
function parseMode(argv) {
	const arg = argv[2];

	if (arg === 'dev') {
		return 'dev';
	}

	if (arg === 'build') {
		return 'build';
	}

	if (!arg) {
		log.error('Missing mode argument; use "dev" or "build".');
	} else {
		log.error(`Unsupported mode argument: "${arg}"; use "dev" or "build".`);
	}
	process.exit(1);
}

/**
 * Resolves the absolute path of the Obsidian vault.
 * - Without a .env file the script exits silently, so CI/CD can skip the deployment.
 * - Without VAULT_PATH it prints an error and exits.
 * @returns The resolved absolute vault path
 */
function getVaultPath() {
	// No .env: exit silently, which keeps CI/CD runs green.
	if (!fs.existsSync(envPath)) {
		log.warn('No .env file found; skipping the deployment');
		process.exit(0);
	}

	applyDotenvFile(envPath);
	const vaultPath = process.env.VAULT_PATH;

	if (!vaultPath) {
		log.error('VAULT_PATH is not set; add VAULT_PATH=/path/to/your/vault to the .env file');
		process.exit(1);
	}

	return path.resolve(vaultPath);
}

/**
 * Reads the plugin id from manifest.json, which names the deploy target directory.
 * - Exits when manifest.json is missing or cannot be parsed.
 * @returns The plugin id, which is also the plugin folder name
 */
function getPluginId() {
	// Read the plugin id from the manifest.json in the project root.
	if (!fs.existsSync(manifestPath)) {
		log.error(`manifest.json not found, so the plugin id cannot be read: ${manifestPath}`);
		process.exit(1);
	}

	try {
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
		const pluginId = manifest.id;
		if (!pluginId) throw new Error();
		return pluginId;
	} catch {
		log.error('Could not read the plugin id from manifest.json.');
		process.exit(1);
	}
}

// ==================== Directory preparation ====================

/**
 * Makes sure the dist directory and the hot reload marker are in place.
 * - Creates dist when it does not exist.
 * - Creates an empty .hotreload file so hot reload tooling can detect it.
 */
function ensureDistReady() {
	// Check the dist directory.
	if (!fs.existsSync(distDir)) {
		fs.mkdirSync(distDir, { recursive: true });
	}
	// Make sure the .hotreload file exists.
	const hotreloadPath = path.join(distDir, '.hotreload');
	if (!fs.existsSync(hotreloadPath)) {
		fs.writeFileSync(hotreloadPath, '');
	}
}

/**
 * Computes the plugin directory from the vault root and the plugin id.
 * Exits when it resolves to the dist directory itself, which would cause a recursive copy or a link loop.
 * @param vaultPath Vault root path
 * @param pluginId Plugin id
 * @returns The absolute plugin directory path
 */
function getPluginDir(vaultPath, pluginId) {
	const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', pluginId);

	// Same directory as dist: exit, to avoid a recursive copy or a link loop.
	if (path.resolve(pluginDir) === path.resolve(distDir)) {
		process.exit(0);
	}

	return pluginDir;
}

// ==================== Plugin directory handling ====================

/**
 * Syncs data.json between the plugin directory and dist.
 * - Only runs when the plugin directory exists and is a directory.
 * - When the plugin directory has a data.json it is copied into dist (the caller must have created dist), so redeploying never loses the user configuration. A failure prints an error and exits.
 * - When it has none, any data.json in dist is removed, so no stale configuration is carried over. A failure prints an error and exits.
 * @param pluginDir Absolute plugin directory path
 */
function backupDataJson(pluginDir) {
	// Skip when it does not exist or is not a directory.
	if (!fs.existsSync(pluginDir)) return;
	const stats = fs.lstatSync(pluginDir);
	if (!stats.isDirectory()) return;

	const dataJsonPath = path.join(pluginDir, 'data.json');
	const distDataJsonPath = path.join(distDir, 'data.json');

	// No data.json in the plugin directory: drop the one in dist so no stale configuration is reused.
	if (!fs.existsSync(dataJsonPath)) {
		try {
			fs.rmSync(distDataJsonPath, { force: true });
		} catch (err) {
			log.warn(`Could not remove data.json from dist: ${err?.message ?? err}`);
		}
		return;
	}

	fs.copyFileSync(dataJsonPath, distDataJsonPath);
}

/**
 * Returns whether an existing path is a symlink pointing at dist (relative targets are resolved).
 * @param pluginDir Existing plugin directory path, possibly a symlink
 * @returns Whether it is a symlink pointing at the dist directory
 */
function isExistingSymlinkToDist(pluginDir) {
	const linkTarget = fs.readlinkSync(pluginDir);
	const resolvedLinkTarget = path.resolve(path.dirname(pluginDir), linkTarget);
	return resolvedLinkTarget === path.resolve(distDir);
}

/**
 * Removes a file or directory; on failure it prints an error and exits.
 * @param targetPath File or directory to remove
 */
function removePath(targetPath) {
	try {
		fs.rmSync(targetPath, { recursive: true, force: true });
	} catch (err) {
		log.error(`Error while handling the target path: ${err.message}`);
		process.exit(1);
	}
}

// ==================== Deployment ====================

/**
 * dev mode: creates a symlink from the plugin directory to dist (a junction on Windows).
 * - An existing symlink that already points at dist is reused.
 * - Otherwise the old directory is removed and the parent directory is created first.
 * @param context Deployment context (mode, vaultPath, pluginId, pluginDir)
 */
function deployDev(context) {
	const { pluginDir, pluginId } = context;
	const linkType = process.platform === 'win32' ? 'junction' : 'dir';

	// When the target already exists, prefer reusing an existing symlink.
	if (fs.existsSync(pluginDir)) {
		const stats = fs.lstatSync(pluginDir);

		// Already a symlink pointing at dist: reuse it and return.
		if (stats.isSymbolicLink() && isExistingSymlinkToDist(pluginDir)) {
			log.info(`Linked: ${createClickablePath(distDir, 'dist')} → ${createClickablePath(pluginDir, pluginId)}`);
			return;
		}

		// Otherwise remove the old directory or file before recreating the link.
		removePath(pluginDir);
	}

	// Make sure the parent directory exists.
	fs.mkdirSync(path.dirname(pluginDir), { recursive: true });
	
	fs.symlinkSync(distDir, pluginDir, linkType);
	log.info(`Linked: ${createClickablePath(distDir, 'dist')} → ${createClickablePath(pluginDir, pluginId)}`);
}

/**
 * build mode: copies the whole build output from dist into the plugin directory.
 * The plugin directory is created first, then every file and sub-directory of dist is copied.
 * @param context Deployment context (mode, vaultPath, pluginId, pluginDir)
 */
function deployBuild(context) {
	const { pluginDir, pluginId } = context;

	// Remove an existing target directory first, so no leftover files survive.
	if (fs.existsSync(pluginDir)) {
		removePath(pluginDir);
	}

	fs.mkdirSync(pluginDir, { recursive: true });
	copyDir(distDir, pluginDir);
	// Count the copied files for the log output.
	const fileNames = fs.readdirSync(pluginDir).sort();
	log.info(`Copied: ${createClickablePath(distDir, 'dist')} → ${createClickablePath(pluginDir, pluginId)}`);
}

// ==================== Main ====================

/**
 * Entry point of the deployment script:
 * 1. Parse the mode (dev/build).
 * 2. Resolve the vault path and the plugin id.
 * 3. Prepare dist and handle an existing plugin directory (preserve data.json, reuse the link).
 * 4. Deploy by symlink or by copy, depending on the mode.
 */
function main() {
	const mode = parseMode(process.argv);

	const vaultPath = getVaultPath();
	const pluginId = getPluginId();
	const pluginDir = getPluginDir(vaultPath, pluginId);
	backupDataJson(pluginDir);
	ensureDistReady();

	log.info(`Starting deployment in ${mode} mode`);
	
	// Build the deployment context.
	const context = { mode, vaultPath, pluginId, pluginDir };

	// Run the deployment.
	try {
		switch (mode) {
			case 'dev':
				deployDev(context);
				break;
			case 'build':
				deployBuild(context);
				break;
			default:
				log.error(`Unsupported mode: ${mode}`);
				process.exit(1);
		}

		log.success(`Deployment complete.`);
	} catch (err) {
		log.error(`${mode === 'dev' ? 'Creating the symlink' : 'Copying'} failed: ${err.message}`);
		process.exit(1);
	}
}

main();

