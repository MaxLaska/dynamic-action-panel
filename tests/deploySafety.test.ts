// tests/deploySafety.test.ts
// The invariants that keep a deployment from destroying a vault.
//
// This file is unusual for this project in that it touches a real filesystem.
// That is the point: the hazards being pinned here are filesystem behaviour —
// which files get written, which survive, what is left behind when a copy
// fails — and a mocked `fs` would only prove that the mock agrees with itself.
// Every path used is inside `os.tmpdir()`, created per test and removed after;
// no vault, and nothing in the repository, is touched.
//
// The property that matters most, stated once and stated exactly:
//
//   A DEPLOYMENT NEVER WRITES, DELETES OR RESTORES data.json.
//
// Not "never opens it" — it is read twice, to hash it for the integrity proof
// and to place a production backup, and a header claiming otherwise would be an
// invariant no test could uphold. What is gone is the write path. The previous
// design rescued the file into the build directory, deleted the whole plugin
// folder, copied the build in and put the file back, so for a moment the only
// copy of the user's configuration lived in a git-ignored folder that the next
// build could overwrite.
//
// Several tests below would still pass under that design — `keeps an existing
// data.json byte-identical` would too, since it ended up back in place. The
// ones that would not: `leaves files it did not write alone rather than
// clearing the folder`, `copies exactly the three build files and nothing
// else`, and the static assertion that no recursive removal exists.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BACKUP_ROOT,
    DEPLOYABLE_FILES,
    DEPLOY_TARGETS,
    PLUGIN_ID,
    PROTECTED_FILES,
    THEME_FILES,
    THEME_NAME,
    assertDeployableNames,
    assertAllowedPluginDir,
    assertNoLinkedAncestor,
    backupInstalledBuild,
    canonicalPath,
    deployArtifacts,
    deployToTarget,
    inventory,
    pluginDirFor,
    resolveTarget,
    themeDirFor,
    stageFile,
    commitStaged,
    validateBuildArtifacts,
    // Extensionless on purpose: TypeScript resolves the hand-written
    // `deployCore.d.ts` beside it, while Vite resolves the `.mjs` the script
    // itself runs.
} from '../scripts/deployCore';

/**
 * The `scripts/` directory, located relative to this file rather than through
 * `process.cwd()` — the repository path contains a space, so it has to go
 * through `fileURLToPath` rather than a URL's raw pathname.
 */
const scriptsDir = path.dirname(fileURLToPath(new URL('../scripts/deployCore.mjs', import.meta.url)));
const repoRoot = path.resolve(scriptsDir, '..');

/**
 * Every source that can write into a vault.
 *
 * `esbuild.config.mjs` belongs in this list even though it is a build config:
 * its `watch-smoke` mode installs into the smoke vault, so a recursive removal
 * or an environment-derived path reappearing THERE would be just as dangerous,
 * and scanning only the two deploy scripts would have missed it.
 */
function vaultWritingSources(): string[] {
    return [
        path.join(scriptsDir, 'deployCore.mjs'),
        path.join(scriptsDir, 'deploy.mjs'),
        path.join(repoRoot, 'esbuild.config.mjs'),
    ].map((file) => fs.readFileSync(file, 'utf8'));
}

// --- Harness ---------------------------------------------------------------

let workDir: string;

/** A plausible build. The sizes matter: the validator rejects stubs. */
function makeDist(files: Record<string, string> = {}): string {
    const dist = path.join(workDir, 'dist');
    fs.mkdirSync(dist, { recursive: true });
    const defaults: Record<string, string> = {
        'main.js': `// built plugin\n${'x'.repeat(200)}`,
        'styles.css': `/* built styles */\n${'y'.repeat(200)}`,
        'manifest.json': JSON.stringify({ id: 'dynamic-action-panel', version: '1.0.0' }),
    };
    for (const [name, content] of Object.entries({ ...defaults, ...files })) {
        fs.writeFileSync(path.join(dist, name), content);
    }
    return dist;
}

