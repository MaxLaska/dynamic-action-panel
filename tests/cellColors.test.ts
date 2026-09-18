// tests/cellColors.test.ts
// Cell colors: the one write operation, the stored-value -> CSS resolver, and
// the render path that finally carries `cellStyles` to a cell.
//
// The colour belongs to the CELL, not to the tool on it, and `cellStyles` stays
// the only persistence for it — no new field, no settings version, no template
// format change. Several tests exist purely to keep it that way.

import { describe, expect, it, vi } from 'vitest';
import type { GridCellStyles, StoredCategory } from '@/types/settings';
import {
    applySlotIdsToStoredCategory,
    setCellColorsInState,
} from '@/domain/categoryOps';
import { materializeCategory } from '@/domain/tools';
import {
    resolveGridViewForVariant,
    resolveGridViewForContext,
} from '@/utils/categoryVariants';
import {
    CELL_COLOR_PALETTE,
    isRenderableCellColor,
    resolveGridCellColorCss,
    resolveGridCellSwatchCss,
} from '@/utils/gridCellColor';
import { EMPTY_WORKSPACE_CONTEXT } from '@/context/workspaceContext';
import {
    p,
    registryOf,
    stateOf,
    storedDynamic,
    storedFlow,
    storedGrid,
    storedVariant,
    tool,
} from './helpers/stored';

const registry = registryOf(tool('a'), tool('b'));

const gridOf = (extra: Partial<StoredCategory> = {}) =>
    storedGrid([p('a', 0), p('b', 3)], { rows: 2, columns: 2, ...extra });

const stylesOf = (category: StoredCategory | undefined) => category?.cellStyles;

describe('setCellColorsInState — one operation, one commit', () => {
    it('colours a single cell', () => {
        const state = stateOf(registry, gridOf());
        const next = setCellColorsInState(state, 'cat', null, ['r0c0'], 'ocap:red');
        expect(stylesOf(next.categories[0])).toEqual({ r0c0: { color: 'ocap:red' } });
    });

    it('colours many cells in ONE transformation', () => {
        const state = stateOf(registry, gridOf());
        const next = setCellColorsInState(
            state,
            'cat',
            null,
            ['r0c0', 'r0c1', 'r1c1'],
            'ocap:blue'
        );
        expect(stylesOf(next.categories[0])).toEqual({
            r0c0: { color: 'ocap:blue' },
            r0c1: { color: 'ocap:blue' },
            r1c1: { color: 'ocap:blue' },
        });
    });

    it('colours an EMPTY cell exactly like an occupied one', () => {
        const state = stateOf(registry, gridOf());
        // r0c1 and r1c0 hold no tool at all.
        const next = setCellColorsInState(state, 'cat', null, ['r0c1'], 'ocap:green');
        expect(stylesOf(next.categories[0])).toEqual({ r0c1: { color: 'ocap:green' } });
        // Placements are untouched — a colour is not a tool.
        expect(next.categories[0]?.placements).toEqual(state.categories[0]?.placements);
    });

    it('clears the colour and removes the entry with it', () => {
        const state = stateOf(
            registry,
            gridOf({ cellStyles: { r0c0: { color: 'ocap:red' }, r1c1: { color: 'ocap:red' } } })
        );
        const next = setCellColorsInState(state, 'cat', null, ['r0c0'], null);
        expect(stylesOf(next.categories[0])).toEqual({ r1c1: { color: 'ocap:red' } });
    });

    it('drops the whole field when the last colour is cleared', () => {
        const state = stateOf(registry, gridOf({ cellStyles: { r0c0: { color: 'ocap:red' } } }));
        const next = setCellColorsInState(state, 'cat', null, ['r0c0'], null);
        // Byte-identical to data written before cell colours existed.
        expect('cellStyles' in (next.categories[0] as object)).toBe(false);
    });

    it('overwrites an existing colour', () => {
        const state = stateOf(registry, gridOf({ cellStyles: { r0c0: { color: 'ocap:red' } } }));
        const next = setCellColorsInState(state, 'cat', null, ['r0c0'], 'ocap:green');
        expect(stylesOf(next.categories[0])).toEqual({ r0c0: { color: 'ocap:green' } });
    });

    it('fills an entry the parser left empty', () => {
        const state = stateOf(registry, gridOf({ cellStyles: { r0c0: {} } }));
        const next = setCellColorsInState(state, 'cat', null, ['r0c0'], 'ocap:red');
        expect(stylesOf(next.categories[0])).toEqual({ r0c0: { color: 'ocap:red' } });
    });

    it('is a no-op that keeps state IDENTITY when the colour is already there', () => {
        const state = stateOf(registry, gridOf({ cellStyles: { r0c0: { color: 'ocap:red' } } }));
        expect(setCellColorsInState(state, 'cat', null, ['r0c0'], 'ocap:red')).toBe(state);
    });

    it('is a no-op when clearing an already uncoloured cell', () => {
        const state = stateOf(registry, gridOf());
        expect(setCellColorsInState(state, 'cat', null, ['r0c0'], null)).toBe(state);
    });

    it('is a no-op for an empty cell list', () => {
        const state = stateOf(registry, gridOf());
        expect(setCellColorsInState(state, 'cat', null, [], 'ocap:red')).toBe(state);
    });

    it('never mutates the state it was given', () => {
        const state = stateOf(registry, gridOf());
        const before = structuredClone(state);
        setCellColorsInState(state, 'cat', null, ['r0c0'], 'ocap:red');
        expect(state).toEqual(before);
    });

    it('keeps the tool registry by identity and collects nothing', () => {
        const state = stateOf(registry, gridOf());
        const next = setCellColorsInState(state, 'cat', null, ['r0c0'], 'ocap:red');
        expect(next.tools).toBe(state.tools);
        expect(Object.keys(next.tools).sort()).toEqual(['a', 'b']);
    });
});

