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

// The palette grid adds CategoryConfig.layout and ButtonConfig.slot. Both are
// optional and additive: an absent layout means the historical flow behavior
// and an absent slot is only consulted inside a grid category, so no stored
// data needs transforming and the schema version stays where it is.
describe('palette grid fields need no migration', () => {
    it('does not bump the settings version', () => {
        expect(CURRENT_SETTINGS_VERSION).toBe(1);
    });

    it('loads legacy categories without layout/slot unchanged', () => {
        const result = migrateSettings(makeLegacyData());
        const category = result.settings.categories[0]!;

        expect(category.layout).toBeUndefined();
        expect(category.buttons[0]!.slot).toBeUndefined();
        // Buttons are handed through untouched, order included.
        expect(category.buttons.map((b) => b.order)).toEqual(
            [...category.buttons].map((_, i) => i)
        );
    });

    it('preserves layout and slot on version-1 data without rewriting it', () => {
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

        expect(result.status).toBe('current');
        expect(result.changed).toBe(false);
        expect(result.settings.categories[0]!.layout).toBe('grid');
        expect(result.settings.categories[0]!.buttons.map((b) => b.slot)).toEqual([0, 7]);
    });

    it('keeps grid data loadable for a build that predates the palette', () => {
        // A pre-palette build ignores the unknown fields and reads the same
        // version-1 shape; nothing about the document forces an upgrade.
        const stored = {
            settingsVersion: 1,
            categories: [
                {
                    id: 'palette',
                    name: 'Palette',
                    order: 0,
                    layout: 'grid',
                    buttons: [{ id: 'a', name: 'A', actions: [], order: 0, slot: 3 }],
                },
            ],
            panelConfig: {},
            pathConfig: {},
        };
        const result = migrateSettings(stored);
        expect(result.settings.settingsVersion).toBe(1);
        expect(result.settings.categories[0]!.buttons[0]!.name).toBe('A');
    });
});
