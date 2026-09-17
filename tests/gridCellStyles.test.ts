// tests/gridCellStyles.test.ts
// The data-model foundation for future cell colors.
//
// There is deliberately NO color UI yet (no picker, no paint mode, no visible
// tinting). What has to be right today is the SHAPE and the SEMANTICS, because
// those are what every later feature and every exported template would
// otherwise have to be rebuilt around:
// - the color belongs to the CELL, so an empty cell can carry one;
// - the key is a logical row/column, so a resize cannot silently move a color
//   to a different cell the way a flat slot index would;
// - a variant is a complete grid state, so its cell styles are variant-local;
// - copies are independent, and "make dynamic" carries the grid state along.
//
// The fixtures are synthetic on purpose — they prove the plumbing before the
// UI that will produce real data exists.

import { describe, it, expect } from 'vitest';
import {
    cloneGridCellStyles,
    gridCellKey,
    gridCellKeyOfSlot,
    isCellKeyInsideGrid,
    isGridCellColor,
    parseGridCellKey,
    resizeGridCellStyles,
} from '@/utils/categoryGrid';
import {
    convertStoredStaticGridToDynamic,
    duplicateCategoryInState,
    duplicateVariantInState,
    planStoredGridResize,
    commitStoredGridResize,
    applyStoredCategoryLayout,
} from '@/domain/categoryOps';
import { materializeCategory } from '@/domain/tools';
import type { GridCellStyles } from '@/types/settings';
import {
    p,
    registryOf,
    stateOf,
    storedDynamic,
    storedGrid,
    storedVariant,
    tool,
} from './helpers/stored';

const styles = (entries: Record<string, string>): GridCellStyles => {
    const result: GridCellStyles = {};
    for (const [key, color] of Object.entries(entries)) {
        result[key] = { color };
    }
    return result;
};

describe('cell keys', () => {
    it('names a cell by its logical row and column', () => {
        expect(gridCellKey(2, 3)).toBe('r2c3');
        expect(parseGridCellKey('r2c3')).toEqual({ row: 2, column: 3 });
    });

    it('rejects anything that is not a cell key', () => {
        for (const key of ['', 'r2', '2c3', 'rxc1', '__proto__', 'r-1c0', 'r2c3 ']) {
            expect(parseGridCellKey(key)).toBeNull();
        }
    });

    it('derives the same cell from different flat indices of different grids', () => {
        // Row 1 / column 2 is slot 5 in a 3-column grid and slot 6 in a 4-column
        // one — the exact reason the flat index cannot be the identity.
        expect(gridCellKeyOfSlot(5, 3)).toBe('r1c2');
        expect(gridCellKeyOfSlot(6, 4)).toBe('r1c2');
    });

    it('knows which cells a grid has', () => {
        expect(isCellKeyInsideGrid('r1c2', { rows: 2, columns: 3 })).toBe(true);
        expect(isCellKeyInsideGrid('r2c0', { rows: 2, columns: 3 })).toBe(false);
        expect(isCellKeyInsideGrid('r0c3', { rows: 2, columns: 3 })).toBe(false);
    });
});

describe('portable color values', () => {
    it('accepts hex literals and palette names', () => {
        for (const value of [
            '#abc',
            '#abcd',
            '#a1b2c3',
            '#a1b2c3ff',
            'ocap:accent',
            'ocap:sky-2',
        ]) {
            expect(isGridCellColor(value)).toBe(true);
        }
    });

    it('rejects values that only exist inside the current UI', () => {
        for (const value of [
            'var(--interactive-accent)',
            'rgb(1,2,3)',
            'is-active',
            'accent',
            '#12345',
            '',
            42,
            null,
        ]) {
            expect(isGridCellColor(value)).toBe(false);
        }
    });
});

describe('cloneGridCellStyles', () => {
    it('produces an independent copy', () => {
        const source = styles({ r0c0: 'ocap:red' });
        const copy = cloneGridCellStyles(source);
        copy!['r0c0']!.color = 'ocap:blue';
        expect(source['r0c0']?.color).toBe('ocap:red');
    });

    it('treats an absent or empty map as "no styles"', () => {
        expect(cloneGridCellStyles(undefined)).toBeUndefined();
        expect(cloneGridCellStyles({})).toBeUndefined();
    });
});