/** A vault plugin directory, optionally already holding an installed plugin. */
function makeTarget(contents: Record<string, string> = {}): string {
    const target = path.join(workDir, 'vault', '.obsidian', 'plugins', 'dynamic-action-panel');
    fs.mkdirSync(target, { recursive: true });
    for (const [name, content] of Object.entries(contents)) {
        fs.writeFileSync(path.join(target, name), content);
    }
    return target;
}

/** A complete target, so the tests cannot pass a half-built one. */
function fakeTarget(vaultPath: string, productive: boolean) {
    return { label: productive ? 'fake productive' : 'fake smoke', vaultPath, productive };
}

/** An allowlist whose targets are the temp directories this test made. */
function allowlistFor(vaultRoot: string) {
    return {
        smoke: { label: 'smoke', vaultPath: vaultRoot, productive: false },
    };
}

const USER_STATE = JSON.stringify({ settingsVersion: 5, categories: ['precious'] });

beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dap-deploy-'));
});

afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

// --- What may be written ---------------------------------------------------

describe('a deployment writes only the build, never user state', () => {
    it('declares data.json as protected, not deployable', () => {
        expect(DEPLOYABLE_FILES).toEqual(['main.js', 'styles.css', 'manifest.json']);
        expect(DEPLOYABLE_FILES).not.toContain('data.json');
        expect(PROTECTED_FILES).toContain('data.json');
    });

    it('refuses outright if data.json is ever passed as deployable', () => {
        const dist = makeDist();
        const target = makeTarget({ 'data.json': USER_STATE });
        expect(() =>
            deployArtifacts(dist, target, ['main.js', 'data.json'])
        ).toThrow(/data\.json is user state/);
        expect(fs.readFileSync(path.join(target, 'data.json'), 'utf8')).toBe(USER_STATE);
    });

    it('copies exactly the three build files and nothing else', () => {
        const dist = makeDist();
        // Debris in dist that must not travel.
        fs.writeFileSync(path.join(dist, '.hotreload'), '');
        fs.writeFileSync(path.join(dist, 'main.js.map'), '{}');
        const target = makeTarget();

        deployArtifacts(dist, target);

        expect(fs.readdirSync(target).sort()).toEqual([
            'main.js',
            'manifest.json',
            'styles.css',
        ]);
    });

    it('keeps an existing data.json byte-identical', () => {
        const dist = makeDist();
        const target = makeTarget({
            'data.json': USER_STATE,
            'main.js': 'old build',
        });
        const before = inventory(target);

        deployArtifacts(dist, target);

        const after = inventory(target);
        expect(fs.readFileSync(path.join(target, 'data.json'), 'utf8')).toBe(USER_STATE);
        expect(after['data.json']).toBe(before['data.json']);
        // ...while the build really did change, so this is not a no-op test.
        expect(after['main.js']).not.toBe(before['main.js']);
    });

    it('creates no data.json when deploying into a fresh plugin folder', () => {
        const dist = makeDist();
        const target = path.join(workDir, 'fresh', '.obsidian', 'plugins', 'dynamic-action-panel');

        deployArtifacts(dist, target);

        expect(fs.existsSync(path.join(target, 'data.json'))).toBe(false);
        expect(fs.readdirSync(target).sort()).toEqual([
            'main.js',
            'manifest.json',
            'styles.css',
        ]);
    });

    it('ignores a stale dist/data.json completely', () => {
        // The exact hazard that was live before this refactor: a leftover
        // settings file in the build directory, installed into whatever vault
        // was deployed to next.
        const dist = makeDist();
        fs.writeFileSync(path.join(dist, 'data.json'), '{"settingsVersion":3,"stale":true}');
        const target = makeTarget({ 'data.json': USER_STATE });

        deployArtifacts(dist, target);

        expect(fs.readFileSync(path.join(target, 'data.json'), 'utf8')).toBe(USER_STATE);
        expect(fs.readFileSync(path.join(target, 'data.json'), 'utf8')).not.toContain('stale');
    });

    it('ignores a stale dist/data.json when the target has none either', () => {
        const dist = makeDist();
        fs.writeFileSync(path.join(dist, 'data.json'), '{"stale":true}');
        const target = makeTarget();

        deployArtifacts(dist, target);

        expect(fs.existsSync(path.join(target, 'data.json'))).toBe(false);
    });

    it('leaves files it did not write alone rather than clearing the folder', () => {
        // The folder is never wiped, so anything else the user or Obsidian put
        // there survives a deployment.
        const dist = makeDist();
        const target = makeTarget({
            'data.json': USER_STATE,
            '.hotreload': '',
            'notes-of-my-own.txt': 'keep me',
        });

        deployArtifacts(dist, target);

        expect(fs.existsSync(path.join(target, '.hotreload'))).toBe(true);
        expect(fs.readFileSync(path.join(target, 'notes-of-my-own.txt'), 'utf8')).toBe('keep me');
    });
});

