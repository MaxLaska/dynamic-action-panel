// tests/gridCellSelection.test.ts
// The pure core of the grid CELL selection.
//
// The three gestures are a product decision, not an implementation detail
// (docs/ocap/cell-selection-colors.md §4): plain click REPLACES, Shift ADDS,
// Ctrl REMOVES. Shift may never deselect, Ctrl may never select, and nothing
// here may drift into a toggle — which is what most of this file pins.

import { describe, expect, it } from 'vitest';
import type { GridCellStyles } from '@/types/settings';
import { allowsCellSelection, executesToolActions } from '@/utils/interactionMode';
import {
    NO_CELL_SELECTION,
    allGridCellKeys,
    applyCellGesture,
    applyCellSetGesture,
    cellGestureOf,
    cellsWithColor,
    clearSelectionOf,
    createGridInstanceCounter,
    gridCellColorOf,
    gridContextKey,
    hasSelectionModifierFlags,
    holdsSelection,
    pruneToDimensions,
    sameSelectionContext,
    selectedCellsOf,
    selectionColorSummary,
    sortCellKeysRowMajor,
    type GridCellSelectionState,
    type GridSelectionContextKey,
} from '@/utils/gridCellSelection';

const GRID_A: GridSelectionContextKey = { categoryId: 'cat', variantId: null };
const GRID_B: GridSelectionContextKey = { categoryId: 'other', variantId: null };
const VARIANT_A: GridSelectionContextKey = { categoryId: 'cat', variantId: 'v1' };

const cells = (state: GridCellSelectionState) => [...state.cells].sort();

/** Builds a selection by replaying gestures, exactly as the UI would. */
function select(
    context: GridSelectionContextKey,
    ...picks: Array<[string, 'replace' | 'add' | 'remove']>
): GridCellSelectionState {
    return picks.reduce<GridCellSelectionState>(
        (state, [cell, gesture]) => applyCellGesture(state, context, cell, gesture),
        NO_CELL_SELECTION
    );
}

describe('plain click replaces', () => {
    it('selects exactly the clicked cell', () => {
        const state = select(GRID_A, ['r0c0', 'replace']);
        expect(cells(state)).toEqual(['r0c0']);
        expect(state.context).toEqual(GRID_A);
    });

    it('drops everything that was selected before', () => {
        const state = select(
            GRID_A,
            ['r0c0', 'replace'],
            ['r1c1', 'add'],
            ['r2c2', 'replace']
        );
        expect(cells(state)).toEqual(['r2c2']);
    });

    it('keeps an already-selected single cell selected — it is not a toggle', () => {
        const first = select(GRID_A, ['r0c0', 'replace']);
        const second = applyCellGesture(first, GRID_A, 'r0c0', 'replace');
        expect(cells(second)).toEqual(['r0c0']);
        // Nothing changed, so the state object is the same one.
        expect(second).toBe(first);
    });
});

describe('Shift only ever adds', () => {
    it('adds a cell to the existing selection', () => {
        const state = select(GRID_A, ['r0c0', 'replace'], ['r1c1', 'add']);
        expect(cells(state)).toEqual(['r0c0', 'r1c1']);
    });

    it('leaves an already-selected cell selected', () => {
        const before = select(GRID_A, ['r0c0', 'replace'], ['r1c1', 'add']);
        const after = applyCellGesture(before, GRID_A, 'r1c1', 'add');
        expect(cells(after)).toEqual(['r0c0', 'r1c1']);
        expect(after).toBe(before);
    });

    it('starts a selection when nothing is selected yet', () => {
        const state = applyCellGesture(NO_CELL_SELECTION, GRID_A, 'r2c0', 'add');
        expect(cells(state)).toEqual(['r2c0']);
    });
});