describe('resizeGridCellStyles', () => {
    it('keeps every cell when the grid GROWS (test 22)', () => {
        const source = styles({ r0c0: 'ocap:red', r1c2: 'ocap:blue' });
        // Row 1 / column 2 is the same logical cell in 2x3 and in 2x4 — adding a
        // column must not move the color, which is exactly what a flat slot
        // index would have done (5 -> 6).
        expect(resizeGridCellStyles(source, { rows: 2, columns: 4 })).toEqual(source);
        expect(resizeGridCellStyles(source, { rows: 5, columns: 5 })).toEqual(source);
    });

    it('drops exactly the cut strip when the grid SHRINKS', () => {
        const source = styles({ r0c0: 'ocap:red', r0c2: 'ocap:green', r1c1: 'ocap:blue' });
        expect(resizeGridCellStyles(source, { rows: 2, columns: 2 })).toEqual(
            styles({ r0c0: 'ocap:red', r1c1: 'ocap:blue' })
        );
        expect(resizeGridCellStyles(source, { rows: 1, columns: 3 })).toEqual(
            styles({ r0c0: 'ocap:red', r0c2: 'ocap:green' })
        );
    });

    it('writes no field at all when nothing survives', () => {
        expect(
            resizeGridCellStyles(styles({ r4c4: 'ocap:red' }), { rows: 1, columns: 1 })
        ).toBeUndefined();
        expect(resizeGridCellStyles(undefined, { rows: 2, columns: 2 })).toBeUndefined();
    });
});

describe('grid resize keeps cell styles coordinate-stable (test 22)', () => {
    it('carries the styles through a static grid resize', () => {
        const state = stateOf(
            registryOf(tool('t1')),
            storedGrid([p('t1', 5)], {
                rows: 2,
                columns: 3,
                cellStyles: styles({ r1c2: 'ocap:blue' }),
            })
        );
        const plan = planStoredGridResize(
            state.categories[0]!,
            null,
            { rows: 2, columns: 4 },
            state.tools
        );
        const next = commitStoredGridResize(state, plan!).categories[0]!;
        // The tool moves from flat 5 to flat 6; the color stays on r1c2.
        expect(next.placements[0]).toEqual({ toolId: 't1', slot: 6 });
        expect(next.cellStyles).toEqual(styles({ r1c2: 'ocap:blue' }));
    });

    it('cuts the styles of a removed strip', () => {
        const state = stateOf(
            registryOf(tool('t1')),
            storedGrid([p('t1', 0)], {
                rows: 2,
                columns: 3,
                cellStyles: styles({ r0c0: 'ocap:red', r0c2: 'ocap:green', r1c0: 'ocap:blue' }),
            })
        );
        const plan = planStoredGridResize(
            state.categories[0]!,
            null,
            { rows: 1, columns: 2 },
            state.tools
        );
        expect(commitStoredGridResize(state, plan!).categories[0]!.cellStyles).toEqual(
            styles({ r0c0: 'ocap:red' })
        );
    });

    it('resizes only the addressed variant', () => {
        const state = stateOf(
            registryOf(tool('a'), tool('b')),
            storedDynamic([
                storedVariant('v1', undefined, [p('a', 0)], true, {
                    rows: 2,
                    columns: 3,
                    cellStyles: styles({ r1c2: 'ocap:blue' }),
                }),
                storedVariant('v2', { rule: 'extension', value: 'md' }, [p('b', 0)], false, {
                    rows: 2,
                    columns: 3,
                    cellStyles: styles({ r1c2: 'ocap:green' }),
                }),
            ])
        );
        const plan = planStoredGridResize(
            state.categories[0]!,
            'v1',
            { rows: 1, columns: 3 },
            state.tools
        );
        const next = commitStoredGridResize(state, plan!).categories[0]!;
        expect(next.variants![0]!.cellStyles).toBeUndefined();
        expect(next.variants![1]!.cellStyles).toEqual(styles({ r1c2: 'ocap:green' }));
    });
});

