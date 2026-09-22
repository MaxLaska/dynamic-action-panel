// scripts/deployThemeSmoke.mjs
// Installs the Nexus theme into the disposable smoke vault, and nowhere else.
//
// A third entry point beside the panel's deploy CLI and the companion's,
// for the same reason the companion has its own: `scripts/deployCore.mjs`
// pins `PLUGIN_ID` deliberately, so that an id can never become part of the
// check it is being checked against. A theme is not a plugin — it goes into
// `.obsidian/themes/<Name>/`, it is identified by the NAME OF ITS FOLDER, and
// it ships `theme.css` instead of `main.js`. So this borrows the machinery and
// brings its own pin.
//
// It cannot reach the productive vault by construction: it resolves only the
// `smoke` target, then refuses anything marked productive anyway. There is no
// flag, no environment variable and no argument that changes where this writes.
//
// There is also no build step. A theme is CSS; `theme/nexus/theme.css` is the
// artifact, hand-written and held to `theme/nexus/src/tokens.ts` by
// tests/nexusTheme.test.ts rather than by a generator.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
    DEPLOY_TARGETS,
    THEME_FILES,
    THEME_NAME,
    assertDeployableNames,
    assertNoLinkedAncestor,
    canonicalPath,
    deployArtifacts,
    inventory,
    themeDirFor,
    validateBuildArtifacts,
} from './deployCore.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(here, '..', 'theme', 'nexus');

/** The only target this script will ever resolve. */
const TARGET_NAME = 'smoke';

function main() {
    const target = DEPLOY_TARGETS[TARGET_NAME];
    if (!target) throw new Error(`No "${TARGET_NAME}" target in DEPLOY_TARGETS.`);
    if (target.productive) {
        throw new Error(
            `The "${TARGET_NAME}" target is marked productive. This script installs ` +
                `an experimental theme and must never do that.`
        );
    }

    // The manifest's name and the folder name are the same identity to
    // Obsidian, so a drifted name would install a theme the vault cannot find.
    const manifest = JSON.parse(
        fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8')
    );
    if (manifest.name !== THEME_NAME) {
        throw new Error(
            `manifest.json declares "${manifest.name}", but this script is pinned to ` +
                `"${THEME_NAME}".`
        );
    }

    assertDeployableNames(THEME_FILES);

    const problems = validateBuildArtifacts(sourceDir, THEME_FILES);
    if (problems.length > 0) {
        throw new Error(`Incomplete theme — nothing was written.\n  ${problems.join('\n  ')}`);
    }

    const themeDir = themeDirFor(target.vaultPath, THEME_NAME);
    const allowed = canonicalPath(
        themeDirFor(DEPLOY_TARGETS[TARGET_NAME].vaultPath, THEME_NAME)
    );
    if (canonicalPath(themeDir) !== allowed) {
        throw new Error(`Refusing to deploy to ${themeDir}; only ${allowed} is allowed.`);
    }
    assertNoLinkedAncestor(themeDir);

    // A theme folder holds no user state of its own — Obsidian keeps the
    // selected theme in `.obsidian/appearance.json`, which nothing here opens.
    // The inventory is taken anyway, so the claim is evidence rather than
    // assertion.
    const before = inventory(themeDir, [...THEME_FILES, 'data.json']);
    const written = deployArtifacts(sourceDir, themeDir, THEME_FILES);
    const after = inventory(themeDir, [...THEME_FILES, 'data.json']);

    if (before['data.json'] !== after['data.json']) {
        throw new Error(
            `data.json changed during the deployment. Nothing here writes it.\n` +
                `  before: ${before['data.json'] ?? '(absent)'}\n` +
                `  after:  ${after['data.json'] ?? '(absent)'}`
        );
    }

    console.log(`✓ ${target.label}: ${themeDir}`);
    console.log(`  installed: ${written.join(', ')}`);
    console.log(`  select it under Settings → Appearance → Themes → ${THEME_NAME}`);
}

try {
    main();
} catch (error) {
    console.error(`\n⛔ Theme deploy refused:\n${error.message}\n`);
    process.exit(1);
}