describe('Ctrl only ever removes', () => {
    it('removes a selected cell and keeps the rest', () => {
        const state = select(
            GRID_A,
            ['r0c0', 'replace'],
            ['r1c1', 'add'],
            ['r1c1', 'remove']
        );
        expect(cells(state)).toEqual(['r0c0']);
    });

    it('does nothing on a cell that is not selected', () => {
        const before = select(GRID_A, ['r0c0', 'replace']);
        const after = applyCellGesture(before, GRID_A, 'r3c3', 'remove');
        expect(cells(after)).toEqual(['r0c0']);
        expect(after).toBe(before);
    });

    it('never selects — removing from an empty selection stays empty', () => {
        const state = applyCellGesture(NO_CELL_SELECTION, GRID_A, 'r0c0', 'remove');
        expect(state).toBe(NO_CELL_SELECTION);
    });

    it('normalizes the last removal back to "no selection at all"', () => {
        const state = select(GRID_A, ['r0c0', 'replace'], ['r0c0', 'remove']);
        expect(state).toBe(NO_CELL_SELECTION);
        expect(state.context).toBeNull();
    });
});

describe('empty and filled cells are indistinguishable here', () => {
    it('knows nothing about occupancy — any key behaves the same', () => {
        // The core never sees a tool; a cell key is a coordinate, full stop.
        const state = select(GRID_A, ['r0c0', 'replace'], ['r4c4', 'add']);
        expect(cells(state)).toEqual(['r0c0', 'r4c4']);
    });
});

describe('a selection lives in exactly one grid', () => {
    it('a plain click in another grid moves the selection there', () => {
        const before = select(GRID_A, ['r0c0', 'replace'], ['r1c1', 'add']);
        const after = applyCellGesture(before, GRID_B, 'r2c2', 'replace');
        expect(after.context).toEqual(GRID_B);
        expect(cells(after)).toEqual(['r2c2']);
        expect(selectedCellsOf(after, GRID_A).size).toBe(0);
    });

    it('Shift in another grid is inert — it cannot extend across grids', () => {
        const before = select(GRID_A, ['r0c0', 'replace']);
        const after = applyCellGesture(before, GRID_B, 'r2c2', 'add');
        expect(after).toBe(before);
        expect(after.context).toEqual(GRID_A);
    });

    it('Ctrl in another grid is inert too', () => {
        const before = select(GRID_A, ['r0c0', 'replace']);
        const after = applyCellGesture(before, GRID_B, 'r0c0', 'remove');
        expect(after).toBe(before);
    });

    it('treats a variant grid as a different grid from the static one', () => {
        expect(sameSelectionContext(GRID_A, VARIANT_A)).toBe(false);
        const before = select(GRID_A, ['r0c0', 'replace']);
        expect(selectedCellsOf(before, VARIANT_A).size).toBe(0);
        expect(holdsSelection(before, VARIANT_A)).toBe(false);
        expect(holdsSelection(before, GRID_A)).toBe(true);
    });

    it('distinguishes two variants of the same category', () => {
        expect(
            sameSelectionContext(VARIANT_A, { categoryId: 'cat', variantId: 'v2' })
        ).toBe(false);
    });
});

describe('clearSelectionOf', () => {
    it('clears only the grid it names', () => {
        const before = select(GRID_A, ['r0c0', 'replace']);
        expect(clearSelectionOf(before, GRID_B)).toBe(before);
        expect(clearSelectionOf(before, GRID_A)).toBe(NO_CELL_SELECTION);
    });
});

