// deploySmoke.mjs
// Installs the Theme Studio into the disposable smoke vault, and nowhere else.
//
// A copy of the reader companion's script with a different pin, for the reason
// stated there: `scripts/deployCore.mjs` pins `PLUGIN_ID` to
// `dynamic-action-panel` ON PURPOSE, so that the id cannot become part of what
// it is checking. Teaching it a third id would weaken exactly the guard it
// exists to be. So this borrows the machinery and brings its own pin.
//
// It cannot reach the productive vault by construction: it resolves only the
// `smoke` target, then refuses anything marked productive anyway. There is no
// flag, no environment variable and no argument that changes where this writes.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
    DEPLOY_TARGETS,
    assertDeployableNames,
    assertNoLinkedAncestor,
    canonicalPath,
    deployArtifacts,
    inventory,
    pluginDirFor,
    validateBuildArtifacts,
} from '../../../scripts/deployCore.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, '..', 'dist');

/** This plugin's folder name, pinned here for the same reason DAP pins its own. */
const STUDIO_PLUGIN_ID = 'nexus-theme-studio';

/** The editor's own chrome. The theme it edits ships separately, as a theme. */
const STUDIO_FILES = ['main.js', 'manifest.json', 'styles.css'];

/** The only target this script will ever resolve. */
const TARGET_NAME = 'smoke';

function main() {
    const target = DEPLOY_TARGETS[TARGET_NAME];
    if (!target) throw new Error(`No "${TARGET_NAME}" target in DEPLOY_TARGETS.`);
    if (target.productive) {
        throw new Error(
            `The "${TARGET_NAME}" target is marked productive. This script installs ` +
                `an experimental development plugin and must never do that.`
        );
    }

    const manifest = JSON.parse(
        fs.readFileSync(path.join(here, '..', 'manifest.json'), 'utf8')
    );
    if (manifest.id !== STUDIO_PLUGIN_ID) {
        throw new Error(
            `manifest.json declares "${manifest.id}", but this script is pinned to ` +
                `"${STUDIO_PLUGIN_ID}".`
        );
    }

    assertDeployableNames(STUDIO_FILES);

    const problems = validateBuildArtifacts(distDir, STUDIO_FILES);
    if (problems.length > 0) {
        throw new Error(`Incomplete build — nothing was written.\n  ${problems.join('\n  ')}`);
    }

    const pluginDir = pluginDirFor(target.vaultPath, STUDIO_PLUGIN_ID);
    const allowed = canonicalPath(
        pluginDirFor(DEPLOY_TARGETS[TARGET_NAME].vaultPath, STUDIO_PLUGIN_ID)
    );
    if (canonicalPath(pluginDir) !== allowed) {
        throw new Error(`Refusing to deploy to ${pluginDir}; only ${allowed} is allowed.`);
    }
    assertNoLinkedAncestor(pluginDir);

    // data.json is where every profile the user has made lives. It is read
    // twice — here and after the write — so the claim that a deployment does
    // not touch it is proven rather than asserted.
    const before = inventory(pluginDir, [...STUDIO_FILES, 'data.json']);
    const written = deployArtifacts(distDir, pluginDir, STUDIO_FILES);
    const after = inventory(pluginDir, [...STUDIO_FILES, 'data.json']);

    if (before['data.json'] !== after['data.json']) {
        throw new Error(
            `data.json changed during the deployment. Nothing here writes it.\n` +
                `  before: ${before['data.json'] ?? '(absent)'}\n` +
                `  after:  ${after['data.json'] ?? '(absent)'}`
        );
    }

    console.log(`✓ ${target.label}: ${pluginDir}`);
    console.log(`  installed: ${written.join(', ')}`);
    console.log(`  data.json: ${after['data.json'] ? 'unchanged' : 'not present'}`);
}

try {
    main();
} catch (error) {
    console.error(`\n⛔ Theme Studio deploy refused:\n${error.message}\n`);
    process.exit(1);
}