// --- Where it may be written -----------------------------------------------

describe('a deployment target is allowlisted or refused', () => {
    it('resolves the two named targets', () => {
        const targets = {
            smoke: fakeTarget('C:/smoke', false),
            prod: fakeTarget('H:/prod', true),
        };
        expect(resolveTarget('smoke', targets).vaultPath).toBe('C:/smoke');
        expect(resolveTarget('prod', targets).vaultPath).toBe('H:/prod');
    });

    it('refuses an unknown target name', () => {
        expect(() =>
            resolveTarget('production', {
                smoke: fakeTarget('C:/smoke', false),
                prod: fakeTarget('H:/prod', true),
            })
        ).toThrow(/Unknown target "production"/);
    });

    it('refuses a missing target name rather than choosing one', () => {
        expect(() =>
            resolveTarget(null, { smoke: fakeTarget('C:/smoke', false) })
        ).toThrow(/No target given/);
    });

    it('accepts the exact allowlisted plugin directory', () => {
        const vaultRoot = path.join(workDir, 'vault');
        const target = makeTarget();
        expect(
            assertAllowedPluginDir(target, allowlistFor(vaultRoot))
        ).toBe('smoke');
    });

    it('rejects a typo in the path before anything is written', () => {
        const vaultRoot = path.join(workDir, 'vault');
        makeTarget({ 'data.json': USER_STATE });
        const typo = path.join(
            workDir,
            'vault',
            '.obsidian',
            'plugins',
            'dynamic-action-pannel'
        );

        expect(() =>
            assertAllowedPluginDir(typo, allowlistFor(vaultRoot))
        ).toThrow(/not an allowed target/);
        // Nothing was created by the attempt.
        expect(fs.existsSync(typo)).toBe(false);
    });

    it('rejects a sibling plugin in the same allowlisted vault', () => {
        // A prefix check would accept this. An equality check must not.
        const vaultRoot = path.join(workDir, 'vault');
        const sibling = path.join(workDir, 'vault', '.obsidian', 'plugins', 'some-other-plugin');
        expect(() =>
            assertAllowedPluginDir(sibling, allowlistFor(vaultRoot))
        ).toThrow(/not an allowed target/);
    });

    it('rejects a parent directory of an allowlisted target', () => {
        const vaultRoot = path.join(workDir, 'vault');
        const parent = path.join(workDir, 'vault', '.obsidian', 'plugins');
        expect(() =>
            assertAllowedPluginDir(parent, allowlistFor(vaultRoot))
        ).toThrow(/not an allowed target/);
    });

    it('accepts the same path written with different separators and a trailing slash', () => {
        const vaultRoot = path.join(workDir, 'vault');
        const target = makeTarget();
        const awkward = `${target.replace(/\\/g, '/')}/`;
        expect(
            assertAllowedPluginDir(awkward, allowlistFor(vaultRoot))
        ).toBe('smoke');
    });

    it('canonicalizes away separators and trailing slashes', () => {
        const a = canonicalPath('C:/Users/x/vault/');
        const b = canonicalPath('C:\\Users\\x\\vault');
        expect(a).toBe(b);
    });

    it('derives the plugin directory from a vault root', () => {
        expect(pluginDirFor('C:/v', 'dynamic-action-panel')).toBe(
            path.join('C:/v', '.obsidian', 'plugins', 'dynamic-action-panel')
        );
    });

    // A theme is not a plugin. It goes into a different folder, and it is named
    // by its DISPLAY NAME rather than by a manifest id, because that is the
    // only identity Obsidian gives a theme. Two functions rather than one
    // parameter, so that confusing them is a compile error and not a theme
    // installed into the plugin list.
    it('derives the theme directory from a vault root', () => {
        expect(themeDirFor('C:/v', THEME_NAME)).toBe(
            path.join('C:/v', '.obsidian', 'themes', THEME_NAME)
        );
        expect(themeDirFor('C:/v', THEME_NAME)).not.toBe(pluginDirFor('C:/v', THEME_NAME));
    });

    it('installs a theme as a theme, and never as user state', () => {
        expect(THEME_FILES).toContain('theme.css');
        expect(THEME_FILES).toContain('manifest.json');
        // The same guard the plugin file list gets: nothing that is the user's.
        expect(() => assertDeployableNames(THEME_FILES)).not.toThrow();
        for (const protectedName of PROTECTED_FILES) {
            expect(THEME_FILES).not.toContain(protectedName);
        }
    });
});