describe('cell styles are variant-local (test 20)', () => {
    it('never leaks between the variants of one category', () => {
        const category = storedDynamic([
            storedVariant('v1', undefined, [], true, {
                rows: 3,
                columns: 4,
                cellStyles: styles({ r0c0: 'ocap:red' }),
            }),
            storedVariant('v2', { rule: 'extension', value: 'pdf' }, [], false, {
                rows: 2,
                columns: 5,
                cellStyles: styles({ r1c4: 'ocap:blue' }),
            }),
        ]);
        expect(category.variants![0]!.cellStyles).toEqual(styles({ r0c0: 'ocap:red' }));
        expect(category.variants![1]!.cellStyles).toEqual(styles({ r1c4: 'ocap:blue' }));
        // The category itself carries none — a dynamic category has no grid.
        expect(category.cellStyles).toBeUndefined();
    });

    it('materializes into the runtime view', () => {
        const view = materializeCategory(
            storedGrid([], { rows: 2, columns: 2, cellStyles: styles({ r0c1: 'ocap:red' }) }),
            {}
        );
        expect(view.cellStyles).toEqual(styles({ r0c1: 'ocap:red' }));
    });
});

describe('copies keep cell styles as INDEPENDENT data (test 21)', () => {
    it('duplicate variant copies them and then decouples', () => {
        const state = stateOf(
            registryOf(tool('a')),
            storedDynamic([
                storedVariant('v1', undefined, [p('a', 1)], true, {
                    rows: 2,
                    columns: 3,
                    cellStyles: styles({ r0c1: 'ocap:red' }),
                }),
            ])
        );
        const next = duplicateVariantInState(state, 'cat', 'v1', { id: 'v2', name: 'Copy' }, (i) => `copy-${i}`);
        const [source, copy] = next.categories[0]!.variants!;
        expect(copy!.cellStyles).toEqual(styles({ r0c1: 'ocap:red' }));
        expect(copy!.cellStyles).not.toBe(source!.cellStyles);
        expect(copy!.cellStyles!['r0c1']).not.toBe(source!.cellStyles!['r0c1']);
    });

    it('copy category copies them for the category and every variant', () => {
        const state = stateOf(
            registryOf(tool('a')),
            storedDynamic([
                storedVariant('v1', undefined, [p('a', 0)], true, {
                    cellStyles: styles({ r0c0: 'ocap:red' }),
                }),
            ])
        );
        let counter = 0;
        const result = duplicateCategoryInState(state, 'cat', 1, () => `new-${counter++}`);
        const copy = result!.category;
        expect(copy.variants![0]!.cellStyles).toEqual(styles({ r0c0: 'ocap:red' }));
        expect(copy.variants![0]!.cellStyles).not.toBe(
            state.categories[0]!.variants![0]!.cellStyles
        );
    });

    it('copy of a STATIC grid copies the category-level styles', () => {
        const state = stateOf(
            registryOf(tool('a')),
            storedGrid([p('a', 0)], { rows: 2, columns: 2, cellStyles: styles({ r1c1: 'ocap:blue' }) })
        );
        let counter = 0;
        const copy = duplicateCategoryInState(state, 'cat', 1, () => `new-${counter++}`)!
            .category;
        expect(copy.cellStyles).toEqual(styles({ r1c1: 'ocap:blue' }));
        expect(copy.cellStyles).not.toBe(state.categories[0]!.cellStyles);
    });
});

describe('make dynamic keeps the grid state whole (test 23)', () => {
    it('moves the cell styles onto the first variant', () => {
        const category = storedGrid([p('a', 0)], {
            rows: 2,
            columns: 3,
            cellStyles: styles({ r1c2: 'ocap:blue' }),
        });
        const dynamic = convertStoredStaticGridToDynamic(category, {
            id: 'v1',
            name: 'Default',
            fallback: true,
        });
        expect(dynamic.variants![0]!.cellStyles).toEqual(styles({ r1c2: 'ocap:blue' }));
        expect(dynamic.variants![0]!.rows).toBe(2);
        expect(dynamic.variants![0]!.columns).toBe(3);
        // The category no longer owns a grid, so it owns neither size nor cells.
        expect(dynamic.cellStyles).toBeUndefined();
        expect(dynamic.rows).toBeUndefined();
    });
});

describe('grid -> flow drops the grid it no longer has', () => {
    it('removes the cell styles with the dimensions', () => {
        const state = stateOf(
            registryOf(tool('a')),
            storedGrid([p('a', 0)], { rows: 2, columns: 2, cellStyles: styles({ r0c0: 'ocap:red' }) })
        );
        const result = applyStoredCategoryLayout(state, 'cat', 'flow');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const next = result.state.categories[0]!;
        expect(next.cellStyles).toBeUndefined();
        expect(next.rows).toBeUndefined();
    });
});