describe('set gestures (the palette selecting by colour)', () => {
    it('replaces the selection with a whole set', () => {
        const before = select(GRID_A, ['r3c3', 'replace']);
        const after = applyCellSetGesture(before, GRID_A, ['r0c0', 'r1c1'], 'replace');
        expect(cells(after)).toEqual(['r0c0', 'r1c1']);
    });

    it('adds a set to the existing selection', () => {
        const before = select(GRID_A, ['r3c3', 'replace']);
        const after = applyCellSetGesture(before, GRID_A, ['r0c0', 'r1c1'], 'add');
        expect(cells(after)).toEqual(['r0c0', 'r1c1', 'r3c3']);
    });

    it('replacing with an EMPTY set clears the selection', () => {
        const before = select(GRID_A, ['r3c3', 'replace']);
        const after = applyCellSetGesture(before, GRID_A, [], 'replace');
        expect(after).toBe(NO_CELL_SELECTION);
    });

    it('never reaches into another grid', () => {
        const before = select(GRID_A, ['r0c0', 'replace']);
        expect(applyCellSetGesture(before, GRID_B, ['r1c1'], 'add')).toBe(before);
    });
});

describe('modifier mapping', () => {
    const flags = (shift = false, ctrl = false, meta = false) => ({
        shiftKey: shift,
        ctrlKey: ctrl,
        metaKey: meta,
    });

    it('maps plain / Shift / Ctrl on Windows and Linux', () => {
        expect(cellGestureOf(flags(), false)).toBe('replace');
        expect(cellGestureOf(flags(true), false)).toBe('add');
        expect(cellGestureOf(flags(false, true), false)).toBe('remove');
    });

    it('uses Cmd for remove on macOS', () => {
        expect(cellGestureOf(flags(false, false, true), true)).toBe('remove');
        expect(cellGestureOf(flags(true), true)).toBe('add');
        expect(cellGestureOf(flags(), true)).toBe('replace');
    });

    it('ignores Ctrl+click on macOS, where it is the secondary click', () => {
        // Otherwise a context menu would open AND the selection would change.
        expect(cellGestureOf(flags(false, true), true)).toBeNull();
        expect(cellGestureOf(flags(true, true), true)).toBeNull();
    });

    it('resolves Shift+Ctrl deterministically to add, never to a new meaning', () => {
        expect(cellGestureOf(flags(true, true), false)).toBe('add');
    });

    it('reports which activations are selection edits', () => {
        expect(hasSelectionModifierFlags(flags(), false)).toBe(false);
        expect(hasSelectionModifierFlags(flags(true), false)).toBe(true);
        expect(hasSelectionModifierFlags(flags(false, true), false)).toBe(true);
        // A macOS Ctrl+click must step aside too, so the `+` never fires.
        expect(hasSelectionModifierFlags(flags(false, true), true)).toBe(true);
    });
});

describe('grid geometry helpers', () => {
    it('enumerates a grid row-major', () => {
        expect(allGridCellKeys({ rows: 2, columns: 3 })).toEqual([
            'r0c0',
            'r0c1',
            'r0c2',
            'r1c0',
            'r1c1',
            'r1c2',
        ]);
    });

    it('sorts cell keys in reading order', () => {
        expect(sortCellKeysRowMajor(['r2c0', 'r0c3', 'r0c1'])).toEqual([
            'r0c1',
            'r0c3',
            'r2c0',
        ]);
    });

    it('keeps every cell when the grid grows', () => {
        const set = new Set(['r0c0', 'r3c3']);
        expect(pruneToDimensions(set, { rows: 5, columns: 5 })).toBe(set);
    });

    it('drops exactly the cells the shrunk grid no longer has', () => {
        const set = new Set(['r0c0', 'r3c1', 'r1c4']);
        expect([...pruneToDimensions(set, { rows: 2, columns: 2 })]).toEqual(['r0c0']);
    });
});