describe('setCellColorsInState — what it refuses', () => {
    it('rejects a value that is not a portable colour', () => {
        const state = stateOf(registry, gridOf());
        for (const bad of ['var(--interactive-accent)', 'rgb(1,2,3)', 'red', '#12345', '']) {
            expect(setCellColorsInState(state, 'cat', null, ['r0c0'], bad)).toBe(state);
        }
    });

    it('ignores cells outside the grid, exactly like a resize does', () => {
        const state = stateOf(registry, gridOf());
        // The grid is 2x2; r4c4 does not exist.
        expect(setCellColorsInState(state, 'cat', null, ['r4c4'], 'ocap:red')).toBe(state);
        const mixed = setCellColorsInState(state, 'cat', null, ['r0c0', 'r4c4'], 'ocap:red');
        expect(stylesOf(mixed.categories[0])).toEqual({ r0c0: { color: 'ocap:red' } });
    });

    it('refuses an unknown category', () => {
        const state = stateOf(registry, gridOf());
        expect(setCellColorsInState(state, 'nope', null, ['r0c0'], 'ocap:red')).toBe(state);
    });

    it('refuses a flow category, which has no cells', () => {
        const state = stateOf(registry, storedFlow([p('a')]));
        expect(setCellColorsInState(state, 'cat', null, ['r0c0'], 'ocap:red')).toBe(state);
    });
});

describe('setCellColorsInState — the strict grid key (I-KEY)', () => {
    const dynamic = () =>
        storedDynamic([
            storedVariant('v1', { all: [] }, [p('a', 0)], false, { rows: 2, columns: 2 }),
            storedVariant('v2', undefined, [p('b', 0)], true, { rows: 2, columns: 2 }),
        ]);

    it('colours exactly the addressed variant', () => {
        const state = stateOf(registry, dynamic());
        const next = setCellColorsInState(state, 'cat', 'v1', ['r0c0'], 'ocap:red');
        const variants = next.categories[0]?.variants ?? [];
        expect(variants[0]?.cellStyles).toEqual({ r0c0: { color: 'ocap:red' } });
        // The other variant is untouched, by identity.
        expect(variants[1]).toBe(state.categories[0]?.variants?.[1]);
    });

    it('refuses a null variant on a DYNAMIC category instead of guessing the first', () => {
        // resolveGridVariantId would read this as "the first variant"; for a
        // selection a null id means "the static grid", so it must colour
        // nothing rather than the wrong grid.
        const state = stateOf(registry, dynamic());
        expect(setCellColorsInState(state, 'cat', null, ['r0c0'], 'ocap:red')).toBe(state);
    });

    it('refuses a variant id on a STATIC grid', () => {
        const state = stateOf(registry, gridOf());
        expect(setCellColorsInState(state, 'cat', 'v1', ['r0c0'], 'ocap:red')).toBe(state);
    });

    it('refuses a variant that does not exist', () => {
        const state = stateOf(registry, dynamic());
        expect(setCellColorsInState(state, 'cat', 'ghost', ['r0c0'], 'ocap:red')).toBe(state);
    });

    it('refuses a dynamic category with no variants at all', () => {
        const state = stateOf(registry, storedDynamic([]));
        expect(setCellColorsInState(state, 'cat', null, ['r0c0'], 'ocap:red')).toBe(state);
        expect(setCellColorsInState(state, 'cat', 'v1', ['r0c0'], 'ocap:red')).toBe(state);
    });

    it('leaves other categories identical', () => {
        const other: StoredCategory = { ...gridOf(), id: 'other' };
        const state = stateOf(registry, gridOf(), other);
        const next = setCellColorsInState(state, 'cat', null, ['r0c0'], 'ocap:red');
        expect(next.categories[1]).toBe(other);
    });
});

