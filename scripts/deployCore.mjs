// scripts/deployCore.mjs
// The decisions a deployment makes, separated from the command that runs it.
//
// This file exists because the dangerous parts of deploying are all decisions —
// WHERE to write, WHICH files, and WHETHER the build is complete — and a
// decision buried inside a CLI entry point cannot be tested. Everything here is
// importable and covered by tests/deploySafety.test.ts; scripts/deploy.mjs is a
// thin shell around it.
//
// Two rules shape the whole file:
//
// 1. `data.json` IS NOT OURS. It is the user's configuration, it lives in the
//    vault, and nothing here writes it, deletes it, moves it or restores it.
//    The previous design did all four — save it aside, delete the whole plugin
//    folder, copy the build in, put it back — which left a window in which the
//    only copy lived in a git-ignored build directory.
//
//    It IS read, in exactly two places, and both are stated rather than hidden:
//    `inventory` hashes it so a deployment can prove it did not change, and a
//    production deployment copies it into a backup. Neither can modify it. The
//    precise claim is "never written", not "never opened" — an invariant
//    stronger than the code is an invariant that quietly stops being true.
//
// 2. A TARGET IS EITHER ALLOWLISTED OR REFUSED. Not "looks about right", not a
//    prefix match — an exact canonical comparison against a named target. A
//    mistyped path is an error, never a new destination.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * The only places a deployment may write, by role.
 *
 * This is project configuration on purpose rather than an environment
 * variable: an env value can be stale, can arrive from another machine through
 * a synced file, and is invisible at the moment of the command. A path that
 * needs to change should change in a committed, reviewable line.
 */
export const DEPLOY_TARGETS = {
    smoke: {
        label: 'disposable smoke vault',
        vaultPath: 'C:/Users/flash/ObsidianTestVaults/ocap-smoke',
        productive: false,
    },
    prod: {
        label: 'productive vault',
        vaultPath: 'H:/Dropbox/01_Uni/A1_Nexus',
        productive: true,
    },
};

/**
 * The plugin folder name, pinned here rather than read from `manifest.json`.
 *
 * This is not redundancy. The allowlist compares a requested directory against
 * `<vault>/.obsidian/plugins/<id>`, and if the id on both sides came from the
 * manifest the comparison could never fail on it — an id of `..` would resolve
 * to `.obsidian`, and `../..` to the vault root, both "allowlisted". Pinning the
 * id makes it part of what is being checked instead of part of the check.
 */
export const PLUGIN_ID = 'dynamic-action-panel';

/** Where backups go: outside the repository, so a vault's configuration can
 * never be published by committing the working tree. */
export const BACKUP_ROOT = 'C:/Users/flash/ObsidianTestVaults/ocap-backups';

/**
 * The complete set of files a deployment installs. Anything else in `dist/`,
 * whatever it is and however it got there, stays in `dist/`.
 */
export const DEPLOYABLE_FILES = ['main.js', 'styles.css', 'manifest.json'];

/**
 * Names a deployment must never write into a plugin directory, listed so the
 * intent survives a future edit that adds a file to DEPLOYABLE_FILES.
 */
export const PROTECTED_FILES = ['data.json'];

/**
 * An artifact smaller than this is treated as a failed build, not a build. It is
 * a "did the build produce anything" floor, not a validity check — a real
 * `manifest.json` is 334 bytes and `main.js` half a megabyte.
 */
const MIN_ARTIFACT_BYTES = 16;

/**
 * Refuses a file list that could write outside the plugin directory, or over
 * the user's state.
 *
 * Both halves were reachable before this existed. A name is joined onto the
 * plugin directory, so `../hijack.js` escaped it; and the protected-name check
 * compared exactly, so `Data.json` sailed past it and then overwrote
 * `data.json` on a filesystem that does not distinguish the two. Neither is
 * reachable through the shipped callers, but this is the guard the whole
 * exported API rests on, and a guard that only works for the arguments the
 * authors happened to pass is not a guard.
 */
export function assertDeployableNames(files) {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('No files to deploy.');
    }
    for (const name of files) {
        if (typeof name !== 'string' || name.length === 0) {
            throw new Error(`Not a file name: ${JSON.stringify(name)}`);
        }
        if (name !== path.basename(name) || name === '.' || name === '..') {
            throw new Error(
                `"${name}" is not a plain file name, so it could write outside ` +
                    `the plugin directory.`
            );
        }
        const lowered = name.toLowerCase();
        for (const protectedName of PROTECTED_FILES) {
            if (lowered === protectedName.toLowerCase()) {
                throw new Error(
                    `${name} is user state and must never be deployed.`
                );
            }
        }
    }
}