describe('colour grouping', () => {
    const styles: GridCellStyles = {
        r0c0: { color: 'ocap:red' },
        r0c1: { color: 'ocap:blue' },
        r1c0: { color: 'ocap:red' },
        // The template parser can produce an entry without a colour; it must
        // count as uncoloured everywhere, not as a third state.
        r1c1: {},
    };
    const dimensions = { rows: 2, columns: 2 };

    it('normalizes an absent entry and an empty entry to "no colour"', () => {
        expect(gridCellColorOf(styles, 'r1c1')).toBeNull();
        expect(gridCellColorOf(styles, 'r5c5')).toBeNull();
        expect(gridCellColorOf(undefined, 'r0c0')).toBeNull();
        expect(gridCellColorOf(styles, 'r0c0')).toBe('ocap:red');
    });

    it('finds every cell of one colour, in reading order', () => {
        expect(cellsWithColor(styles, dimensions, 'ocap:red')).toEqual(['r0c0', 'r1c0']);
    });

    it('finds every UNCOLOURED cell, including the empty-entry one', () => {
        expect(cellsWithColor(styles, dimensions, null)).toEqual(['r1c1']);
    });

    it('enumerates the grid, so uncoloured cells with no entry are found too', () => {
        expect(cellsWithColor({}, { rows: 1, columns: 2 }, null)).toEqual(['r0c0', 'r0c1']);
    });

    it('never returns a cell the grid does not have', () => {
        const outside: GridCellStyles = { r4c4: { color: 'ocap:red' } };
        expect(cellsWithColor(outside, dimensions, 'ocap:red')).toEqual([]);
    });

    it('compares the RAW stored value, not a resolved colour', () => {
        const mixed: GridCellStyles = { r0c0: { color: 'ocap:red' }, r0c1: { color: '#ff0000' } };
        expect(cellsWithColor(mixed, { rows: 1, columns: 2 }, 'ocap:red')).toEqual(['r0c0']);
    });

    it('returns no match rather than failing when a colour is absent', () => {
        expect(cellsWithColor(styles, dimensions, 'ocap:purple')).toEqual([]);
    });
});

describe('the palette active indicator', () => {
    const styles: GridCellStyles = {
        r0c0: { color: 'ocap:red' },
        r0c1: { color: 'ocap:red' },
        r1c0: { color: 'ocap:blue' },
        r1c1: {},
    };

    it('reports the shared colour when every selected cell agrees', () => {
        expect(selectionColorSummary(styles, new Set(['r0c0', 'r0c1']))).toEqual({
            color: 'ocap:red',
            mixed: false,
        });
    });

    it('reports "no colour" when every selected cell is uncoloured', () => {
        expect(selectionColorSummary(styles, new Set(['r1c1', 'r4c4']))).toEqual({
            color: null,
            mixed: false,
        });
    });

    it('marks nothing active for a mixed selection', () => {
        expect(selectionColorSummary(styles, new Set(['r0c0', 'r1c0']))).toEqual({
            color: null,
            mixed: true,
        });
    });

    it('marks nothing active for an empty selection', () => {
        expect(selectionColorSummary(styles, new Set()).mixed).toBe(true);
    });

    it('reports a valid colour this build has no swatch for, rather than a look-alike', () => {
        const orange: GridCellStyles = { r0c0: { color: 'ocap:orange' } };
        expect(selectionColorSummary(orange, new Set(['r0c0']))).toEqual({
            color: 'ocap:orange',
            mixed: false,
        });
    });
});

describe('the selection never becomes data', () => {
    it('produces plain, settings-free values', () => {
        const state = select(GRID_A, ['r0c0', 'replace'], ['r1c1', 'add']);
        // Nothing but a context key and a set of strings — nothing that could
        // be spread into a StoredCategory or survive a save.
        expect(Object.keys(state).sort()).toEqual(['cells', 'context']);
        expect([...state.cells].every((cell) => typeof cell === 'string')).toBe(true);
    });

    it('never mutates the state it was given', () => {
        const before = select(GRID_A, ['r0c0', 'replace']);
        const snapshot = cells(before);
        applyCellGesture(before, GRID_A, 'r1c1', 'add');
        applyCellSetGesture(before, GRID_A, ['r2c2'], 'add');
        clearSelectionOf(before, GRID_A);
        expect(cells(before)).toEqual(snapshot);
    });
});