describe('a link anywhere on the path is refused', () => {
    /** A junction, which Windows allows without elevation. */
    function junction(from: string, to: string): boolean {
        try {
            fs.mkdirSync(to, { recursive: true });
            fs.mkdirSync(path.dirname(from), { recursive: true });
            fs.symlinkSync(to, from, 'junction');
            return true;
        } catch {
            // A platform or policy that will not make one: nothing to test.
            return false;
        }
    }

    it('refuses a link at the plugin folder itself', () => {
        const elsewhere = path.join(workDir, 'elsewhere');
        const linked = path.join(workDir, 'vault', '.obsidian', 'plugins', 'dynamic-action-panel');
        if (!junction(linked, elsewhere)) return;

        expect(() => assertNoLinkedAncestor(linked)).toThrow(/is a link/);
    });

    it('refuses a link on an ANCESTOR of the plugin folder', () => {
        // The attack a final-component check misses: writes land in
        // `elsewhere`, while the path string still reads as the allowed target.
        const elsewhere = path.join(workDir, 'elsewhere');
        const plugins = path.join(workDir, 'vault', '.obsidian', 'plugins');
        if (!junction(plugins, elsewhere)) return;

        const pluginDir = path.join(plugins, 'dynamic-action-panel');
        expect(() => assertNoLinkedAncestor(pluginDir)).toThrow(/is a link/);
        expect(() =>
            assertAllowedPluginDir(pluginDir, allowlistFor(path.join(workDir, 'vault')))
        ).toThrow(/is a link/);
    });

    it('accepts a path of ordinary directories', () => {
        const target = makeTarget();
        expect(() => assertNoLinkedAncestor(target)).not.toThrow();
    });

    it('accepts a path that does not exist yet', () => {
        // Nothing there to redirect through.
        expect(() =>
            assertNoLinkedAncestor(path.join(workDir, 'not', 'created', 'yet'))
        ).not.toThrow();
    });
});

// --- Whether it may be written at all --------------------------------------