/**
 * A path in the one form used for comparison.
 *
 * Windows makes three separate promises that all have to be neutralized before
 * two paths can be called equal: separators can be either slash, the whole
 * path is case-insensitive, and a trailing separator means nothing. Lowercasing
 * is safe here BECAUSE the comparison is Windows-only in practice and both
 * sides go through the same funnel — it is an equality key, not a path to use.
 */
export function canonicalPath(inputPath) {
    const resolved = path.resolve(inputPath).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** The plugin directory a vault root implies. */
export function pluginDirFor(vaultPath, pluginId) {
    return path.join(vaultPath, '.obsidian', 'plugins', pluginId);
}

/**
 * Resolves a target name against the allowlist.
 *
 * Throws rather than defaulting: there is no sensible fallback target, and a
 * deployment that guesses is the failure mode this whole file exists to
 * prevent.
 */
export function resolveTarget(name, targets = DEPLOY_TARGETS) {
    if (!name) {
        throw new Error(
            `No target given. Use one of: ${Object.keys(targets).join(', ')}.`
        );
    }
    const target = Object.prototype.hasOwnProperty.call(targets, name)
        ? targets[name]
        : undefined;
    if (!target) {
        throw new Error(
            `Unknown target "${name}". Allowed: ${Object.keys(targets).join(', ')}.`
        );
    }
    return { name, ...target };
}

/**
 * Refuses any plugin directory that is not exactly the one an allowlisted
 * target implies.
 *
 * Deliberately an equality check and not `startsWith`: a prefix test would
 * accept every plugin in the vault, and `H:\Dropbox\...` as a prefix would
 * accept this repository itself.
 *
 * A symlink or junction is refused too. The string can match while the writes
 * land somewhere else entirely, which is exactly the case an allowlist is
 * supposed to catch — and the previous dev mode left such a junction behind.
 */
export function assertAllowedPluginDir(pluginDir, targets = DEPLOY_TARGETS) {
    const wanted = canonicalPath(pluginDir);
    // The pinned id, never a caller-supplied one: see PLUGIN_ID.
    const allowed = Object.entries(targets).map(([name, target]) => ({
        name,
        canonical: canonicalPath(pluginDirFor(target.vaultPath, PLUGIN_ID)),
    }));

    const hit = allowed.find((entry) => entry.canonical === wanted);
    if (!hit) {
        throw new Error(
            `Refusing to deploy to a path that is not an allowed target:\n` +
                `  requested: ${path.resolve(pluginDir)}\n` +
                allowed.map((e) => `  allowed (${e.name}): ${e.canonical}`).join('\n')
        );
    }

    assertNoLinkedAncestor(pluginDir);

    return hit.name;
}

/**
 * Refuses when any existing component of the path is a symlink or junction.
 *
 * Every level has to be checked, not just the last one: a junction planted on
 * `…/.obsidian/plugins` redirects a write exactly as effectively as one on the
 * plugin folder itself, and the string comparison above cannot see either. Nor
 * could resolving the path help — both sides would resolve through the same
 * link and compare equal, which is precisely how a redirect stays invisible.
 *
 * The test is `isSymbolicLink()` and deliberately NOT the raw reparse-point
 * attribute: on this machine every single file under `H:\Dropbox` is a
 * CloudFiles reparse point, so an attribute check would refuse the productive
 * vault outright.
 *
 * A component that does not exist yet ends the walk — there is nothing there to
 * redirect through.
 */
export function assertNoLinkedAncestor(targetPath) {
    const absolute = path.resolve(targetPath);
    const { root } = path.parse(absolute);
    const segments = absolute.slice(root.length).split(/[\\/]+/).filter(Boolean);

    let current = root;
    for (const segment of segments) {
        current = path.join(current, segment);
        let stats;
        try {
            stats = fs.lstatSync(current);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return;
            }
            throw error;
        }
        if (stats.isSymbolicLink()) {
            let linkTarget = '?';
            try {
                linkTarget = fs.readlinkSync(current);
            } catch {
                // Naming the link matters more than naming its target.
            }
            throw new Error(
                `Refusing to deploy: "${current}" is a link to ${linkTarget}.\n` +
                    `  The allowlisted path would be checked, but the files would ` +
                    `land somewhere it never saw.\n` +
                    `  Replace the link with a real directory and deploy again.`
            );
        }
    }
}

