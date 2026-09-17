import { describe, expect, it } from 'vitest';
import { migrateSettings } from '@/settings/settingsMigrations';
import { CURRENT_SETTINGS_VERSION, DEFAULT_SETTINGS } from '@/types/settings';

/** Realistic upstream (unversioned) data.json payload. */
function makeLegacyData(): Record<string, unknown> {
    return {
        categories: [
            {
                id: 'cat-1',
                name: 'Category 1',
                order: 0,
                buttons: [
                    {
                        id: 'btn-1',
                        name: 'Open daily note',
                        icon: '🗓',
                        actions: [{ type: 'command', parameters: { commandId: 'daily-notes' } }],
                        order: 0,
                        executionMode: 'sequential',
                        stopOnError: true,
                        delayBetweenActions: 100,
                    },
                    {
                        id: 'btn-2',
                        name: 'Second',
                        actions: [],
                        order: 1,
                    },
                ],
            },
            { id: 'cat-2', name: 'Category 2', order: 1, buttons: [] },
        ],
        panelConfig: {
            displayStyle: 'icon_left',
            panelViewType: 'tabs',
            interactionMode: 'sort',
        },
        pathConfig: { scriptFolderPath: 'my-scripts/' },
    };
}

describe('migrateSettings', () => {
    it('returns fresh defaults for null (no stored data)', () => {
        const result = migrateSettings(null);
        expect(result.status).toBe('defaults');
        expect(result.changed).toBe(false);
        expect(result.settings).toEqual(DEFAULT_SETTINGS);
        // Never hand out the shared DEFAULT_SETTINGS objects mutably.
        expect(result.settings).not.toBe(DEFAULT_SETTINGS);
        expect(result.settings.panelConfig).not.toBe(DEFAULT_SETTINGS.panelConfig);
        expect(result.settings.pathConfig).not.toBe(DEFAULT_SETTINGS.pathConfig);
    });

    it('returns defaults for non-object data', () => {
        for (const raw of [undefined, 42, 'text', [1, 2, 3]]) {
            const result = migrateSettings(raw);
            expect(result.status).toBe('defaults');
            expect(result.settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
        }
    });

    it('migrates unversioned upstream settings to the current version', () => {
        const legacy = makeLegacyData();
        const result = migrateSettings(legacy);

        expect(result.status).toBe('migrated');
        expect(result.changed).toBe(true);
        expect(result.fromVersion).toBe(0);
        expect(result.settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it('preserves existing categories and buttons through migration', () => {
        const legacy = makeLegacyData();
        const result = migrateSettings(legacy);

        expect(result.settings.categories).toBe(legacy.categories);
        expect(result.settings.categories).toHaveLength(2);
        expect(result.settings.categories[0]!.buttons[0]!.name).toBe('Open daily note');
        expect(result.settings.categories[0]!.buttons[1]!.id).toBe('btn-2');
        // Buttons without conditions stay condition-free (static behavior).
        expect(result.settings.categories[0]!.buttons[0]!.conditions).toBeUndefined();
    });

    it('deep-merges missing nested defaults without overwriting stored values', () => {
        const legacy = makeLegacyData();
        const result = migrateSettings(legacy);

        // Stored nested values survive.
        expect(result.settings.panelConfig.displayStyle).toBe('icon_left');
        expect(result.settings.panelConfig.panelViewType).toBe('tabs');
        expect(result.settings.pathConfig.scriptFolderPath).toBe('my-scripts/');
        // Missing nested optional fields are filled from defaults.
        expect(result.settings.panelConfig.showTopNavBar).toBe(
            DEFAULT_SETTINGS.panelConfig.showTopNavBar
        );
        expect(result.settings.panelConfig.folderShowBtnCount).toBe(
            DEFAULT_SETTINGS.panelConfig.folderShowBtnCount
        );
        expect(result.settings.pathConfig.templateFolderPath).toBe(
            DEFAULT_SETTINGS.pathConfig.templateFolderPath
        );
    });

    it('handles missing optional top-level fields', () => {
        const result = migrateSettings({ categories: [] });
        expect(result.status).toBe('migrated');
        expect(result.settings.panelConfig).toEqual(DEFAULT_SETTINGS.panelConfig);
        expect(result.settings.pathConfig).toEqual(DEFAULT_SETTINGS.pathConfig);
    });

    it('falls back to an empty category list for invalid categories data', () => {
        const result = migrateSettings({ categories: 'broken' });
        expect(result.settings.categories).toEqual([]);
    });

    it('does not mutate the raw input', () => {
        const legacy = makeLegacyData();
        const snapshot: unknown = JSON.parse(JSON.stringify(legacy));
        migrateSettings(legacy);
        expect(legacy).toEqual(snapshot);
        expect('settingsVersion' in legacy).toBe(false);
    });

    it('is idempotent: re-loading migrated settings reports no change and equal data', () => {
        const first = migrateSettings(makeLegacyData());
        const persisted = JSON.parse(
            JSON.stringify(first.settings)
        ) as Record<string, unknown>;

        const second = migrateSettings(persisted);
        expect(second.status).toBe('current');
        expect(second.changed).toBe(false);
        expect(JSON.parse(JSON.stringify(second.settings))).toEqual(persisted);
    });

    it('loads already-current settings without marking them changed', () => {
        const legacy = makeLegacyData();
        const current = { ...legacy, settingsVersion: CURRENT_SETTINGS_VERSION };
        const result = migrateSettings(current);
        expect(result.status).toBe('current');
        expect(result.changed).toBe(false);
        expect(result.settings.categories).toBe(legacy['categories']);
    });

    it('treats invalid settingsVersion values as unversioned', () => {
        for (const version of ['2', -1, 1.5, null]) {
            const result = migrateSettings({ ...makeLegacyData(), settingsVersion: version });
            expect(result.status).toBe('migrated');
            expect(result.settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
        }
    });

    it('never downgrades data from an unknown future version', () => {
        const future = {
            ...makeLegacyData(),
            settingsVersion: CURRENT_SETTINGS_VERSION + 5,
            someFutureFeature: { enabled: true },
        };
        const result = migrateSettings(future);

        expect(result.status).toBe('future');
        expect(result.changed).toBe(false);
        // The higher version is preserved, not stamped down.
        expect(result.settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION + 5);
        // Unknown future keys survive best-effort loading.
        expect(
            (result.settings as unknown as Record<string, unknown>)['someFutureFeature']
        ).toEqual({ enabled: true });
        // Known data is still usable.
        expect(result.settings.categories).toHaveLength(2);
    });

    it('preserves unknown top-level keys through migration', () => {
        const legacy = { ...makeLegacyData(), customUserKey: 'keep-me' };
        const result = migrateSettings(legacy);
        expect(
            (result.settings as unknown as Record<string, unknown>)['customUserKey']
        ).toBe('keep-me');
    });
});

// The palette grid added CategoryConfig.layout and ButtonConfig.slot in
// version 1; version 2 turned a grid category into a layered palette;
// version 3 turns the layers into complete variants.
describe('palette grid fields are carried through', () => {
    it('loads legacy categories without layout/slot unchanged', () => {
        const result = migrateSettings(makeLegacyData());
        const category = result.settings.categories[0]!;

        expect(category.layout).toBeUndefined();
        expect(category.buttons[0]!.slot).toBeUndefined();
        expect(category.variants).toBeUndefined();
        // Buttons are handed through untouched, order included.
        expect(category.buttons.map((b) => b.order)).toEqual(
            [...category.buttons].map((_, i) => i)
        );
    });

    it('keeps a conditionless grid category STATIC with its exact slots', () => {
        const stored = {
            settingsVersion: 1,
            categories: [
                {
                    id: 'palette',
                    name: 'Palette',
                    order: 0,
                    layout: 'grid',
                    buttons: [
                        { id: 'a', name: 'A', actions: [], order: 0, slot: 0 },
                        { id: 'b', name: 'B', actions: [], order: 1, slot: 7 },
                    ],
                },
            ],
            panelConfig: {},
            pathConfig: {},
        };

        const result = migrateSettings(stored);

        expect(result.status).toBe('migrated');
        expect(result.settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
        expect(result.settings.categories[0]!.layout).toBe('grid');
        expect(result.settings.categories[0]!.buttons.map((b) => b.slot)).toEqual([0, 7]);
        // Nothing contextual in this grid, so no variant is invented.
        expect(result.settings.categories[0]!.variants).toBeUndefined();
    });
});

const MD: unknown = { rule: 'viewType', value: 'markdown' };
const TYPE_A: unknown = { rule: 'property', op: 'equals', key: 'type', value: 'A' };
const TYPE_B: unknown = { rule: 'property', op: 'equals', key: 'type', value: 'B' };

/** Buttons of a variant as a sorted [name, slot] list (ids are derived). */
function variantGrid(variant: {
    buttons: { name: string; slot?: number }[];
}): [string, number | undefined][] {
    return variant.buttons
        .map((b): [string, number | undefined] => [b.name, b.slot])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// Version 3: dynamic category variants, reached from v1 data through the
// retired v2 layer model. A v1 grid category with per-button conditions ends
// as a DYNAMIC category whose variants reproduce the old effective grids.
describe('chain v1 → v4 (through the retired layer model)', () => {
    it('is the current settings version', () => {
        expect(CURRENT_SETTINGS_VERSION).toBe(4);
    });

    function gridData(buttons: unknown[], extra: Record<string, unknown> = {}) {
        return {
            settingsVersion: 1,
            categories: [
                {
                    id: 'palette',
                    name: 'Palette',
                    order: 0,
                    layout: 'grid',
                    buttons,
                    ...extra,
                },
            ],
            panelConfig: {},
            pathConfig: {},
        };
    }

    it('turns per-button conditions into full variants plus a Default fallback', () => {
        const result = migrateSettings(
            gridData([
                { id: 'home', name: 'Home', actions: [], order: 0, slot: 0 },
                { id: 'a1', name: 'A1', actions: [], order: 1, slot: 1, conditions: TYPE_A },
                { id: 'md', name: 'MD', actions: [], order: 2, slot: 2, conditions: MD },
                { id: 'a2', name: 'A2', actions: [], order: 3, slot: 3, conditions: TYPE_A },
            ])
        );

        const category = result.settings.categories[0]!;
        expect(category.buttons).toEqual([]);

        const variants = category.variants!;
        expect(variants).toHaveLength(3);
        // First-appearance order, so priority is deterministic.
        expect(variants[0]!.trigger).toEqual(TYPE_A);
        expect(variants[0]!.name).toBe('type = A');
        // The variant is the COMPLETE old effective grid: base + its tools.
        expect(variantGrid(variants[0]!)).toEqual([
            ['A1', 1],
            ['A2', 3],
            ['Home', 0],
        ]);
        expect(variants[1]!.trigger).toEqual(MD);
        expect(variantGrid(variants[1]!)).toEqual([
            ['Home', 0],
            ['MD', 2],
        ]);
        // The old base-only state survives as the fallback.
        expect(variants[2]!.fallback).toBe(true);
        expect(variants[2]!.name).toBe('Default');
        expect(variantGrid(variants[2]!)).toEqual([['Home', 0]]);
    });

    it('keeps a structurally invalid condition on the (static) grid button', () => {
        // It failed open in version 1 (the button was always visible), so the
        // static grid is the behavior-preserving home — the data survives.
        const broken = { rule: 'nonsense' };
        const result = migrateSettings(
            gridData([
                { id: 'a', name: 'A', actions: [], order: 0, slot: 0, conditions: broken },
            ])
        );
        const category = result.settings.categories[0]!;
        expect(category.variants).toBeUndefined();
        expect(category.buttons[0]!.conditions).toEqual(broken);
    });

    it('leaves a category-level condition alone', () => {
        const result = migrateSettings(
            gridData(
                [{ id: 'a', name: 'A', actions: [], order: 0, slot: 0, conditions: MD }],
                { conditions: TYPE_A }
            )
        );
        expect(result.settings.categories[0]!.conditions).toEqual(TYPE_A);
    });

    it('leaves flow categories and their per-button conditions untouched', () => {
        const stored = {
            settingsVersion: 1,
            categories: [
                {
                    id: 'flow',
                    name: 'Flow',
                    order: 0,
                    buttons: [
                        { id: 'a', name: 'A', actions: [], order: 0, conditions: MD },
                        { id: 'b', name: 'B', actions: [], order: 1 },
                    ],
                },
            ],
            panelConfig: {},
            pathConfig: {},
        };
        const category = migrateSettings(stored).settings.categories[0]!;
        expect(category.variants).toBeUndefined();
        expect(category.buttons[0]!.conditions).toEqual(MD);
        expect(category.buttons.map((b) => b.slot)).toEqual([undefined, undefined]);
    });

    it('handles an empty grid category', () => {
        const category = migrateSettings(gridData([])).settings.categories[0]!;
        expect(category.buttons).toEqual([]);
        expect(category.variants).toBeUndefined();
    });

    it('migrates unversioned upstream data straight through to the current version', () => {
        const result = migrateSettings(makeLegacyData());
        expect(result.settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
        expect(result.status).toBe('migrated');
        expect(result.fromVersion).toBe(0);
    });

    it('is idempotent: migrating the migrated result changes nothing', () => {
        const once = migrateSettings(
            gridData([
                { id: 'a', name: 'A', actions: [], order: 0, slot: 0, conditions: MD },
                { id: 'b', name: 'B', actions: [], order: 1, slot: 1 },
            ])
        ).settings;
        const twice = migrateSettings(JSON.parse(JSON.stringify(once))).settings;
        expect(twice).toEqual(once);
    });

    it('loses no button when the grid holds more buttons than slots', () => {
        const buttons = Array.from({ length: 20 }, (_, i) => ({
            id: `b${i}`,
            name: `B${i}`,
            actions: [],
            order: i,
            ...(i % 2 === 0 ? {} : { conditions: MD }),
        }));
        const category = migrateSettings(gridData(buttons)).settings.categories[0]!;
        // Every original button name survives somewhere (base copies may be
        // duplicated across variants, so compare unique names).
        const names = new Set([
            ...category.buttons.map((b) => b.name),
            ...(category.variants ?? []).flatMap((v) => v.buttons.map((b) => b.name)),
        ]);
        expect([...names].sort()).toEqual(buttons.map((b) => b.name).sort());
    });
});

// Version 2 → 3 directly: every context profile becomes one complete variant
// (base + profile on the old effective slots), the base-only state becomes
// the fallback, and profile order stays the priority.
describe('version 3 – v2 layer palettes become variant categories', () => {
    function v2Data(
        category: Record<string, unknown>,
        more: Record<string, unknown>[] = []
    ) {
        return {
            settingsVersion: 2,
            categories: [category, ...more],
            panelConfig: {},
            pathConfig: {},
        };
    }

    function v2Grid(
        buttons: unknown[],
        contextProfiles?: unknown[],
        extra: Record<string, unknown> = {}
    ): Record<string, unknown> {
        return {
            id: 'palette',
            name: 'Palette',
            order: 0,
            layout: 'grid',
            buttons,
            ...(contextProfiles ? { contextProfiles } : {}),
            ...extra,
        };
    }

    const base = [
        { id: 'b1', name: 'Home', actions: [], order: 0, slot: 0 },
        { id: 'b3', name: 'Search', actions: [], order: 1, slot: 2 },
    ];
    const sourceProfile = {
        id: 'p-source',
        name: 'Source',
        conditions: TYPE_A,
        buttons: [
            { id: 'b2', name: 'Fundstelle', actions: [], order: 0, slot: 1 },
            { id: 'b4', name: 'Zotero', actions: [], order: 1, slot: 3 },
        ],
    };
    const topicProfile = {
        id: 'p-topic',
        name: 'Topic',
        conditions: TYPE_B,
        buttons: [
            { id: 'b2t', name: 'Argument', actions: [], order: 0, slot: 1 },
            { id: 'b6', name: 'Refs', actions: [], order: 1, slot: 5 },
        ],
    };

    it('composes base + profile into one complete variant per profile', () => {
        const result = migrateSettings(
            v2Data(v2Grid(base, [sourceProfile, topicProfile]))
        );
        const category = result.settings.categories[0]!;

        expect(result.status).toBe('migrated');
        expect(category.buttons).toEqual([]);
        const variants = category.variants!;
        expect(variants).toHaveLength(3);

        // Source variant: base + Source, exactly on the old effective slots.
        expect(variants[0]!.name).toBe('Source');
        expect(variants[0]!.trigger).toEqual(TYPE_A);
        expect(variantGrid(variants[0]!)).toEqual([
            ['Fundstelle', 1],
            ['Home', 0],
            ['Search', 2],
            ['Zotero', 3],
        ]);

        // Topic variant: base + Topic.
        expect(variants[1]!.name).toBe('Topic');
        expect(variants[1]!.trigger).toEqual(TYPE_B);
        expect(variantGrid(variants[1]!)).toEqual([
            ['Argument', 1],
            ['Home', 0],
            ['Refs', 5],
            ['Search', 2],
        ]);

        // Fallback: base only, original button ids preserved.
        expect(variants[2]!.fallback).toBe(true);
        expect(variants[2]!.buttons.map((b) => b.id)).toEqual(['b1', 'b3']);
        expect(variantGrid(variants[2]!)).toEqual([
            ['Home', 0],
            ['Search', 2],
        ]);
    });

    it('keeps every button id unique across variants (derived base copies)', () => {
        const result = migrateSettings(
            v2Data(v2Grid(base, [sourceProfile, topicProfile]))
        );
        const variants = result.settings.categories[0]!.variants!;
        const ids = variants.flatMap((v) => v.buttons.map((b) => b.id));
        expect(new Set(ids).size).toBe(ids.length);
        // Profile-owned tools keep their original ids.
        expect(ids).toContain('b2');
        expect(ids).toContain('b6');
    });

    it('preserves actions, icons and the full button config in the copies', () => {
        const richBase = [
            {
                id: 'b1',
                name: 'Home',
                icon: 'home',
                actions: [{ type: 'command', parameters: { commandId: 'go-home' } }],
                order: 0,
                slot: 0,
                customCss: 'color: red',
                executionMode: 'parallel',
                stopOnError: false,
                delayBetweenActions: 250,
            },
        ];
        const result = migrateSettings(v2Data(v2Grid(richBase, [sourceProfile])));
        const composed = result.settings.categories[0]!.variants![0]!;
        const copy = composed.buttons.find((b) => b.name === 'Home')!;
        expect(copy).toMatchObject({
            icon: 'home',
            customCss: 'color: red',
            executionMode: 'parallel',
            stopOnError: false,
            delayBetweenActions: 250,
            slot: 0,
        });
        expect(copy.actions).toEqual(richBase[0]!.actions);
    });

    it('a conditionless v2 profile becomes an explicit always-true trigger', () => {
        // In v2 a profile without a condition always matched (in priority
        // order); `{ all: [] }` reproduces exactly that.
        const always = { id: 'p-always', name: 'Always', buttons: [] };
        const result = migrateSettings(v2Data(v2Grid(base, [always])));
        const variants = result.settings.categories[0]!.variants!;
        expect(variants[0]!.trigger).toEqual({ all: [] });
        expect(variants[0]!.fallback).toBeUndefined();
    });

    it('no base buttons -> no fallback variant', () => {
        const result = migrateSettings(v2Data(v2Grid([], [sourceProfile])));
        const variants = result.settings.categories[0]!.variants!;
        expect(variants).toHaveLength(1);
        expect(variants.some((v) => v.fallback === true)).toBe(false);
    });

    it('an empty profile still becomes a variant holding the base grid', () => {
        const empty = { id: 'p-empty', name: 'Empty', conditions: TYPE_A, buttons: [] };
        const result = migrateSettings(v2Data(v2Grid(base, [empty])));
        const variants = result.settings.categories[0]!.variants!;
        expect(variantGrid(variants[0]!)).toEqual([
            ['Home', 0],
            ['Search', 2],
        ]);
    });

    it('a profile tool colliding with a base slot is relocated, never dropped', () => {
        const clashing = {
            id: 'p-clash',
            name: 'Clash',
            conditions: TYPE_A,
            buttons: [{ id: 'x', name: 'X', actions: [], order: 0, slot: 0 }],
        };
        const result = migrateSettings(v2Data(v2Grid(base, [clashing])));
        const composed = result.settings.categories[0]!.variants![0]!;
        const x = composed.buttons.find((b) => b.name === 'X')!;
        expect(x.slot).toBe(1); // lowest slot the base leaves free
        expect(composed.buttons).toHaveLength(3);
    });

    it('skips malformed profile entries exactly like the v2 runtime did', () => {
        const result = migrateSettings(
            v2Data(
                v2Grid(base, [
                    null,
                    42,
                    { id: 7, buttons: [] },
                    { id: 'no-buttons-field' },
                    sourceProfile,
                ])
            )
        );
        const variants = result.settings.categories[0]!.variants!;
        // Source + fallback; the dead entries produce nothing.
        expect(variants.map((v) => v.name)).toEqual(['Source', 'Default']);
    });

    it('a v2 grid without profiles stays a static grid', () => {
        const result = migrateSettings(v2Data(v2Grid(base)));
        const category = result.settings.categories[0]!;
        expect(category.variants).toBeUndefined();
        expect(category.buttons.map((b) => [b.id, b.slot])).toEqual([
            ['b1', 0],
            ['b3', 2],
        ]);
    });

    it('leaves v2 flow categories completely untouched', () => {
        const flow = {
            id: 'flow',
            name: 'Flow',
            order: 1,
            buttons: [{ id: 'f', name: 'F', actions: [], order: 0, conditions: MD }],
        };
        const result = migrateSettings(v2Data(v2Grid(base, [sourceProfile]), [flow]));
        const migratedFlow = result.settings.categories[1]!;
        expect(migratedFlow.variants).toBeUndefined();
        expect(migratedFlow.buttons[0]!.conditions).toEqual(MD);
    });

    it('profile order becomes variant priority', () => {
        const result = migrateSettings(
            v2Data(v2Grid(base, [topicProfile, sourceProfile]))
        );
        const variants = result.settings.categories[0]!.variants!;
        expect(variants.map((v) => v.name)).toEqual(['Topic', 'Source', 'Default']);
    });

    it('is deterministic and idempotent over its own output', () => {
        const data = v2Data(v2Grid(base, [sourceProfile, topicProfile]));
        const once = migrateSettings(data).settings;
        const again = migrateSettings(JSON.parse(JSON.stringify(data))).settings;
        expect(again).toEqual(once);

        const reloaded = migrateSettings(JSON.parse(JSON.stringify(once)));
        expect(reloaded.status).toBe('current');
        expect(reloaded.changed).toBe(false);
        expect(JSON.parse(JSON.stringify(reloaded.settings))).toEqual(
            JSON.parse(JSON.stringify(once))
        );
    });

    it('does not rewrite data that is already at the current version', () => {
        const stored = {
            settingsVersion: CURRENT_SETTINGS_VERSION,
            categories: [
                {
                    id: 'dyn',
                    name: 'Dyn',
                    order: 0,
                    layout: 'grid',
                    buttons: [],
                    variants: [
                        {
                            id: 'v1',
                            name: 'Source',
                            trigger: TYPE_A,
                            buttons: [{ id: 'a', name: 'A', actions: [], order: 0, slot: 0 }],
                        },
                    ],
                },
            ],
            panelConfig: {},
            pathConfig: {},
        };
        const result = migrateSettings(stored);
        expect(result.status).toBe('current');
        expect(result.changed).toBe(false);
        expect(result.settings.categories[0]!.variants).toHaveLength(1);
    });

    it('handles malformed v2 data without throwing or losing the category', () => {
        const malformed = v2Data({
            id: 'weird',
            name: 'Weird',
            order: 0,
            layout: 'grid',
            buttons: 'not-an-array',
            contextProfiles: { not: 'an array' },
        });
        const result = migrateSettings(malformed);
        const category = result.settings.categories[0]!;
        expect(category.id).toBe('weird');
        expect(category.variants).toBeUndefined();
        expect((category as unknown as Record<string, unknown>)['contextProfiles']).toBe(
            undefined
        );
    });
});

describe('version 4 – sort mode merges into edit mode', () => {
    /** A v3 document that differs only in its stored interaction mode. */
    const v3Data = (interactionMode: unknown) => ({
        settingsVersion: 3,
        categories: [
            { id: 'c', name: 'C', order: 0, buttons: [{ id: 'b', name: 'B', actions: [], order: 0 }] },
        ],
        panelConfig: { interactionMode, displayStyle: 'icon_left' },
        pathConfig: {},
    });

    it('turns a stored sort mode into edit mode', () => {
        const result = migrateSettings(v3Data('sort'));
        expect(result.status).toBe('migrated');
        expect(result.settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
        // Sort was a MANAGEMENT mode: locking the panel instead would silently
        // take drag and drop away from the user.
        expect(result.settings.panelConfig.interactionMode).toBe('edit');
    });

    it('leaves locked and edit exactly as they were', () => {
        expect(migrateSettings(v3Data('locked')).settings.panelConfig.interactionMode).toBe(
            'locked'
        );
        expect(migrateSettings(v3Data('edit')).settings.panelConfig.interactionMode).toBe(
            'edit'
        );
    });

    it('falls back to the default for an absent or unknown mode', () => {
        expect(migrateSettings(v3Data(undefined)).settings.panelConfig.interactionMode).toBe(
            DEFAULT_SETTINGS.panelConfig.interactionMode
        );
        expect(migrateSettings(v3Data('nonsense')).settings.panelConfig.interactionMode).toBe(
            DEFAULT_SETTINGS.panelConfig.interactionMode
        );
    });

    it('changes nothing else in the document', () => {
        const stored = v3Data('sort');
        const result = migrateSettings(stored);
        expect(result.settings.categories).toEqual(stored.categories);
        expect(result.settings.panelConfig.displayStyle).toBe('icon_left');
    });

    it('normalizes a retired mode in data it must not rewrite', () => {
        // Already-current and future documents are never migrated, but the
        // panel still has to render: the coercion happens in memory.
        const current = migrateSettings({
            ...v3Data('sort'),
            settingsVersion: CURRENT_SETTINGS_VERSION,
        });
        expect(current.status).toBe('current');
        expect(current.changed).toBe(false);
        expect(current.settings.panelConfig.interactionMode).toBe('edit');

        const future = migrateSettings({
            ...v3Data('sort'),
            settingsVersion: CURRENT_SETTINGS_VERSION + 5,
        });
        expect(future.status).toBe('future');
        expect(future.settings.settingsVersion).toBe(CURRENT_SETTINGS_VERSION + 5);
        expect(future.settings.panelConfig.interactionMode).toBe('edit');
    });

    it('is idempotent over its own output', () => {
        const once = migrateSettings(v3Data('sort')).settings;
        const twice = migrateSettings(JSON.parse(JSON.stringify(once)));
        expect(twice.status ?? 'current').toBeDefined();
        expect(JSON.parse(JSON.stringify(twice.settings))).toEqual(
            JSON.parse(JSON.stringify(once))
        );
    });
});