describe('what each interaction mode means', () => {
    it('executes a tool ONLY in locked mode', () => {
        // The deliberate behaviour change: edit mode manages, locked executes.
        // A real <button> turns Enter and Space into the same click, so this one
        // predicate covers the pointer and the keyboard alike.
        expect(executesToolActions('locked')).toBe(true);
        expect(executesToolActions('edit')).toBe(false);
    });

    it('selects cells ONLY in edit mode', () => {
        expect(allowsCellSelection('edit')).toBe(true);
        expect(allowsCellSelection('locked')).toBe(false);
    });

    it('never lets both meanings apply to one activation', () => {
        // If a mode ever both executed and selected, a single click would run a
        // script AND change the selection.
        for (const mode of ['locked', 'edit'] as const) {
            expect(executesToolActions(mode) && allowsCellSelection(mode)).toBe(false);
        }
    });
});

/**
 * A selection must survive a grid being REBUILT.
 *
 * Found in a live smoke run: dragging a tool cleared the selection every single
 * time. The cause was not in the selection code at all — list view computes
 * `categorySortEnabled = … && !buttonDrag.isDragging`, so the category block
 * changes element TYPE the moment a drag starts and React tears the whole grid
 * down and rebuilds it mid-gesture. Watching unmounts alone cannot tell that
 * apart from the grid actually going away.
 *
 * Counting the live renderings can, as long as nobody asks in the same turn.
 */
describe('live grid renderings', () => {
    const A: GridSelectionContextKey = { categoryId: 'cat', variantId: null };
    const B: GridSelectionContextKey = { categoryId: 'cat', variantId: 'v1' };

    it('counts per grid context, not per category', () => {
        const counter = createGridInstanceCounter();
        counter.register(A);
        expect(counter.liveCount(A)).toBe(1);
        expect(counter.liveCount(B)).toBe(0);
    });

    it('drops to zero when the only rendering goes away', () => {
        const counter = createGridInstanceCounter();
        const release = counter.register(A);
        release();
        expect(counter.liveCount(A)).toBe(0);
    });

    it('stays above zero across a REBUILD (deregister then register)', () => {
        // Exactly the drag case: React runs the old cleanup and the new mount
        // effect inside one commit, so anything asking afterwards must see 1.
        const counter = createGridInstanceCounter();
        const release = counter.register(A);
        release();
        counter.register(A);
        expect(counter.liveCount(A)).toBe(1);
    });

    it('survives a rebuild that mounts the new rendering FIRST', () => {
        // Some orders mount before unmounting; the count must never dip to 0.
        const counter = createGridInstanceCounter();
        const first = counter.register(A);
        counter.register(A);
        expect(counter.liveCount(A)).toBe(2);
        first();
        expect(counter.liveCount(A)).toBe(1);
    });

    it('ignores a release that is called twice', () => {
        // A double invocation must not make a live rendering look gone.
        const counter = createGridInstanceCounter();
        const release = counter.register(A);
        counter.register(A);
        release();
        release();
        expect(counter.liveCount(A)).toBe(1);
    });

    it('never goes negative', () => {
        const counter = createGridInstanceCounter();
        const release = counter.register(A);
        release();
        release();
        expect(counter.liveCount(A)).toBe(0);
    });

    it('keys two variants of one category apart', () => {
        const counter = createGridInstanceCounter();
        counter.register(A);
        counter.register(B);
        expect(counter.liveCount(A)).toBe(1);
        expect(counter.liveCount(B)).toBe(1);
        expect(gridContextKey(A)).not.toBe(gridContextKey(B));
    });

    it('cannot confuse two ids by where the separator falls', () => {
        // Length-prefixed keys: 'a:b' + variant '' must not collide with
        // category 'a' + variant 'b'.
        expect(gridContextKey({ categoryId: 'a:b', variantId: null })).not.toBe(
            gridContextKey({ categoryId: 'a', variantId: 'b' })
        );
    });
});