/**
 * Checks that the build produced something worth installing.
 *
 * Runs before the target is touched at all, because "the build was broken" and
 * "the installed plugin is broken" should never be the same event. An artifact
 * that is missing, is a directory, or is implausibly small counts as a failed
 * build.
 */
export function validateBuildArtifacts(distDir, files = DEPLOYABLE_FILES) {
    const problems = [];
    for (const name of files) {
        const source = path.join(distDir, name);
        if (!fs.existsSync(source)) {
            problems.push(`${name} is missing from ${distDir}`);
            continue;
        }
        const stats = fs.statSync(source);
        if (!stats.isFile()) {
            problems.push(`${name} is not a file`);
            continue;
        }
        if (stats.size < MIN_ARTIFACT_BYTES) {
            problems.push(`${name} is only ${stats.size} bytes, which is not a build`);
        }
    }
    return problems;
}

/** Errors worth waiting out rather than giving up on. */
const RETRIABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Synchronous sleep: this is a script, there is nothing to yield to. */
function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Writes the staged copy of a destination file, beside the destination.
 *
 * In the DESTINATION directory rather than a temp directory, for one reason:
 * rename only works within a volume, and this repository lives on H: while the
 * smoke vault lives on C:. A staged copy next door keeps the rename local
 * whatever drive the build came from.
 *
 * The name carries the pid and a timestamp, and is created with `wx`, so two
 * runs cannot write the same staging file and a crashed run's leftover is never
 * silently reused. That matters more than it looks: the plugin folder is inside
 * Dropbox, so a leftover would be synced to every other machine.
 *
 * The content is flushed before the rename. Without that, a crash at the wrong
 * moment can leave a zero-length `main.js` installed.
 */
export function stageFile(sourceFile, destFile) {
    const staging = path.join(
        path.dirname(destFile),
        `.${path.basename(destFile)}.${process.pid}-${Date.now()}.deploy-tmp`
    );
    const data = fs.readFileSync(sourceFile);
    const handle = fs.openSync(staging, 'wx');
    try {
        fs.writeSync(handle, data);
        fs.fsyncSync(handle);
    } finally {
        fs.closeSync(handle);
    }
    return staging;
}

/**
 * Moves a staged file onto its destination.
 *
 * Rename replaces an existing file in one step, so the destination is never
 * absent or half-written. It is also, counter-intuitively, the most
 * lock-fragile operation available on Windows: a rename over an existing file
 * fails with EPERM if ANY handle is open on it, even one that granted full
 * sharing. Measured on this machine, the three strategies fail differently, so
 * they are tried in order of how much they guarantee:
 *
 * 1. rename over the destination — atomic, no window at all;
 * 2. move the destination aside, rename in, delete the old one — covers a
 *    reader that allowed deletion, and rolls back if the second step fails;
 * 3. copy over the destination — covers a reader that allowed writing. NOT
 *    atomic: there is a window of a few milliseconds in which the file is
 *    short. Last resort precisely because of that.
 *
 * Steps 2 and 3 are complementary — neither is a superset — which is why both
 * are here. A hard exclusive lock is covered by nothing and fails cleanly.
 *
 * EPERM is also what a read-only attribute produces, and no amount of waiting
 * fixes that, so it gets one `chmod` nudge. The backoff is exponential and runs
 * to roughly four seconds, because a lock held for one second was measured to
 * need nearly two to clear.
 */