describe('an incomplete build never reaches a target', () => {
    it('names every missing artifact', () => {
        const dist = path.join(workDir, 'dist');
        fs.mkdirSync(dist, { recursive: true });
        fs.writeFileSync(path.join(dist, 'main.js'), 'x'.repeat(100));

        const problems = validateBuildArtifacts(dist);
        expect(problems).toHaveLength(2);
        expect(problems.join(' ')).toContain('styles.css is missing');
        expect(problems.join(' ')).toContain('manifest.json is missing');
    });

    it('treats a truncated artifact as a failed build', () => {
        const dist = makeDist({ 'main.js': '' });
        expect(validateBuildArtifacts(dist).join(' ')).toMatch(/main\.js is only 0 bytes/);
    });

    it('accepts a complete build', () => {
        expect(validateBuildArtifacts(makeDist())).toEqual([]);
    });

    it('leaves the target untouched when the build is incomplete', () => {
        const dist = path.join(workDir, 'dist');
        fs.mkdirSync(dist, { recursive: true });
        fs.writeFileSync(path.join(dist, 'main.js'), 'x'.repeat(100));
        const target = makeTarget({ 'data.json': USER_STATE, 'main.js': 'old build' });
        const before = inventory(target);

        expect(() => deployArtifacts(dist, target)).toThrow(/Incomplete build/);

        expect(inventory(target)).toEqual(before);
        expect(fs.readFileSync(path.join(target, 'main.js'), 'utf8')).toBe('old build');
    });
});

describe('a failure part way through does not destroy what is installed', () => {
    it('leaves the installed build and data.json intact when a source vanishes', () => {
        const dist = makeDist();
        const target = makeTarget({
            'data.json': USER_STATE,
            'main.js': 'old build',
            'styles.css': 'old styles',
        });
        const before = inventory(target);

        // Validation passes, then the source disappears — the shape of a
        // Dropbox sync or an antivirus quarantine mid-deploy.
        const problems = validateBuildArtifacts(dist);
        expect(problems).toEqual([]);
        fs.rmSync(path.join(dist, 'styles.css'));

        expect(() => deployArtifacts(dist, target)).toThrow();

        // The copy phase failed before any rename, so nothing changed at all.
        expect(inventory(target)).toEqual(before);
    });

    it('leaves no staging files behind after a failed copy', () => {
        const dist = makeDist();
        const target = makeTarget({ 'data.json': USER_STATE });
        fs.rmSync(path.join(dist, 'manifest.json'));

        expect(() => deployArtifacts(dist, target, DEPLOYABLE_FILES)).toThrow();

        const debris = fs.readdirSync(target).filter((name) => name.includes('deploy-tmp'));
        expect(debris).toEqual([]);
    });

    it('replaces an existing file atomically when nothing holds it', () => {
        const target = makeTarget();
        const dest = path.join(target, 'main.js');
        fs.writeFileSync(dest, 'old');
        const source = path.join(workDir, 'new.js');
        fs.writeFileSync(source, 'new');

        const staging = stageFile(source, dest);
        // Still the old content: staging does not touch the destination.
        expect(fs.readFileSync(dest, 'utf8')).toBe('old');
        expect(commitStaged(staging, dest)).toBe('rename');
        expect(fs.readFileSync(dest, 'utf8')).toBe('new');
    });

    it('creates a destination that does not exist yet', () => {
        const target = makeTarget();
        const dest = path.join(target, 'main.js');
        const source = path.join(workDir, 'new.js');
        fs.writeFileSync(source, 'new');

        commitStaged(stageFile(source, dest), dest);

        expect(fs.readFileSync(dest, 'utf8')).toBe('new');
    });

    it('stages under a unique name so two runs cannot collide', () => {
        // A fixed staging name would let a crashed run's leftover be reused, and
        // the plugin folder is inside Dropbox, so leftovers travel.
        const target = makeTarget();
        const dest = path.join(target, 'main.js');
        const source = path.join(workDir, 'new.js');
        fs.writeFileSync(source, 'new');

        const first = stageFile(source, dest);
        const second = stageFile(source, dest);

        expect(first).not.toBe(second);
        expect(path.basename(first)).not.toBe('main.js.deploy-tmp');
    });

    it('cleans up staged files that were never committed', () => {
        // A commit-phase failure: the second destination is a directory, which
        // no replacement strategy can overwrite.
        const dist = makeDist();
        const target = makeTarget({ 'data.json': USER_STATE });
        fs.mkdirSync(path.join(target, 'styles.css'));
        const before = inventory(target);

        expect(() => deployArtifacts(dist, target)).toThrow();

        // data.json is untouched, and nothing staged was left behind.
        expect(inventory(target)['data.json']).toBe(before['data.json']);
        const debris = fs.readdirSync(target).filter((name) => name.includes('deploy-tmp'));
        expect(debris).toEqual([]);
    });

    it('leaves no staging debris behind on success', () => {
        const dist = makeDist();
        const target = makeTarget({ 'data.json': USER_STATE });

        deployArtifacts(dist, target);

        const debris = fs
            .readdirSync(target)
            .filter((name) => name.includes('deploy-tmp') || name.includes('.old-'));
        expect(debris).toEqual([]);
    });
});

