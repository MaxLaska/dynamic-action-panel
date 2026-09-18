// tests/futureSettings.test.ts
// What happens when this build opens a configuration written by a newer one.
//
// The rule, and it is the whole file:
//
//   A NEWER CONFIGURATION IS READ-ONLY. NEVER WRITE OVER IT.
//
// The migration pipeline has always recognised the situation — a stored
// `settingsVersion` above the one this build understands comes back as
// `status: 'future'`, with a comment saying it must not be persisted. But the
// signal was only logged. The in-memory settings are a LOSSY view of that file:
// `normalizeSettings` forces `tools` to a record and `categories` to an array,
// so a future schema that stores either differently is already reduced before
// anything is written. One view toggle, one moved tool, one renamed category
// afterwards and that reduced view was written back over the real file —
// keeping the higher `settingsVersion`, so no later build would ever recognise
// the damage or repair it.
//
// Hence the tests below assert absence: `saveData` must not be called. A test
// that only checked the file contents afterwards would pass on a write that
// happened to round-trip, and the point is that the write must not happen.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { noticeLog } from './mocks/obsidian';
import { migrateSettings } from '@/settings/settingsMigrations';
import { CURRENT_SETTINGS_VERSION } from '@/types/settings';
import {
    canMutateSettings,
    futureSettingsBlock,
    noteLoadedSettings,
    persistSettings,
} from '@/utils/settingsWriteGuard';
import {
    commitCategories,
    commitStoredCategory,
    commitToolState,
    toolStateOf,
} from '@/utils/categoryStore';
import { exportCategoryTemplate, importTemplateContent } from '@/export/templateIo';
import type { ButtonsPanelPlugin } from '@/types/plugin';

// --- Harness ---------------------------------------------------------------

interface Harness {
    plugin: ButtonsPanelPlugin;
    /** Every `saveData` call, in order — the thing that must not happen. */
    writes: unknown[];
}

/**
 * A plugin that has just finished `loadSettings` over the given stored data.
 *
 * It runs the real composition — migrate, then record what was found — rather
 * than setting a flag by hand, so the tests exercise the path the plugin
 * actually takes at startup.
 */
function loaded(storedData: unknown): Harness {
    const writes: unknown[] = [];
    const plugin = {
        settings: undefined as never,
        futureSettings: null,
        saveData: async (data: unknown) => {
            writes.push(structuredClone(data));
        },
        saveSettings: async () => {
            // Exactly what the real `saveSettings` does: delegate the write.
            await persistSettings(plugin);
        },
        updatePanels: () => {},
    } as unknown as ButtonsPanelPlugin & { updatePanels: () => void };

    const result = migrateSettings(storedData);
    plugin.settings = result.settings;
    const shouldPersist = noteLoadedSettings(plugin, result);
    if (shouldPersist) {
        // Exactly what `main.ts` does at startup — through the guard, not
        // around it, so the belt-and-braces there is actually exercised.
        void persistSettings(plugin);
    }

    return { plugin, writes };
}

/** A document from a build that does not exist yet. */
function futureDocument() {
    return {
        settingsVersion: 999,
        futureOnlyField: { mustSurvive: true, nested: { deeply: [1, 2, 3] } },
        tools: { t1: { id: 't1', name: 'Future tool', actions: [], futureProp: 'keep' } },
        categories: [
            {
                id: 'c1',
                name: 'Future category',
                order: 0,
                layout: 'grid',
                placements: [{ toolId: 't1', slot: 0 }],
                futureCategoryField: 'keep',
            },
        ],
        panelConfig: { interactionMode: 'edit' },
    };
}

/** A document this build wrote itself. */
function currentDocument() {
    return {
        settingsVersion: CURRENT_SETTINGS_VERSION,
        tools: { t1: { id: 't1', name: 'Tool', actions: [] } },
        categories: [
            { id: 'c1', name: 'Cat', order: 0, layout: 'grid', placements: [] },
        ],
    };
}

beforeEach(() => {
    noticeLog.length = 0;
});

// `commitToolState` ends with a DOM event on Obsidian's `activeDocument`, which
// the node test environment does not have.
(globalThis as { activeDocument?: unknown }).activeDocument = {
    dispatchEvent: () => true,
};

// --- Recognising the situation ---------------------------------------------