export function commitStaged(staging, destFile, { retries = 5, baseDelay = 120 } = {}) {
    // A directory where a build file belongs is a pathological state, and the
    // aside-and-rename strategy would "succeed" by moving it out of the way and
    // leaving it behind for ever. Refusing says what is wrong instead.
    let existing;
    try {
        existing = fs.lstatSync(destFile);
    } catch {
        existing = null;
    }
    if (existing && !existing.isFile()) {
        throw new Error(
            `${destFile} exists but is not a file. Remove it and deploy again.`
        );
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            fs.renameSync(staging, destFile);
            return 'rename';
        } catch (error) {
            lastError = error;
            if (!RETRIABLE.has(error.code)) {
                throw error;
            }
            if (error.code === 'EPERM') {
                try {
                    fs.chmodSync(destFile, 0o666);
                } catch {
                    // Not a read-only attribute then; the retry still applies.
                }
            }
        }

        const aside = `${destFile}.old-${process.pid}`;
        try {
            fs.renameSync(destFile, aside);
            try {
                fs.renameSync(staging, destFile);
            } catch (error) {
                // Put it back before reporting: a failure here must not leave
                // the destination missing.
                try {
                    fs.renameSync(aside, destFile);
                } catch {
                    // Nothing further can be done, and the original error is
                    // the one worth seeing.
                }
                throw error;
            }
            try {
                fs.rmSync(aside, { force: true });
            } catch {
                // A sync engine may still hold it; it is debris, not a failure.
            }
            return 'aside+rename';
        } catch (error) {
            lastError = error;
            if (!RETRIABLE.has(error.code) && error.code !== 'ENOENT') {
                throw error;
            }
        }

        if (attempt < retries) {
            sleep(baseDelay * 2 ** attempt);
        }
    }

    try {
        fs.copyFileSync(staging, destFile);
        fs.rmSync(staging, { force: true });
        return 'copy';
    } catch (error) {
        // Deliberately does NOT claim the destination is unchanged: this is the
        // one path that writes over the live file, so a failure here can have
        // truncated it. Saying otherwise would be exactly the wrong reassurance
        // in the only situation where it is printed.
        throw new Error(
            `Could not replace ${destFile} (${lastError?.code ?? '?'}/${error.code}). ` +
                `The file is locked — close Obsidian, pause Dropbox syncing, and ` +
                `deploy again. ${destFile} may be incomplete; re-running the ` +
                `deployment repairs it.`
        );
    }
}

/**
 * Installs the build into a plugin directory.
 *
 * Only the named files are written, one at a time, each one replaced in place.
 * Nothing is deleted — not the directory, not a stale file, and above all not
 * `data.json`, which this function has no code path to.
 *
 * Two phases on purpose. Every file is copied to its staging name first, and
 * only when all of them are staged are they renamed into place. Copying is the
 * slow, failure-prone half — a cross-drive read, a locked source, a full disk —
 * and doing all of it before the first rename means the usual failure happens
 * while the installed plugin is still completely untouched. The renames that
 * follow are fast, local and individually atomic.
 *
 * It is not a transaction: a failure during the rename phase can still leave a
 * new `main.js` beside an old `styles.css`. Making that impossible would mean
 * swapping directories, which on Windows is neither atomic nor reliable while
 * Obsidian holds the files, and which would bring back the "delete the folder
 * first" step this whole refactor exists to remove. The user's state is not at
 * risk in either case, and a mismatched pair is fixed by running it again.
 */
export function deployArtifacts(distDir, pluginDir, files = DEPLOYABLE_FILES) {
    assertDeployableNames(files);

    const problems = validateBuildArtifacts(distDir, files);
    if (problems.length > 0) {
        throw new Error(`Incomplete build, nothing was written:\n  ${problems.join('\n  ')}`);
    }

    fs.mkdirSync(pluginDir, { recursive: true });

    const staged = [];
    try {
        for (const name of files) {
            const dest = path.join(pluginDir, name);
            staged.push({ name, dest, staging: stageFile(path.join(distDir, name), dest) });
        }
    } catch (error) {
        // Nothing has been committed yet, so the installed plugin is exactly as
        // it was. Clear the debris and report.
        for (const entry of staged) {
            try {
                fs.rmSync(entry.staging, { force: true });
            } catch {
                // Reporting the original failure matters more.
            }
        }
        throw error;
    }

    const written = [];
    try {
        for (const entry of staged) {
            commitStaged(entry.staging, entry.dest);
            written.push(entry.name);
        }
    } catch (error) {
        // A commit failed. The files already committed stay committed — see the
        // note above about why this is not a transaction — but nothing that was
        // merely staged is left lying around. The plugin folder is inside
        // Dropbox, so debris there would be synced to every other machine.
        for (const entry of staged) {
            if (written.includes(entry.name)) continue;
            try {
                fs.rmSync(entry.staging, { force: true });
            } catch {
                // Reporting the original failure matters more.
            }
        }
        throw error;
    }
    return written;
}