// --- The ordered deployment ------------------------------------------------

describe('the deployment runs its checks in the order that makes them safe', () => {
    /** Everything `deployToTarget` needs, aimed at this test's temp vault. */
    function order(options: { dist?: string; targetName?: string; onBeforeWrite?: () => void }) {
        const vaultRoot = path.join(workDir, 'vault');
        return {
            targetName: options.targetName ?? 'smoke',
            distDir: options.dist ?? makeDist(),
            pluginId: 'dynamic-action-panel',
            targets: allowlistFor(vaultRoot),
            onBeforeWrite: options.onBeforeWrite,
        };
    }

    it('installs the build and reports what it did', () => {
        const target = makeTarget({ 'data.json': USER_STATE });
        const result = deployToTarget(order({}));

        expect(result.written).toEqual(['main.js', 'styles.css', 'manifest.json']);
        expect(result.pluginDir).toBe(target);
        expect(result.after['data.json']).toBe(result.before['data.json']);
    });

    it('refuses an unknown target before looking at anything else', () => {
        const target = makeTarget({ 'data.json': USER_STATE });
        const before = inventory(target);

        expect(() => deployToTarget(order({ targetName: 'production' }))).toThrow(
            /Unknown target/
        );

        expect(inventory(target)).toEqual(before);
    });

    it('checks the build before it checks the path', () => {
        // So a broken build never gets as far as naming a vault — the error the
        // user sees is the one they can act on.
        const dist = path.join(workDir, 'empty-dist');
        fs.mkdirSync(dist, { recursive: true });

        expect(() =>
            deployToTarget({ ...order({ dist }), targets: { smoke: fakeTarget('C:/nope', false) } })
        ).toThrow(/Incomplete build/);
    });

    it('runs the caller-supplied backup before the first write', () => {
        const target = makeTarget({ 'data.json': USER_STATE, 'main.js': 'old build' });
        let sawOldBuild: string | null = null;

        deployToTarget(
            order({
                onBeforeWrite: () => {
                    sawOldBuild = fs.readFileSync(path.join(target, 'main.js'), 'utf8');
                },
            })
        );

        // The hook observed the state as it was, not as it became.
        expect(sawOldBuild).toBe('old build');
        expect(fs.readFileSync(path.join(target, 'main.js'), 'utf8')).not.toBe('old build');
    });

    it('writes nothing when the backup fails', () => {
        const target = makeTarget({ 'data.json': USER_STATE, 'main.js': 'old build' });
        const before = inventory(target);

        expect(() =>
            deployToTarget(
                order({
                    onBeforeWrite: () => {
                        throw new Error('backup directory is not writable');
                    },
                })
            )
        ).toThrow(/backup directory is not writable/);

        expect(inventory(target)).toEqual(before);
    });

    it('fails loudly if data.json ever changed across a deployment', () => {
        // Cannot happen through this code, which is the point: the check is
        // there so a future change that breaks the promise cannot do it quietly.
        const target = makeTarget({ 'data.json': USER_STATE });

        expect(() =>
            deployToTarget(
                order({
                    onBeforeWrite: () => {
                        // Simulate something else mutating it mid-deployment.
                        fs.writeFileSync(path.join(target, 'data.json'), '{"tampered":true}');
                    },
                })
            )
        ).toThrow(/data\.json changed during the deployment/);
    });
});

// --- Backup ----------------------------------------------------------------