describe('a configuration from a newer build is recognised', () => {
    it('reports a higher stored version as future, and does not ask to persist', () => {
        const result = migrateSettings({ settingsVersion: CURRENT_SETTINGS_VERSION + 1 });
        expect(result.status).toBe('future');
        expect(result.changed).toBe(false);
        expect(result.fromVersion).toBe(CURRENT_SETTINGS_VERSION + 1);
    });

    it('records the block on the plugin, naming both versions', () => {
        const { plugin } = loaded(futureDocument());
        const block = futureSettingsBlock(plugin);
        expect(block).not.toBeNull();
        expect(block?.storedVersion).toBe(999);
        expect(block?.supportedVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it('keeps the higher version in memory rather than downgrading it', () => {
        const { plugin } = loaded(futureDocument());
        expect(plugin.settings.settingsVersion).toBe(999);
    });

    it('leaves a current document unblocked', () => {
        const { plugin } = loaded(currentDocument());
        expect(futureSettingsBlock(plugin)).toBeNull();
    });
});

describe('a version this build cannot interpret is equally read-only', () => {
    /**
     * A `settingsVersion` that is present but not a usable number used to be
     * treated as "unversioned upstream data" and migrated — which emptied every
     * placement and then WROTE the result at startup. It is now refused for the
     * same reason a future version is: this build cannot say what the document
     * means, and writing over something you cannot read has no recovery.
     */
    const UNUSABLE = ['6', 6.5, -1, null, Number.POSITIVE_INFINITY, true];

    it('blocks writes for every unusable version', async () => {
        for (const version of UNUSABLE) {
            const { plugin, writes } = loaded({ ...futureDocument(), settingsVersion: version });
            expect(futureSettingsBlock(plugin)).not.toBeNull();
            expect(await persistSettings(plugin)).toBe(false);
            expect(writes).toEqual([]);
        }
    });

    it('writes nothing at startup, where the damage used to happen', () => {
        // The old code reported `changed: true` here and persisted immediately.
        const { writes } = loaded({ ...futureDocument(), settingsVersion: '6' });
        expect(writes).toEqual([]);
    });

    it('keeps the placements that migrating would have emptied', () => {
        const { plugin } = loaded({ ...futureDocument(), settingsVersion: '6' });
        expect(plugin.settings.categories[0]).toHaveProperty('placements', [
            { toolId: 't1', slot: 0 },
        ]);
    });

    it('says it cannot interpret the version, rather than blaming the plugin age', () => {
        loaded({ ...futureDocument(), settingsVersion: '6' });
        expect(noticeLog).toHaveLength(1);
        expect(noticeLog[0]).toContain('cannot interpret');
        // And it names the field, because "update the plugin" cannot help here.
        expect(noticeLog[0]).toContain('settingsVersion');
    });

    it('reports no stored version, because there is not a usable one', () => {
        const { plugin } = loaded({ ...futureDocument(), settingsVersion: '6' });
        expect(futureSettingsBlock(plugin)?.storedVersion).toBeNull();
    });
});

// --- Nothing is written -----------------------------------------------------

describe('nothing writes over a newer configuration', () => {
    it('writes nothing at startup', () => {
        const { writes } = loaded(futureDocument());
        expect(writes).toEqual([]);
    });

    it('refuses an ordinary settings save', async () => {
        const { plugin, writes } = loaded(futureDocument());
        expect(await persistSettings(plugin)).toBe(false);
        expect(writes).toEqual([]);
    });

    it('refuses a tool-state commit without mutating the settings first', async () => {
        // The mutation has to be refused, not merely left unsaved: assigning and
        // then failing to persist would leave the panel showing a state the file
        // does not have, until the next reload silently undid it.
        const { plugin, writes } = loaded(futureDocument());
        const toolsBefore = plugin.settings.tools;
        const categoriesBefore = plugin.settings.categories;

        expect(await commitToolState(plugin, { tools: {}, categories: [] })).toBe(false);

        expect(plugin.settings.tools).toBe(toolsBefore);
        expect(plugin.settings.categories).toBe(categoriesBefore);
        expect(writes).toEqual([]);
    });

    it('refuses a whole-array category commit without mutating', async () => {
        const { plugin, writes } = loaded(futureDocument());
        const categoriesBefore = plugin.settings.categories;

        expect(await commitCategories(plugin, [])).toBe(false);

        expect(plugin.settings.categories).toBe(categoriesBefore);
        expect(writes).toEqual([]);
    });

    it('refuses a single-category commit without mutating', async () => {
        const { plugin, writes } = loaded(futureDocument());
        const original = plugin.settings.categories[0];

        expect(
            await commitStoredCategory(plugin, {
                ...original!,
                name: 'Renamed by an older build',
            })
        ).toBe(false);

        expect(plugin.settings.categories[0]).toBe(original);
        expect(writes).toEqual([]);
    });

    it('survives a whole editing session without a single write', async () => {
        // The realistic failure: not one action, but someone working for a
        // while before noticing.
        const { plugin, writes } = loaded(futureDocument());
        for (let round = 0; round < 10; round += 1) {
            await commitToolState(plugin, { tools: {}, categories: [] });
            await commitCategories(plugin, []);
            await persistSettings(plugin);
        }
        expect(writes).toEqual([]);
    });
});

// --- The stored document is untouched ---------------------------------------

describe('the stored document is left exactly as it was', () => {
    it('is deep-equal to the original after a full editing session', async () => {
        const stored = futureDocument();
        const pristine = structuredClone(stored);
        const { plugin } = loaded(stored);

        await commitToolState(plugin, { tools: {}, categories: [] });
        await commitCategories(plugin, []);
        await persistSettings(plugin);

        // Nothing wrote, so nothing can have changed — including the fields
        // this build has no idea about.
        expect(stored).toEqual(pristine);
    });

    it('never reduces the unknown fields it could not have rewritten', () => {
        // `normalizeSettings` keeps unknown top-level keys in memory, which is
        // what makes the in-memory view usable at all. The guarantee that
        // matters is that this lossy view is never the thing on disk.
        const { plugin } = loaded(futureDocument());
        expect(
            (plugin.settings as unknown as { futureOnlyField?: unknown }).futureOnlyField
        ).toEqual({ mustSurvive: true, nested: { deeply: [1, 2, 3] } });
    });
});

// --- Telling the user -------------------------------------------------------

describe('the user is told once, then not nagged', () => {
    it('warns once when the configuration is opened', () => {
        loaded(futureDocument());
        expect(noticeLog).toHaveLength(1);
        expect(noticeLog[0]).toContain('older than your saved configuration');
        // Both versions are named, so the user can tell what to update to.
        expect(noticeLog[0]).toContain('999');
        expect(noticeLog[0]).toContain(String(CURRENT_SETTINGS_VERSION));
    });

    it('does not warn at all for a supported configuration', () => {
        loaded(currentDocument());
        expect(noticeLog).toEqual([]);
    });

    it('explains the first refused change, and then stays quiet', async () => {
        const { plugin } = loaded(futureDocument());
        noticeLog.length = 0;

        await commitToolState(plugin, { tools: {}, categories: [] });
        expect(noticeLog).toHaveLength(1);
        expect(noticeLog[0]).toContain('cannot be saved');

        // Twenty more attempts in quick succession must not produce twenty
        // more notices.
        for (let round = 0; round < 20; round += 1) {
            await commitToolState(plugin, { tools: {}, categories: [] });
            await persistSettings(plugin);
        }
        expect(noticeLog).toHaveLength(1);
    });

    it('does not warn again every time the panel is opened', () => {
        // `loadSettings` runs on every panel open, not just at startup, so the
        // warning has to fire when the block appears — not whenever it is
        // re-derived.
        const { plugin } = loaded(futureDocument());
        expect(noticeLog).toHaveLength(1);

        for (let open = 0; open < 5; open += 1) {
            const again = migrateSettings(futureDocument());
            plugin.settings = again.settings;
            noteLoadedSettings(plugin, again);
        }
        expect(noticeLog).toHaveLength(1);
    });

    it('warns again once the file has been swapped for a different future one', () => {
        const { plugin } = loaded(futureDocument());
        expect(noticeLog).toHaveLength(1);

        // A different newer version is genuinely new information.
        const newer = migrateSettings({ ...futureDocument(), settingsVersion: 1000 });
        plugin.settings = newer.settings;
        noteLoadedSettings(plugin, newer);
        expect(noticeLog).toHaveLength(2);
    });

    it('says nothing when the settings are merely read', () => {
        const { plugin } = loaded(futureDocument());
        noticeLog.length = 0;
        // Reading is what the compatibility mode is FOR.
        expect(canMutateSettings(plugin, { silent: true })).toBe(false);
        expect(plugin.settings.categories).toHaveLength(1);
        expect(noticeLog).toEqual([]);
    });
});

// --- Everything else keeps working ------------------------------------------

describe('a supported configuration is unaffected', () => {
    it('saves normally', async () => {
        const { plugin, writes } = loaded(currentDocument());
        expect(await persistSettings(plugin)).toBe(true);
        expect(writes).toHaveLength(1);
    });

    it('commits tool state normally', async () => {
        const { plugin, writes } = loaded(currentDocument());
        expect(await commitToolState(plugin, { tools: {}, categories: [] })).toBe(true);
        expect(plugin.settings.tools).toEqual({});
        expect(writes).toHaveLength(1);
    });

    it('commits categories normally', async () => {
        const { plugin, writes } = loaded(currentDocument());
        expect(await commitCategories(plugin, [])).toBe(true);
        expect(writes).toHaveLength(1);
    });
});

describe('an older configuration still migrates and is still written once', () => {
    it('persists the migration result at startup, exactly as before', () => {
        const { plugin, writes } = loaded({
            settingsVersion: 4,
            tools: {},
            categories: [],
        });

        expect(plugin.settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
        expect(writes).toHaveLength(1);
        expect(futureSettingsBlock(plugin)).toBeNull();
    });

    it('stays writable afterwards', async () => {
        const { plugin, writes } = loaded({ settingsVersion: 4, tools: {}, categories: [] });
        expect(await persistSettings(plugin)).toBe(true);
        expect(writes).toHaveLength(2);
    });

    it('treats an absent document as defaults, not as future', () => {
        const { plugin } = loaded(null);
        expect(futureSettingsBlock(plugin)).toBeNull();
        expect(plugin.settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });
});

// --- Templates ---------------------------------------------------------------

describe('templates against a newer configuration', () => {
    /** A vault fake that records what the template code writes into it. */
    function vault() {
        const created: { path: string; content: string }[] = [];
        return {
            created,
            app: {
                vault: {
                    getAbstractFileByPath: () => null,
                    getFolderByPath: (p: string) => ({ path: p, children: [] }),
                    createFolder: async () => {},
                    create: async (path: string, content: string) => {
                        created.push({ path, content });
                    },
                },
            },
        };
    }

    const TEMPLATE = JSON.stringify({
        format: 'ocap-template',
        formatVersion: 1,
        categories: [{ id: 'x', name: 'Imported', placements: [{ toolId: 'tx' }] }],
        tools: { tx: { id: 'tx', name: 'Imported tool', actions: [] } },
    });

    it('refuses the import, changes nothing, and does not claim success', async () => {
        const { plugin, writes } = loaded(futureDocument());
        const v = vault();
        noticeLog.length = 0;
        const categoriesBefore = plugin.settings.categories;

        expect(
            await importTemplateContent(v.app as never, plugin, TEMPLATE)
        ).toBe(false);

        expect(writes).toEqual([]);
        expect(plugin.settings.categories).toBe(categoriesBefore);
        // The refusal is explained; "Imported 1 category" is never said.
        expect(noticeLog.join(' ')).toContain('cannot be saved');
        expect(noticeLog.join(' ')).not.toContain('Imported');
    });

    it('still imports normally into a supported configuration', async () => {
        const { plugin, writes } = loaded(currentDocument());
        const v = vault();

        expect(await importTemplateContent(v.app as never, plugin, TEMPLATE)).toBe(true);
        expect(writes).toHaveLength(1);
        expect(plugin.settings.categories).toHaveLength(2);
    });

    it('still exports, because exporting only reads and writes its own file', async () => {
        // Blocking this would take away the one way to rescue a category from a
        // configuration the user cannot otherwise edit.
        const { plugin, writes } = loaded(futureDocument());
        const v = vault();
        noticeLog.length = 0;

        await exportCategoryTemplate(v.app as never, plugin, 'c1');

        expect(v.created).toHaveLength(1);
        expect(v.created[0]!.path).toContain('Future category.ocap.json');
        // Nothing was persisted to the settings.
        expect(writes).toEqual([]);
    });

    it('says the export may be incomplete, rather than implying it is a backup', async () => {
        const { plugin } = loaded(futureDocument());
        const v = vault();
        noticeLog.length = 0;

        await exportCategoryTemplate(v.app as never, plugin, 'c1');

        expect(noticeLog.at(-1)).toContain('may not include everything');
    });

    it('adds no such caveat for a supported configuration', async () => {
        const { plugin } = loaded(currentDocument());
        const v = vault();
        noticeLog.length = 0;

        await exportCategoryTemplate(v.app as never, plugin, 'c1');

        expect(noticeLog.at(-1)).toContain('Exported');
        expect(noticeLog.at(-1)).not.toContain('may not include everything');
    });
});

// --- Nothing claims to have succeeded ---------------------------------------

describe('a refused change is never reported as done', () => {
    /**
     * The commit funnels are the one thing a caller can test its own reaction
     * to. Every caller that announces success or fires a callback afterwards
     * must branch on this — a "Button created" notice next to "changes cannot
     * be saved" is a contradiction the user has to resolve themselves.
     */
    it('returns false from every funnel so callers can tell', async () => {
        const { plugin } = loaded(futureDocument());
        const category = plugin.settings.categories[0]!;

        expect(await commitToolState(plugin, { tools: {}, categories: [] })).toBe(false);
        expect(await commitCategories(plugin, [])).toBe(false);
        expect(await commitStoredCategory(plugin, { ...category, name: 'x' })).toBe(false);
    });

    it('returns true from every funnel when the configuration is writable', async () => {
        const { plugin } = loaded(currentDocument());
        const category = plugin.settings.categories[0]!;

        expect(await commitToolState(plugin, toolStateOf(plugin))).toBe(true);
        expect(await commitCategories(plugin, plugin.settings.categories)).toBe(true);
        expect(await commitStoredCategory(plugin, { ...category, name: 'x' })).toBe(true);
    });

    it('keeps the settings tab read-only, and says why', () => {
        // A form whose controls silently revert on the next open is the
        // ten-minutes-then-discover failure in miniature.
        const { plugin } = loaded(futureDocument());
        expect(canMutateSettings(plugin, { silent: true })).toBe(false);

        const { plugin: ok } = loaded(currentDocument());
        expect(canMutateSettings(ok, { silent: true })).toBe(true);
    });
});

// --- The choke point, asserted against the source ---------------------------

describe('there is exactly one place that writes settings', () => {
    /**
     * The claim the whole design rests on, checked against the sources because
     * no behavioural test can reach it: `main.ts` is imported by no test, so
     * restoring a direct `await this.saveData(this.settings)` there would leave
     * every other test in this file green while reopening the bug completely.
     *
     * Crude, and the same technique the deploy-safety tests use for the same
     * reason: it pins intent that behaviour cannot.
     */
    function sourceFiles(): { path: string; text: string }[] {
        const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
        const found: { path: string; text: string }[] = [];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (/\.tsx?$/.test(entry.name)) {
                    found.push({ path: full, text: fs.readFileSync(full, 'utf8') });
                }
            }
        };
        walk(srcDir);
        return found;
    }

    /** `saveData(` as a call, not the word inside a comment. */
    function callsSaveData(text: string): boolean {
        return text
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
            .some((line) => /\bsaveData\s*\(/.test(line));
    }

    it('calls saveData in settingsWriteGuard.ts and nowhere else', () => {
        const writers = sourceFiles()
            .filter((file) => callsSaveData(file.text))
            .map((file) => path.basename(file.path));

        expect(writers).toEqual(['settingsWriteGuard.ts']);
    });

    it('routes that one call through the guard', () => {
        const guard = fs.readFileSync(
            fileURLToPath(new URL('../src/utils/settingsWriteGuard.ts', import.meta.url)),
            'utf8'
        );
        // The refusal must come before the write, in that order.
        const refusal = guard.indexOf('if (!canMutateSettings(plugin))');
        const write = guard.indexOf('saveData(');
        expect(refusal).toBeGreaterThan(-1);
        expect(write).toBeGreaterThan(refusal);
    });
});

// --- The block belongs to the loaded file, not to the process ---------------

describe('protection is tied to the loaded configuration', () => {
    it('lifts when a supported configuration is loaded into the same instance', async () => {
        // The panel re-reads on every open, so a file that has been brought
        // back within a supported version must become writable again without a
        // reload — which is why the block is cleared, not merely never set.
        const { plugin, writes } = loaded(futureDocument());
        expect(await persistSettings(plugin)).toBe(false);

        const supported = migrateSettings(currentDocument());
        plugin.settings = supported.settings;
        noteLoadedSettings(plugin, supported);

        expect(futureSettingsBlock(plugin)).toBeNull();
        expect(await persistSettings(plugin)).toBe(true);
        expect(writes).toHaveLength(1);
    });

    it('does not leak from one plugin instance to the next', async () => {
        const blocked = loaded(futureDocument());
        expect(await persistSettings(blocked.plugin)).toBe(false);

        // A second vault, a reload, a disable/enable: a fresh instance over a
        // supported document must be fully writable.
        const fine = loaded(currentDocument());
        expect(await persistSettings(fine.plugin)).toBe(true);
        expect(fine.writes).toHaveLength(1);
        // ...and the first one is still blocked.
        expect(await persistSettings(blocked.plugin)).toBe(false);
        expect(blocked.writes).toEqual([]);
    });
});
