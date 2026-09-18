// scripts/deploy.mjs
// Installs an already-built plugin into one named, allowlisted vault.
//
// Usage:
//   node scripts/deploy.mjs --target smoke
//   node scripts/deploy.mjs --target prod --confirm-production
//
// This script does NOT build. Run `npm run build` first; a build that also
// deployed was how a routine compile check could reach a real vault.
//
// What it will not do, by construction rather than by care:
// - read, write, move or delete `data.json` anywhere (see deployCore.mjs);
// - remove the plugin directory, or any file it did not put there;
// - accept a destination that is not exactly one of the two named targets;
// - take a destination from the environment;
// - stop Obsidian. A running Obsidian keeps the old code until it is reloaded,
//   and which moment that happens is the user's decision, not this script's.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    BACKUP_ROOT,
    DEPLOYABLE_FILES,
    DEPLOY_TARGETS,
    backupInstalledBuild,
    deployToTarget,
    resolveTarget,
} from './deployCore.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../');
const distDir = path.join(projectRoot, 'dist');
const manifestPath = path.join(projectRoot, 'manifest.json');
// Outside the repository on purpose. A backup holds the productive vault's
// `data.json`, and inside the working tree one `git add -A` would publish it to
// a public GitHub repository — the `.gitignore` rule for `data.json` does not
// catch the renamed copy.
const backupRoot = BACKUP_ROOT;

const log = {
    success: (msg) => console.log(`✅ ${msg}`),
    error: (msg) => console.error(`❌ ${msg}`),
    info: (msg) => console.log(`ℹ️  ${msg}`),
    warn: (msg) => console.warn(`⚠️  ${msg}`),
};

/** A terminal hyperlink, so a printed path can be opened directly. */
function clickable(filePath, text) {
    const resolved = path.resolve(filePath);
    return `\x1b]8;;${pathToFileURL(resolved).href}\x1b\\${text ?? resolved}\x1b]8;;\x1b\\`;
}

/** `--target x --confirm-production` → `{ target: 'x', confirmProduction: true }`. */
function parseArgs(argv) {
    const args = { target: null, confirmProduction: false };
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--target') {
            args.target = argv[i + 1] ?? null;
            i += 1;
        } else if (arg.startsWith('--target=')) {
            args.target = arg.slice('--target='.length);
        } else if (arg === '--confirm-production') {
            args.confirmProduction = true;
        } else {
            throw new Error(`Unknown argument "${arg}".`);
        }
    }
    return args;
}

/** The plugin id, which names the folder inside `.obsidian/plugins`. */
function readPluginId() {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (!manifest.id) {
        throw new Error(`manifest.json has no id: ${manifestPath}`);
    }
    return manifest.id;
}

function main() {
    const args = parseArgs(process.argv);
    const target = resolveTarget(args.target, DEPLOY_TARGETS);

    // Production needs to be asked for twice. Not because the second flag is
    // hard to type, but because it cannot be arrived at by habit: no other
    // command in this project carries it.
    if (target.productive && !args.confirmProduction) {
        throw new Error(
            `Refusing to deploy to the ${target.label} without --confirm-production.\n` +
                `  Use: npm run deploy:prod`
        );
    }

    const pluginId = readPluginId();

    // Every check and the correct order live in deployToTarget, which is
    // covered by tests; this function only reports and decides about backups.
    const { pluginDir, written, before, after } = deployToTarget({
        targetName: target.name,
        distDir,
        pluginId,
        targets: DEPLOY_TARGETS,
        onBeforeWrite: ({ pluginDir: dir }) => {
            log.info(`Target: ${target.label} → ${clickable(dir, dir)}`);
            if (!target.productive) {
                return;
            }
            // A failed backup stops the deployment — it throws from here, which
            // is before the first write. The backup exists to make the
            // deployment reversible, and an irreversible deployment is not an
            // acceptable fallback.
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = path.join(backupRoot, `${target.name}-${stamp}`);
            const saved = backupInstalledBuild(dir, backupDir);
            log.info(
                saved.length > 0
                    ? `Backed up ${saved.join(', ')} → ${clickable(backupDir, backupDir)}`
                    : `Nothing to back up; the plugin is not installed yet.`
            );
        },
    });

    log.info(`Updated: ${written.join(', ')}`);
    for (const name of DEPLOYABLE_FILES) {
        log.info(`  ${name}: ${(before[name] ?? '(absent)').slice(0, 12)} → ${(after[name] ?? '?').slice(0, 12)}`);
    }
    log.info(`data.json: untouched (${after['data.json']?.slice(0, 12) ?? 'not present'})`);
    log.success(`Deployed to the ${target.label}.`);
    log.info('Reload Obsidian yourself to pick up the new build.');
}

try {
    main();
} catch (error) {
    log.error(error.message);
    process.exit(1);
}