describe('the production backup captures the build, and data.json only as evidence', () => {
    it('copies the installed build aside', () => {
        const target = makeTarget({
            'main.js': 'installed build',
            'styles.css': 'installed styles',
            'manifest.json': '{"id":"x"}',
        });
        const backup = path.join(workDir, 'backup');

        const saved = backupInstalledBuild(target, backup);

        expect(saved).toContain('main.js');
        expect(fs.readFileSync(path.join(backup, 'main.js'), 'utf8')).toBe('installed build');
    });

    it('names the data.json copy so it can never be restored as live config', () => {
        const target = makeTarget({ 'main.js': 'b', 'data.json': USER_STATE });
        const backup = path.join(workDir, 'backup');

        backupInstalledBuild(target, backup);

        // Evidence, not a restorable file: putting the backup folder back over
        // a plugin directory cannot resurrect an old configuration.
        expect(fs.existsSync(path.join(backup, 'data.json'))).toBe(false);
        expect(fs.readFileSync(path.join(backup, 'data.json.evidence'), 'utf8')).toBe(USER_STATE);
    });

    it('does not fail on a first deployment with nothing to back up', () => {
        const target = makeTarget();
        const backup = path.join(workDir, 'backup');
        expect(backupInstalledBuild(target, backup)).toEqual([]);
    });
});

// --- Integrity -------------------------------------------------------------

describe('the integrity record', () => {
    it('hashes the build files and data.json, and reports absence as null', () => {
        const target = makeTarget({ 'main.js': 'a', 'data.json': USER_STATE });
        const record = inventory(target);

        expect(record['main.js']).toMatch(/^[0-9a-f]{64}$/);
        expect(record['data.json']).toMatch(/^[0-9a-f]{64}$/);
        expect(record['styles.css']).toBeNull();
    });

    it('proves data.json is unchanged across a deployment', () => {
        const dist = makeDist();
        const target = makeTarget({ 'data.json': USER_STATE });
        const before = inventory(target);
        deployArtifacts(dist, target);
        const after = inventory(target);
        expect(after['data.json']).toBe(before['data.json']);
    });
});

// --- The real configuration ------------------------------------------------

describe('the shipped configuration itself', () => {
    it('marks production as productive and smoke as not', () => {
        // Flipping `prod.productive` to false would silently remove the
        // confirmation requirement AND the backup, with every other test green.
        expect(DEPLOY_TARGETS.prod?.productive).toBe(true);
        expect(DEPLOY_TARGETS.smoke?.productive).toBe(false);
    });

    it('names exactly the two intended vaults and no others', () => {
        expect(Object.keys(DEPLOY_TARGETS).sort()).toEqual(['prod', 'smoke']);
        expect(canonicalPath(DEPLOY_TARGETS.prod!.vaultPath)).toBe(
            canonicalPath('H:/Dropbox/01_Uni/A1_Nexus')
        );
        expect(canonicalPath(DEPLOY_TARGETS.smoke!.vaultPath)).toBe(
            canonicalPath('C:/Users/flash/ObsidianTestVaults/ocap-smoke')
        );
    });

    it('keeps backups outside the repository', () => {
        // Inside the working tree, one `git add -A` would publish the productive
        // vault's data.json to a public repository.
        expect(canonicalPath(BACKUP_ROOT).startsWith(canonicalPath(repoRoot))).toBe(false);
    });

    it('pins the plugin id instead of trusting the manifest', () => {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8')
        ) as { id: string };
        expect(PLUGIN_ID).toBe('dynamic-action-panel');
        // They agree today; the point is that deployment checks rather than
        // follows.
        expect(manifest.id).toBe(PLUGIN_ID);
    });

    it('refuses a manifest id that has drifted from the pinned one', () => {
        // The critical hole this closes: with the id taken from the manifest on
        // both sides of the allowlist comparison, `..` resolved to `.obsidian`
        // and `../..` to the vault root — both "allowed".
        for (const rogue of ['..', '../..', 'dataview', 'some-other-plugin']) {
            expect(() =>
                deployToTarget({
                    targetName: 'smoke',
                    distDir: makeDist(),
                    pluginId: rogue,
                    targets: allowlistFor(path.join(workDir, 'vault')),
                })
            ).toThrow(/pinned to "dynamic-action-panel"/);
        }
    });

    it('refuses a directory built from a rogue id even if the id check is bypassed', () => {
        // Defence in depth: the allowlist is built from PLUGIN_ID, so a path
        // assembled from any other id cannot match it.
        const vaultRoot = path.join(workDir, 'vault');
        for (const rogue of ['..', '../..', 'dataview']) {
            expect(() =>
                assertAllowedPluginDir(pluginDirFor(vaultRoot, rogue), allowlistFor(vaultRoot))
            ).toThrow(/not an allowed target/);
        }
    });
});

