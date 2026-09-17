import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, ".");

const packagePath = resolve(projectRoot, "package.json");
const manifestPath = resolve(projectRoot, "manifest.json");
const versionsPath = resolve(projectRoot, "versions.json");

// Read the files.
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const versions = JSON.parse(readFileSync(versionsPath, "utf8"));

// Determine the target version, preferring the npm environment variable over package.json.
const targetVersion = process.env.npm_package_version || packageJson.version;
const { minAppVersion } = manifest;

if (!targetVersion) {
	console.error("❌ Could not determine the version number");
	process.exit(1);
}

// Update manifest.json.
manifest.version = targetVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");
console.log(`✅ Updated the manifest.json version: ${targetVersion}`);

// Update versions.json when the version is not mapped yet.
if (!versions[targetVersion]) {
	versions[targetVersion] = minAppVersion;
	writeFileSync(versionsPath, JSON.stringify(versions, null, "\t") + "\n");
	console.log(`✅ Added the version mapping: ${targetVersion} -> ${minAppVersion}`);
} else {
	console.log(`ℹ️  Version ${targetVersion} already exists in versions.json`);
}

console.log(`✅ Version sync complete: ${targetVersion} (minAppVersion: ${minAppVersion})`);