/**
 * The whole ordered deployment, from a target name to installed files.
 *
 * It exists as one function because the ORDER is the safety property, and an
 * order that lives in a CLI entry point cannot be tested. Every check happens
 * before the first write, and they happen in the only sequence that is safe:
 *
 *   resolve the target -> is the build complete? -> is the path allowlisted?
 *   -> record what is there -> (caller's backup) -> install -> prove data.json
 *   did not change.
 *
 * The build is checked before the path, so a broken build does not even get as
 * far as naming a vault. `onBeforeWrite` is where a production deployment puts
 * its backup: it runs after every check and before anything is written, and if
 * it throws, nothing is written.
 */
export function deployToTarget({
    targetName,
    distDir,
    pluginId,
    targets = DEPLOY_TARGETS,
    files = DEPLOYABLE_FILES,
    onBeforeWrite,
}) {
    // The manifest names the folder Obsidian loads from, so a manifest whose id
    // has drifted from the pinned one would install into a directory nobody
    // intended. Refusing is the only safe reading of that.
    if (pluginId !== PLUGIN_ID) {
        throw new Error(
            `manifest.json declares the plugin id "${pluginId}", but deployment ` +
                `is pinned to "${PLUGIN_ID}". If the id really changed, update ` +
                `PLUGIN_ID in scripts/deployCore.mjs deliberately.`
        );
    }

    const target = resolveTarget(targetName, targets);
    const pluginDir = pluginDirFor(target.vaultPath, PLUGIN_ID);

    const problems = validateBuildArtifacts(distDir, files);
    if (problems.length > 0) {
        throw new Error(
            `Incomplete build — nothing was written.\n  ${problems.join('\n  ')}`
        );
    }
    assertAllowedPluginDir(pluginDir, targets);

    const before = inventory(pluginDir);
    if (onBeforeWrite) {
        onBeforeWrite({ target, pluginDir, before });
    }

    const written = deployArtifacts(distDir, pluginDir, files);
    const after = inventory(pluginDir);

    // The claim this refactor is built on, checked rather than asserted.
    if (before['data.json'] !== after['data.json']) {
        throw new Error(
            `data.json changed during the deployment. This must never happen — ` +
                `nothing here writes it.\n` +
                `  before: ${before['data.json'] ?? '(absent)'}\n` +
                `  after:  ${after['data.json'] ?? '(absent)'}`
        );
    }

    return { target, pluginDir, written, before, after };
}

/**
 * The SHA-256 of a file, or null when there is no file there.
 *
 * A directory counts as "no file" rather than an error: this is used to take an
 * inventory, and an inventory that throws on an oddly-shaped plugin folder
 * would abort the very check it exists to perform.
 */
export function sha256(filePath) {
    let stats;
    try {
        stats = fs.statSync(filePath);
    } catch {
        return null;
    }
    if (!stats.isFile()) {
        return null;
    }
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Hashes of everything a deployment must be able to account for afterwards.
 *
 * `data.json` is in here for exactly the opposite reason to the others: they
 * are expected to change, and it is expected NOT to. It is read and hashed,
 * never written.
 */
export function inventory(pluginDir, files = [...DEPLOYABLE_FILES, ...PROTECTED_FILES]) {
    const result = {};
    for (const name of files) {
        result[name] = sha256(path.join(pluginDir, name));
    }
    return result;
}

/**
 * Copies the currently installed build aside before it is replaced.
 *
 * The user's `data.json` is copied too, but purely as evidence: it gives a
 * restore point that exists independently of the deployment, and nothing in
 * this file ever reads it back. Restoring a build must not be able to drag an
 * old configuration along with it, so the copy is named to make that obvious.
 *
 * A missing file is skipped rather than failing — a first deployment into a
 * fresh vault has nothing to back up, and that is not an error.
 */
export function backupInstalledBuild(pluginDir, backupDir) {
    fs.mkdirSync(backupDir, { recursive: true });
    const saved = [];
    for (const name of DEPLOYABLE_FILES) {
        const source = path.join(pluginDir, name);
        if (!fs.existsSync(source)) continue;
        fs.copyFileSync(source, path.join(backupDir, name));
        saved.push(name);
    }
    for (const name of PROTECTED_FILES) {
        const source = path.join(pluginDir, name);
        if (!fs.existsSync(source)) continue;
        // Suffixed so a careless restore cannot put it back as live config.
        fs.copyFileSync(source, path.join(backupDir, `${name}.evidence`));
        saved.push(`${name}.evidence`);
    }
    return saved;
}