describe('a colour belongs to the coordinate, not to the tool', () => {
    it('stays put when a real drag write-back moves the tool away', () => {
        // The guarantee runs through the ACTUAL drag path, not a hand-built
        // object: a move must never carry the colour with the tool.
        const category = storedGrid([p('a', 0)], {
            rows: 2,
            columns: 2,
            cellStyles: { r0c0: { color: 'ocap:red' }, r1c1: { color: 'ocap:blue' } },
        });
        // Tool `a` moves from slot 0 (r0c0) to slot 3 (r1c1).
        const moved = applySlotIdsToStoredCategory(
            category,
            [null, null, null, 'a'],
            registry,
            null
        );
        expect(moved.placements).toEqual([{ toolId: 'a', slot: 3 }]);
        // Both colours are exactly where they were: the red cell is now empty
        // and still red, the blue cell now holds the tool and is still blue.
        expect(moved.cellStyles).toEqual({
            r0c0: { color: 'ocap:red' },
            r1c1: { color: 'ocap:blue' },
        });
    });

    it('stays put when a drag write-back moves a tool inside a VARIANT', () => {
        const category = storedDynamic([
            storedVariant('v1', { all: [] }, [p('a', 0)], false, {
                rows: 2,
                columns: 2,
                cellStyles: { r0c0: { color: 'ocap:red' } },
            }),
        ]);
        const moved = applySlotIdsToStoredCategory(
            category,
            [null, null, null, 'a'],
            registry,
            'v1'
        );
        expect(moved.variants?.[0]?.placements).toEqual([{ toolId: 'a', slot: 3 }]);
        expect(moved.variants?.[0]?.cellStyles).toEqual({ r0c0: { color: 'ocap:red' } });
    });
});

describe('the colour resolver', () => {
    it('resolves every palette colour Obsidian has a variable for', () => {
        for (const name of ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink']) {
            expect(resolveGridCellColorCss(`ocap:${name}`)).toBe(
                `rgba(var(--color-${name}-rgb), var(--ocap-cell-color-alpha))`
            );
        }
    });

    it('resolves gray through the mono variable, not a hardcoded grey', () => {
        // Obsidian ships no --color-gray-rgb; a fixed hex would be wrong in one
        // of the two themes.
        expect(resolveGridCellColorCss('ocap:gray')).toBe(
            'rgba(var(--mono-rgb-100), var(--ocap-cell-color-alpha))'
        );
    });

    it('renders colours the palette does NOT offer, so an import cannot look lost', () => {
        for (const value of ['ocap:orange', 'ocap:cyan', 'ocap:pink']) {
            expect(resolveGridCellColorCss(value)).not.toBeNull();
            expect(isRenderableCellColor(value)).toBe(true);
        }
    });

    it('renders hex literals, which no v1 UI can produce but an import can carry', () => {
        expect(resolveGridCellColorCss('#ff8800')).toBe(
            'rgba(255, 136, 0, var(--ocap-cell-color-alpha))'
        );
        expect(resolveGridCellColorCss('#f80')).toBe(
            'rgba(255, 136, 0, var(--ocap-cell-color-alpha))'
        );
    });

    it('honours a hex literal that carries its own alpha', () => {
        expect(resolveGridCellColorCss('#33669980')).toBe('rgba(51, 102, 153, 0.502)');
        expect(resolveGridCellColorCss('#3698')).toBe('rgba(51, 102, 153, 0.533)');
    });

    it('draws nothing for an unknown palette name, and says so', () => {
        expect(resolveGridCellColorCss('ocap:chartreuse')).toBeNull();
        expect(isRenderableCellColor('ocap:chartreuse')).toBe(false);
    });

    it('draws nothing for values that were never portable', () => {
        for (const bad of ['var(--interactive-accent)', 'rgb(1,2,3)', 'red', '#12345', '']) {
            expect(resolveGridCellColorCss(bad)).toBeNull();
        }
        expect(resolveGridCellColorCss(undefined)).toBeNull();
        expect(resolveGridCellColorCss(null)).toBeNull();
    });

    it('fills a swatch at full strength, so the legend stays readable', () => {
        expect(resolveGridCellSwatchCss('ocap:red')).toBe('rgb(var(--color-red-rgb))');
        expect(resolveGridCellSwatchCss('ocap:gray')).toBe('rgb(var(--mono-rgb-100))');
        expect(resolveGridCellSwatchCss('#ff8800')).toBe('rgb(255, 136, 0)');
        expect(resolveGridCellSwatchCss(null)).toBeNull();
    });
});

