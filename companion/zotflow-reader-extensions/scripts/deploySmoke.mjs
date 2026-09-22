// deploySmoke.mjs
// Installs the companion plugin into the disposable smoke vault, and nowhere
// else.
//
// This is a separate entry point rather than a new target in the panel's deploy
// CLI, for one reason that is worth stating plainly: `scripts/deployCore.mjs`
// pins the plugin folder name to `dynamic-action-panel` ON PURPOSE, so that the
// id cannot become part of what it is checking. Teaching it a second id would
// weaken exactly the guard it exists to be. So this file borrows the machinery
// and brings its own pin.
//
// It also cannot reach the productive vault by construction: it resolves only
// the `smoke` target, and then refuses anything marked productive anyway. There
// is no flag, no environment variable and no argument that changes where this
// writes.

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
const COMPANION_PLUGIN_ID = 'zotflow-reader-extensions';

/**
 * styles.css is here, and it is not the reader's CSS.
 *
 * This plugin now has stylesheets in two realms, and only one of them can be a
 * file. The reader lives in an iframe that Obsidian's stylesheet loader cannot
 * reach, so its rules are injected at runtime by sidebarPatch.ts. Everything
 * about OBSIDIAN's own workspace — the side docks, the edge between a dock and
 * the document — is ordinary plugin CSS, and ships as ordinary plugin CSS.
 */
const COMPANION_FILES = ['main.js', 'manifest.json', 'styles.css'];

/** The only target this script will ever resolve. */
const TARGET_NAME = 'smoke';

function main() {
    const target = DEPLOY_TARGETS[TARGET_NAME];
    if (!target) throw new Error(`No "${TARGET_NAME}" target in DEPLOY_TARGETS.`);
    if (target.productive) {
        throw new Error(
            `The "${TARGET_NAME}" target is marked productive. This script installs ` +
                `an experimental companion plugin and must never do that.`
        );
    }

    // The manifest names the folder Obsidian loads from, so a drifted id would
    // install somewhere nobody intended.
    const manifest = JSON.parse(
        fs.readFileSync(path.join(here, '..', 'manifest.json'), 'utf8')
    );
    if (manifest.id !== COMPANION_PLUGIN_ID) {
        throw new Error(
            `manifest.json declares "${manifest.id}", but this script is pinned to ` +
                `"${COMPANION_PLUGIN_ID}".`
        );
    }

    assertDeployableNames(COMPANION_FILES);

    const problems = validateBuildArtifacts(distDir, COMPANION_FILES);
    if (problems.length > 0) {
        throw new Error(`Incomplete build — nothing was written.\n  ${problems.join('\n  ')}`);
    }

    const pluginDir = pluginDirFor(target.vaultPath, COMPANION_PLUGIN_ID);
    const allowed = canonicalPath(
        pluginDirFor(DEPLOY_TARGETS[TARGET_NAME].vaultPath, COMPANION_PLUGIN_ID)
    );
    if (canonicalPath(pluginDir) !== allowed) {
        throw new Error(`Refusing to deploy to ${pluginDir}; only ${allowed} is allowed.`);
    }
    assertNoLinkedAncestor(pluginDir);

    // data.json belongs to the vault. It is read twice — here and after the
    // write — so the claim that it is untouched is proven rather than asserted.
    const before = inventory(pluginDir, [...COMPANION_FILES, 'data.json']);
    const written = deployArtifacts(distDir, pluginDir, COMPANION_FILES);
    const after = inventory(pluginDir, [...COMPANION_FILES, 'data.json']);

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
    console.error(`\n⛔ Companion deploy refused:\n${error.message}\n`);
    process.exit(1);
}
