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
// version 1; version 2 turns a grid category into a layered palette.
describe('palette grid fields are carried through', () => {
    it('loads legacy categories without layout/slot unchanged', () => {
        const result = migrateSettings(makeLegacyData());
        const category = result.settings.categories[0]!;

        expect(category.layout).toBeUndefined();
        expect(category.buttons[0]!.slot).toBeUndefined();
        expect(category.contextProfiles).toBeUndefined();
        // Buttons are handed through untouched, order included.
        expect(category.buttons.map((b) => b.order)).toEqual(
            [...category.buttons].map((_, i) => i)
        );
    });

    it('preserves layout and slot of a conditionless grid category', () => {
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
        expect(result.settings.settingsVersion).toBe(2);
        expect(result.settings.categories[0]!.layout).toBe('grid');
        expect(result.settings.categories[0]!.buttons.map((b) => b.slot)).toEqual([0, 7]);
        // Nothing contextual in this palette, so no profile is invented.
        expect(result.settings.categories[0]!.contextProfiles).toBeUndefined();
    });
});

// Version 2: palette context layers. Grid categories stop expressing
// contextuality per button and express it through named context profiles.
describe('version 2 – palette context layers', () => {
    it('is the current settings version', () => {
        expect(CURRENT_SETTINGS_VERSION).toBe(2);
    });

    const MD: unknown = { rule: 'viewType', value: 'markdown' };
    const TYPE_A: unknown = { rule: 'property', op: 'equals', key: 'type', value: 'A' };

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

    it('lifts per-button conditions into one profile per distinct condition', () => {
        const result = migrateSettings(
            gridData([
                { id: 'home', name: 'Home', actions: [], order: 0, slot: 0 },
                { id: 'a1', name: 'A1', actions: [], order: 1, slot: 1, conditions: TYPE_A },
                { id: 'md', name: 'MD', actions: [], order: 2, slot: 2, conditions: MD },
                { id: 'a2', name: 'A2', actions: [], order: 3, slot: 3, conditions: TYPE_A },
            ])
        );

        const category = result.settings.categories[0]!;
        expect(category.buttons.map((b) => b.id)).toEqual(['home']);

        const profiles = category.contextProfiles!;
        expect(profiles).toHaveLength(2);
        // First-appearance order, so the result is deterministic.
        expect(profiles[0]!.conditions).toEqual(TYPE_A);
        expect(profiles[0]!.buttons.map((b) => b.id)).toEqual(['a1', 'a2']);
        expect(profiles[1]!.conditions).toEqual(MD);
        expect(profiles[1]!.buttons.map((b) => b.id)).toEqual(['md']);
    });

    it('keeps every slot exactly where it was', () => {
        const result = migrateSettings(
            gridData([
                { id: 'home', name: 'Home', actions: [], order: 0, slot: 0 },
                { id: 'a1', name: 'A1', actions: [], order: 1, slot: 5, conditions: TYPE_A },
            ])
        );
        const category = result.settings.categories[0]!;
        expect(category.buttons[0]!.slot).toBe(0);
        expect(category.contextProfiles![0]!.buttons[0]!.slot).toBe(5);
    });

    it('materializes missing slots before splitting, so nothing moves', () => {
        const result = migrateSettings(
            gridData([
                { id: 'a', name: 'A', actions: [], order: 0 },
                { id: 'b', name: 'B', actions: [], order: 1, conditions: TYPE_A },
                { id: 'c', name: 'C', actions: [], order: 2 },
            ])
        );
        const category = result.settings.categories[0]!;
        expect(category.buttons.map((b) => [b.id, b.slot])).toEqual([
            ['a', 0],
            ['c', 2],
        ]);
        expect(category.contextProfiles![0]!.buttons[0]!.slot).toBe(1);
    });

    it('drops the now-redundant condition from a lifted button', () => {
        const result = migrateSettings(
            gridData([{ id: 'a', name: 'A', actions: [], order: 0, slot: 0, conditions: MD }])
        );
        const profile = result.settings.categories[0]!.contextProfiles![0]!;
        expect(profile.buttons[0]!.conditions).toBeUndefined();
    });

    it('derives a readable profile name from the rule', () => {
        const result = migrateSettings(
            gridData([
                { id: 'a', name: 'A', actions: [], order: 0, slot: 0, conditions: TYPE_A },
                { id: 'b', name: 'B', actions: [], order: 1, slot: 1, conditions: MD },
                {
                    id: 'c',
                    name: 'C',
                    actions: [],
                    order: 2,
                    slot: 2,
                    conditions: { all: [MD, TYPE_A] },
                },
            ])
        );
        const profiles = result.settings.categories[0]!.contextProfiles!;
        expect(profiles[0]!.name).toBe('type = A');
        expect(profiles[1]!.name).toBe('markdown');
        // Too complex for a one-liner: falls back to a neutral name.
        expect(profiles[2]!.name).toBe('Context 3');
    });

    it('generates deterministic profile ids', () => {
        const data = gridData([
            { id: 'a', name: 'A', actions: [], order: 0, slot: 0, conditions: MD },
        ]);
        expect(migrateSettings(data).settings.categories[0]!.contextProfiles![0]!.id).toBe(
            migrateSettings(data).settings.categories[0]!.contextProfiles![0]!.id
        );
        expect(migrateSettings(data).settings.categories[0]!.contextProfiles![0]!.id).toBe(
            'palette-ctx-1'
        );
    });

    it('keeps a structurally invalid condition on the base button', () => {
        // It failed open in version 1 (the button was always visible), so the
        // base layer is the behavior-preserving home — and the data survives.
        const broken = { rule: 'nonsense' };
        const result = migrateSettings(
            gridData([
                { id: 'a', name: 'A', actions: [], order: 0, slot: 0, conditions: broken },
            ])
        );
        const category = result.settings.categories[0]!;
        expect(category.contextProfiles).toBeUndefined();
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
        expect(category.contextProfiles).toBeUndefined();
        expect(category.buttons[0]!.conditions).toEqual(MD);
        expect(category.buttons.map((b) => b.slot)).toEqual([undefined, undefined]);
    });

    it('handles an empty grid category', () => {
        const category = migrateSettings(gridData([])).settings.categories[0]!;
        expect(category.buttons).toEqual([]);
        expect(category.contextProfiles).toBeUndefined();
    });

    it('migrates unversioned upstream data straight through to version 2', () => {
        const result = migrateSettings(makeLegacyData());
        expect(result.settings.settingsVersion).toBe(2);
        expect(result.status).toBe('migrated');
        expect(result.fromVersion).toBe(0);
    });

    it('does not rewrite data that is already at version 2', () => {
        const stored = {
            settingsVersion: 2,
            categories: [
                {
                    id: 'palette',
                    name: 'Palette',
                    order: 0,
                    layout: 'grid',
                    buttons: [{ id: 'a', name: 'A', actions: [], order: 0, slot: 0 }],
                    contextProfiles: [
                        {
                            id: 'p1',
                            name: 'Type A',
                            conditions: TYPE_A,
                            buttons: [
                                { id: 'b', name: 'B', actions: [], order: 0, slot: 1 },
                            ],
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
        expect(result.settings.categories[0]!.contextProfiles).toHaveLength(1);
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

    it('appends migrated profiles behind profiles that already exist', () => {
        const stored = {
            settingsVersion: 1,
            categories: [
                {
                    id: 'palette',
                    name: 'Palette',
                    order: 0,
                    layout: 'grid',
                    contextProfiles: [
                        { id: 'existing', name: 'Existing', buttons: [] },
                    ],
                    buttons: [
                        { id: 'a', name: 'A', actions: [], order: 0, slot: 0, conditions: MD },
                    ],
                },
            ],
            panelConfig: {},
            pathConfig: {},
        };
        const profiles = migrateSettings(stored).settings.categories[0]!.contextProfiles!;
        expect(profiles.map((p) => p.id)).toEqual(['existing', 'palette-ctx-1']);
    });

    it('loses no button when the palette holds more buttons than slots', () => {
        const buttons = Array.from({ length: 20 }, (_, i) => ({
            id: `b${i}`,
            name: `B${i}`,
            actions: [],
            order: i,
            ...(i % 2 === 0 ? {} : { conditions: MD }),
        }));
        const category = migrateSettings(gridData(buttons)).settings.categories[0]!;
        const migratedIds = [
            ...category.buttons.map((b) => b.id),
            ...(category.contextProfiles ?? []).flatMap((p) => p.buttons.map((b) => b.id)),
        ];
        expect(migratedIds.sort()).toEqual(buttons.map((b) => b.id).sort());
    });
});
