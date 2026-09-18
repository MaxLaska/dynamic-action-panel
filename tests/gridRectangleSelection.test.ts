// tests/gridRectangleSelection.test.ts
// The modifier RECTANGLE gesture: Shift-drag adds a block of cells, Ctrl/Cmd-drag
// removes one (docs/ocap/cell-selection-colors.md §4a).
//
// Three product rules carry this feature, and they are what this file pins:
//
// 1. the unit is the CELL. A rectangle is spanned between two cells, inclusive,
//    with no pixel geometry and no overlap threshold anywhere in the decision;
// 2. the pointer always resolves to exactly one cell — in a gutter and outside
//    the grid too, so a gesture can neither die in a gap nor at the edge;
// 3. every step derives from the BASELINE, never from the previous step, so
//    growing a rectangle and shrinking it again lands back on `baseline ±
//    rectangle` exactly.
//
// The paint rules that hang off (2) live in tests/cellPaintSelection.test.ts.

import { describe, expect, it } from 'vitest';
import type { GridCellKey } from '@/types/settings';
import type { GridDimensions } from '@/utils/categoryGrid';
import {
    cellAtPoint,
    cellsAddedByRectangle,
    nearestTrackIndex,
    rectangleCellKeys,
    rectangleSelectionCells,
    sameCell,
    type GridAxisGeometry,
} from '@/utils/gridRectangleSelection';

const GRID_4x4: GridDimensions = { rows: 4, columns: 4 };
const GRID_3x5: GridDimensions = { rows: 3, columns: 5 };

const at = (row: number, column: number) => ({ row, column });
const set = (...keys: string[]): ReadonlySet<GridCellKey> => new Set(keys);

describe('rectangleCellKeys — the block between two cells', () => {
    it('is the single cell when both corners are the same', () => {
        expect(rectangleCellKeys(at(1, 2), at(1, 2), GRID_4x4)).toEqual(['r1c2']);
    });

    it('spans one row', () => {
        expect(rectangleCellKeys(at(2, 0), at(2, 3), GRID_4x4)).toEqual([
            'r2c0',
            'r2c1',
            'r2c2',
            'r2c3',
        ]);
    });

    it('spans one column', () => {
        expect(rectangleCellKeys(at(0, 1), at(3, 1), GRID_4x4)).toEqual([
            'r0c1',
            'r1c1',
            'r2c1',
            'r3c1',
        ]);
    });

    it('spans a diagonal block, row-major', () => {
        // The spec's own example: r1c1 → r2c3 is a 2x3 block.
        expect(rectangleCellKeys(at(1, 1), at(2, 3), GRID_4x4)).toEqual([
            'r1c1',
            'r1c2',
            'r1c3',
            'r2c1',
            'r2c2',
            'r2c3',
        ]);
    });

    it('is direction-free: dragging back up spans the same block', () => {
        const forward = rectangleCellKeys(at(1, 1), at(2, 3), GRID_4x4);
        const backward = rectangleCellKeys(at(2, 3), at(1, 1), GRID_4x4);
        expect(backward).toEqual(forward);
        // ...and so are the two mixed directions.
        expect(rectangleCellKeys(at(1, 3), at(2, 1), GRID_4x4)).toEqual(forward);
        expect(rectangleCellKeys(at(2, 1), at(1, 3), GRID_4x4)).toEqual(forward);
    });

    it('can cover the whole grid', () => {
        expect(rectangleCellKeys(at(0, 0), at(3, 3), GRID_4x4)).toHaveLength(16);
        expect(rectangleCellKeys(at(3, 3), at(0, 0), GRID_4x4)).toHaveLength(16);
    });

    it('works on non-square and odd dimensions', () => {
        expect(rectangleCellKeys(at(0, 0), at(2, 4), GRID_3x5)).toHaveLength(15);
        expect(rectangleCellKeys(at(0, 0), at(0, 0), { rows: 1, columns: 1 })).toEqual([
            'r0c0',
        ]);
        expect(rectangleCellKeys(at(1, 1), at(1, 3), GRID_3x5)).toEqual([
            'r1c1',
            'r1c2',
            'r1c3',
        ]);
    });

    it('never produces a cell the grid does not have', () => {
        // A grid that shrank while the gesture was in flight must not be able
        // to hand back a key outside its own dimensions.
        expect(rectangleCellKeys(at(-3, -2), at(9, 9), GRID_3x5)).toHaveLength(15);
        expect(rectangleCellKeys(at(7, 7), at(8, 8), GRID_3x5)).toEqual([]);
    });
});