describe('the deployable file list is constrained', () => {
    it('refuses a name that is not a plain file name', () => {
        // `path.join(pluginDir, '../hijack.js')` escapes the plugin directory.
        for (const rogue of ['../hijack.js', 'sub/main.js', '..', '.', 'a\\b.js']) {
            expect(() => assertDeployableNames([rogue])).toThrow(
                /not a plain file name|not a file name/
            );
        }
    });

    it('refuses data.json whatever its casing', () => {
        // The filesystem here does not distinguish these, so neither may the guard.
        for (const spelling of ['data.json', 'Data.json', 'DATA.JSON']) {
            expect(() => assertDeployableNames([spelling])).toThrow(/user state/);
        }
    });

    it('refuses an empty list', () => {
        expect(() => assertDeployableNames([])).toThrow(/No files to deploy/);
    });

    it('accepts the shipped list', () => {
        expect(() => assertDeployableNames(DEPLOYABLE_FILES)).not.toThrow();
    });

    it('does not create the target when the list is rejected', () => {
        const dist = makeDist();
        const never = path.join(workDir, 'never', 'asked', 'for', 'this');
        expect(() => deployArtifacts(dist, never, ['../hijack.js'])).toThrow();
        expect(fs.existsSync(never)).toBe(false);
    });
});

// --- Static guarantees -----------------------------------------------------

describe('the deploy tooling cannot start or stop a process', () => {
    it('imports no process-spawning module', () => {
        for (const name of ['deployCore.mjs', 'deploy.mjs']) {
            const source = fs.readFileSync(path.join(scriptsDir, name), 'utf8');
            expect(source).not.toMatch(/child_process/);
            expect(source).not.toMatch(/\bspawn\b/);
            expect(source).not.toMatch(/\bexecSync\b/);
            expect(source).not.toMatch(/taskkill|Stop-Process|process\.kill/);
        }
    });

    it('never removes a directory recursively', () => {
        // The old script deleted the whole plugin folder before copying. No
        // recursive removal may reappear in the deploy tooling.
        for (const source of vaultWritingSources()) {
            // Any recursive REMOVAL, however the options are spelled. Creating
            // directories recursively is fine and necessary, so the pattern is
            // anchored on the removal call rather than on the option.
            expect(source).not.toMatch(/\brm(?:dir)?(?:Sync)?\s*\([^)]*recursive/);
        }
    });

    it('keeps the build free of any deploy step', () => {
        const pkg = JSON.parse(
            fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
        ) as { scripts: Record<string, string> };

        expect(pkg.scripts.build).not.toMatch(/deploy/);
        expect(pkg.scripts.dev).not.toMatch(/deploy/);
        // And the deploy commands must name their target explicitly.
        expect(pkg.scripts['deploy:smoke']).toContain('--target smoke');
        expect(pkg.scripts['deploy:prod']).toContain('--target prod');
        expect(pkg.scripts['deploy:prod']).toContain('--confirm-production');
    });

    it('reads no vault location from the environment', () => {
        for (const source of vaultWritingSources()) {
            expect(source).not.toMatch(/process\.env/);
            expect(source).not.toMatch(/VAULT_PATH/);
        }
    });
});
