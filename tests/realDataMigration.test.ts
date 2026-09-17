// The REAL v4 data.json (verbatim copy of the productive vault's file at the
// time of the v5 refactor, tests/fixtures/data-v4-real.json) through the
// migration: this is the exact document the first productive v5 start will
// transform, so every byte of user-visible content is pinned here.
//
// Contents of the fixture: one flow category with a file-action button (icon
// as stored SVG), one dynamic grid category with a sized 2x3 variant (slots 0
// and 3) plus an empty legacy variant without dimension fields, one dynamic
// category with a single empty variant, and one legacy static grid without
// dimension fields.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrateSettings } from '@/settings/settingsMigrations';
import { materializeCategoriesForRuntime } from '@/domain/tools';
import { resolveGridViewForVariant } from '@/utils/categoryVariants';

const FIXTURE_PATH = fileURLToPath(
    new URL('./fixtures/data-v4-real.json', import.meta.url)
);

function loadFixture(): Record<string, unknown> {
    return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
}

describe('real v4 data.json -> v5', () => {
    const raw = loadFixture();
    const result = migrateSettings(loadFixture());
    const settings = result.settings;

    it('migrates exactly once, from version 4 to the current version', () => {
        expect(result.status).toBe('migrated');
        expect(result.changed).toBe(true);
        expect(result.fromVersion).toBe(4);
        expect(settings.settingsVersion).toBe(5);
    });

    it('does not mutate the raw input (the productive file is read-only)', () => {
        const untouched = loadFixture();
        migrateSettings(untouched);
        expect(untouched).toEqual(loadFixture());
    });

    it('registers every button as a tool under its original id, losslessly', () => {
        expect(Object.keys(settings.tools).sort()).toEqual([
            '1789568812369czt939w',
            '1789655673148enofed1',
            '1789655682022v4nlqte',
        ]);
        const myBtn = settings.tools['1789568812369czt939w']!;
        expect(myBtn.name).toBe('MyBtn');
        expect(myBtn.actions).toEqual([
            {
                type: 'file',
                parameters: {
                    filePath:
                        'A2_Bib/Bieker, Westerholt (2021) - Soziale Arbeit studieren/Bieker-Westerholt-2021-Soziale_Arbeit_studieren-Aufl_5.pdf',
                },
            },
        ]);
        // The stored SVG icon survives byte-for-byte.
        const rawIcon = (
            (raw['categories'] as Record<string, unknown>[])[0]![
                'buttons'
            ] as Record<string, unknown>[]
        )[0]!['icon'];
        expect(myBtn.icon).toBe(rawIcon);
        expect(myBtn.executionMode).toBe('sequential');
        expect(myBtn.stopOnError).toBe(true);
        expect(myBtn.delayBetweenActions).toBe(100);
        // No migrated tool joins the future library automatically.
        expect(myBtn.library).toBeUndefined();
    });

    it('keeps all four categories with their kinds and order', () => {
        expect(
            settings.categories.map((c) => [c.id, c.name, c.layout ?? 'flow'])
        ).toEqual([
            ['1789568809468', 'Test', 'flow'],
            ['1789647493370', 'xcvb', 'grid'],
            ['1789647804000', 'bvncvcvbhnm', 'grid'],
            ['1789647873155', 'hhhh', 'grid'],
        ]);
    });

    it('the flow category becomes ordered placements', () => {
        expect(settings.categories[0]!.placements).toEqual([
            { toolId: '1789568812369czt939w' },
        ]);
        expect(settings.categories[0]!.variants).toBeUndefined();
    });

    it('the sized variant keeps 2x3 and its exact slots; the legacy variant stays size-free', () => {
        const dyn = settings.categories[1]!;
        expect(dyn.placements).toEqual([]);
        const variants = dyn.variants!;
        expect(variants).toHaveLength(2);
        expect(variants[0]).toMatchObject({
            id: 'var-mu5i31lo-veah4fk',
            name: 'xcvb',
            trigger: { all: [] },
            rows: 2,
            columns: 3,
            placements: [
                { toolId: '1789655682022v4nlqte', slot: 0 },
                { toolId: '1789655673148enofed1', slot: 3 },
            ],
        });
        expect(variants[1]).toMatchObject({
            id: 'var-mu5i9gpo-3f6gk7s',
            name: 'xcvb copy',
            placements: [],
        });
        expect(variants[1]!.rows).toBeUndefined();
        expect(variants[1]!.columns).toBeUndefined();
    });

    it('the legacy static grid stays dimension-free (4x4 semantics)', () => {
        const legacy = settings.categories[3]!;
        expect(legacy.rows).toBeUndefined();
        expect(legacy.columns).toBeUndefined();
        expect(legacy.placements).toEqual([]);
    });

    it('the panel renders the identical effective content', () => {
        const view = materializeCategoriesForRuntime(settings.categories, settings.tools);
        // Flow: same single button.
        expect(view[0]!.buttons.map((b) => [b.id, b.name])).toEqual([
            ['1789568812369czt939w', 'MyBtn'],
        ]);
        // Dynamic: the sized variant resolves as a 2x3 grid with the tools on
        // slots 0 and 3.
        const grid = resolveGridViewForVariant(view[1]!, 'var-mu5i31lo-veah4fk');
        expect(grid.dimensions).toEqual({ rows: 2, columns: 3 });
        expect(grid.slots[0]?.name).toBe(
            'Cover_Image-Bieker-Westerholt-Soziale_Arbeit_studieren'
        );
        expect(grid.slots[3]?.name).toBe(
            'Bieker-Westerholt-2021-Soziale_Arbeit_studieren-Aufl_5.zf'
        );
        expect(grid.slots[1]).toBeNull();
        // Legacy static grid renders as 4x4.
        expect(resolveGridViewForVariant(view[3]!, null).dimensions).toEqual({
            rows: 4,
            columns: 4,
        });
    });

    it('panelConfig and pathConfig pass through unchanged', () => {
        expect(settings.panelConfig.displayStyle).toBe('icon_left');
        expect(settings.panelConfig.interactionMode).toBe('edit');
        expect(settings.pathConfig.scriptFolderPath).toBe('scripts/');
    });

    it('round-trips: persist -> reload is current, unchanged and equal (no second migration)', () => {
        const persisted = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
        const reloaded = migrateSettings(persisted);
        expect(reloaded.status).toBe('current');
        expect(reloaded.changed).toBe(false);
        expect(JSON.parse(JSON.stringify(reloaded.settings))).toEqual(persisted);
    });
});