describe('nearestTrackIndex — a position always addresses one track', () => {
    // 50px cells with a 4px gutter: track n runs [54n, 54n+50].
    const axis: GridAxisGeometry = { start: 0, cellSize: 50, gap: 4, count: 4 };

    it('resolves a position inside a cell to that cell', () => {
        expect(nearestTrackIndex(0, axis)).toBe(0);
        expect(nearestTrackIndex(25, axis)).toBe(0);
        expect(nearestTrackIndex(49, axis)).toBe(0);
        expect(nearestTrackIndex(54, axis)).toBe(1);
        expect(nearestTrackIndex(79, axis)).toBe(1);
        expect(nearestTrackIndex(187, axis)).toBe(3);
    });

    it('resolves a position in the GUTTER to the nearer neighbour', () => {
        // The gap runs [50, 54]; 51 is nearer to cell 0, 53 to cell 1.
        expect(nearestTrackIndex(51, axis)).toBe(0);
        expect(nearestTrackIndex(53, axis)).toBe(1);
        // Exactly on the midpoint the later track wins — an arbitrary but
        // FIXED tiebreak, so the gesture never flickers between two cells.
        expect(nearestTrackIndex(52, axis)).toBe(1);
    });

    it('clamps outside the grid instead of dropping the gesture', () => {
        expect(nearestTrackIndex(-500, axis)).toBe(0);
        expect(nearestTrackIndex(5000, axis)).toBe(3);
    });

    it('has no dead zone anywhere along the axis', () => {
        // Every whole pixel from well before the grid to well after it must
        // land on a real track. A gap that resolved to "nothing" would abort a
        // drag in the middle of the grid.
        for (let position = -20; position <= 240; position += 1) {
            const index = nearestTrackIndex(position, axis);
            expect(Number.isInteger(index)).toBe(true);
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThanOrEqual(3);
        }
    });

    it('is monotonic: moving right never moves the target left', () => {
        let previous = -1;
        for (let position = -20; position <= 240; position += 1) {
            const index = nearestTrackIndex(position, axis);
            expect(index).toBeGreaterThanOrEqual(previous);
            previous = index;
        }
    });

    it('survives a degenerate geometry instead of producing NaN', () => {
        expect(nearestTrackIndex(10, { start: 0, cellSize: 0, gap: 0, count: 4 })).toBe(0);
        expect(nearestTrackIndex(Number.NaN, axis)).toBe(0);
        expect(nearestTrackIndex(10, { start: 0, cellSize: 50, gap: 4, count: 0 })).toBe(0);
    });
});

describe('cellAtPoint', () => {
    const columns: GridAxisGeometry = { start: 100, cellSize: 50, gap: 4, count: 4 };
    const rows: GridAxisGeometry = { start: 200, cellSize: 20, gap: 4, count: 3 };

    it('reads the grid box offset, not raw viewport coordinates', () => {
        expect(cellAtPoint({ x: 100, y: 200 }, columns, rows)).toEqual(at(0, 0));
        expect(cellAtPoint({ x: 262, y: 248 }, columns, rows)).toEqual(at(2, 3));
    });

    it('resolves the crossing of four cells deterministically', () => {
        // Dead centre of the 4px cross between r0/r1 and c0/c1.
        expect(cellAtPoint({ x: 152, y: 222 }, columns, rows)).toEqual(at(1, 1));
    });

    it('sameCell compares coordinates, not identity', () => {
        expect(sameCell(at(1, 2), { row: 1, column: 2 })).toBe(true);
        expect(sameCell(at(1, 2), at(2, 1))).toBe(false);
    });
});