describe('the v1 palette', () => {
    it('offers the six decided colours plus clear, in that order', () => {
        expect(CELL_COLOR_PALETTE.map((entry) => entry.value)).toEqual([
            'ocap:yellow',
            'ocap:red',
            'ocap:green',
            'ocap:blue',
            'ocap:purple',
            'ocap:gray',
            null,
        ]);
    });

    it('offers only values the resolver can draw', () => {
        for (const entry of CELL_COLOR_PALETTE) {
            if (entry.value !== null) {
                expect(resolveGridCellColorCss(entry.value)).not.toBeNull();
            }
        }
    });

    it('offers no free colour picker in v1', () => {
        expect(CELL_COLOR_PALETTE.filter((entry) => entry.value === null)).toHaveLength(1);
        expect(CELL_COLOR_PALETTE).toHaveLength(7);
    });
});

describe('the render path finally carries cellStyles', () => {
    it('hands the STATIC grid its own styles', () => {
        const styles: GridCellStyles = { r0c0: { color: 'ocap:red' } };
        const view = resolveGridViewForVariant(
            materializeCategory(gridOf({ cellStyles: styles }), registry),
            null
        );
        expect(view.cellStyles).toEqual(styles);
    });

    it('hands a variant ITS OWN styles, never the category’s or a sibling’s', () => {
        const category = storedDynamic([
            storedVariant('v1', { all: [] }, [p('a', 0)], false, {
                rows: 2,
                columns: 2,
                cellStyles: { r0c0: { color: 'ocap:red' } },
            }),
            storedVariant('v2', undefined, [p('b', 0)], true, {
                rows: 2,
                columns: 2,
                cellStyles: { r1c1: { color: 'ocap:blue' } },
            }),
        ]);
        const view = materializeCategory(category, registry);
        expect(resolveGridViewForVariant(view, 'v1').cellStyles).toEqual({
            r0c0: { color: 'ocap:red' },
        });
        expect(resolveGridViewForVariant(view, 'v2').cellStyles).toEqual({
            r1c1: { color: 'ocap:blue' },
        });
    });

    it('carries the styles in locked mode too — a colour is content', () => {
        const styles: GridCellStyles = { r0c0: { color: 'ocap:green' } };
        const view = resolveGridViewForContext(
            materializeCategory(gridOf({ cellStyles: styles }), registry),
            EMPTY_WORKSPACE_CONTEXT
        );
        expect(view.cellStyles).toEqual(styles);
    });

    it('writes no field at all for a grid without colours', () => {
        const view = resolveGridViewForVariant(materializeCategory(gridOf(), registry), null);
        expect('cellStyles' in view).toBe(false);
    });

    it('passes the styles through without copying or mutating them', () => {
        const styles: GridCellStyles = { r0c0: { color: 'ocap:red' } };
        const category = materializeCategory(gridOf({ cellStyles: styles }), registry);
        const view = resolveGridViewForVariant(category, null);
        // Same object: the view is a read-only projection, so a copy would only
        // cost memory — which is exactly why nothing may write to it.
        expect(view.cellStyles).toBe(category.cellStyles);
        expect(category.cellStyles).toEqual(styles);
    });
});

describe('a read-only configuration cannot be coloured', () => {
    it('refuses the commit and reports that nothing was written', async () => {
        const { commitToolState } = await import('@/utils/categoryStore');
        const { noteLoadedSettings } = await import('@/utils/settingsWriteGuard');

        const saveData = vi.fn();
        const plugin = {
            settings: { tools: registry, categories: [gridOf()] },
            saveData,
            saveSettings: vi.fn(),
        } as unknown as Parameters<typeof commitToolState>[0];

        // A configuration this build cannot interpret.
        noteLoadedSettings(plugin, { status: 'future', fromVersion: 999 } as never);

        const state = { tools: registry, categories: [gridOf()] };
        const coloured = setCellColorsInState(state, 'cat', null, ['r0c0'], 'ocap:red');
        // The pure operation itself always works — it is only a value.
        expect(coloured).not.toBe(state);

        const committed = await commitToolState(plugin, coloured);
        expect(committed).toBe(false);
        expect(saveData).not.toHaveBeenCalled();
        // And the in-memory settings were not touched either, so the panel
        // never shows an edit the file does not have.
        expect((plugin as unknown as { settings: { categories: StoredCategory[] } }).settings
            .categories[0]?.cellStyles).toBeUndefined();
    });
});