describe('Shift = ADD a rectangle', () => {
    const rect = rectangleCellKeys(at(1, 1), at(2, 2), GRID_4x4);

    it('selects the whole block from an empty baseline', () => {
        expect(rectangleSelectionCells(set(), rect, 'add')).toEqual([
            'r1c1',
            'r1c2',
            'r2c1',
            'r2c2',
        ]);
    });

    it('keeps a baseline that lies outside the rectangle', () => {
        expect(rectangleSelectionCells(set('r0c0'), rect, 'add')).toEqual([
            'r0c0',
            'r1c1',
            'r1c2',
            'r2c1',
            'r2c2',
        ]);
    });

    it('never duplicates a baseline cell the rectangle also covers', () => {
        expect(rectangleSelectionCells(set('r1c1', 'r3c3'), rect, 'add')).toEqual([
            'r1c1',
            'r1c2',
            'r2c1',
            'r2c2',
            'r3c3',
        ]);
    });

    it('changes nothing when the baseline already covers the rectangle', () => {
        const baseline = set('r1c1', 'r1c2', 'r2c1', 'r2c2');
        expect(rectangleSelectionCells(baseline, rect, 'add')).toEqual([
            'r1c1',
            'r1c2',
            'r2c1',
            'r2c2',
        ]);
    });

    it('grows and shrinks back to exactly baseline + rectangle', () => {
        // The reason every step derives from the baseline: replaying the
        // pointer path — out to 3x3, back to 1x1 — must land on the same answer
        // as going straight there.
        const baseline = set('r0c0');
        const grown = rectangleSelectionCells(
            baseline,
            rectangleCellKeys(at(1, 1), at(3, 3), GRID_4x4),
            'add'
        );
        expect(grown).toHaveLength(10);
        const shrunk = rectangleSelectionCells(
            baseline,
            rectangleCellKeys(at(1, 1), at(1, 1), GRID_4x4),
            'add'
        );
        expect(shrunk).toEqual(['r0c0', 'r1c1']);
    });
});

describe('Ctrl = REMOVE a rectangle', () => {
    const rect = rectangleCellKeys(at(1, 1), at(2, 2), GRID_4x4);

    it('removes only the baseline cells the rectangle covers', () => {
        expect(
            rectangleSelectionCells(set('r0c0', 'r1c1', 'r2c2', 'r3c3'), rect, 'remove')
        ).toEqual(['r0c0', 'r3c3']);
    });

    it('changes nothing when the rectangle hits no selected cell', () => {
        expect(rectangleSelectionCells(set('r0c0', 'r3c3'), rect, 'remove')).toEqual([
            'r0c0',
            'r3c3',
        ]);
    });

    it('can empty the selection completely', () => {
        expect(rectangleSelectionCells(set('r1c1', 'r2c2'), rect, 'remove')).toEqual([]);
    });

    it('never ADDS a cell — remove is strictly subtractive', () => {
        const baseline = set('r0c0');
        const result = rectangleSelectionCells(baseline, rect, 'remove');
        for (const cell of result) {
            expect(baseline.has(cell)).toBe(true);
        }
    });

    it('grows and shrinks back to exactly baseline − rectangle', () => {
        const baseline = set('r0c0', 'r1c1', 'r1c2', 'r2c1', 'r2c2');
        const grown = rectangleSelectionCells(
            baseline,
            rectangleCellKeys(at(0, 0), at(3, 3), GRID_4x4),
            'remove'
        );
        expect(grown).toEqual([]);
        const shrunk = rectangleSelectionCells(
            baseline,
            rectangleCellKeys(at(1, 1), at(1, 1), GRID_4x4),
            'remove'
        );
        expect(shrunk).toEqual(['r0c0', 'r1c2', 'r2c1', 'r2c2']);
    });
});

describe('cellsAddedByRectangle — what an ADD gesture brings in', () => {
    const rect = rectangleCellKeys(at(1, 1), at(2, 2), GRID_4x4);

    it('is the rectangle minus the baseline, in reading order', () => {
        expect(cellsAddedByRectangle(set('r1c1', 'r2c2'), rect)).toEqual(['r1c2', 'r2c1']);
    });

    it('is empty when the rectangle adds nothing', () => {
        expect(cellsAddedByRectangle(set('r1c1', 'r1c2', 'r2c1', 'r2c2'), rect)).toEqual([]);
    });

    it('is the whole rectangle from an empty baseline', () => {
        expect(cellsAddedByRectangle(set(), rect)).toEqual(rect);
    });

    it('never reports a cell that was already selected', () => {
        // This is what keeps the ephemeral paint colour off cells the user did
        // not add with this gesture.
        const baseline = set('r0c0', 'r1c1');
        for (const cell of cellsAddedByRectangle(baseline, rect)) {
            expect(baseline.has(cell)).toBe(false);
        }
    });
});
