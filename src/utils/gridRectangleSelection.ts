// gridRectangleSelection.ts
// The pure core of the MODIFIER RECTANGLE gesture: Shift-drag adds a
// rectangular block of cells to the selection, Ctrl/Cmd-drag removes one.
//
// It is the same selection semantics as the single click, applied to an area
// instead of to one cell (see docs/ocap/cell-selection-colors.md §4a):
//
//     Shift click = add one cell        Shift drag = add a rectangle
//     Ctrl  click = remove one cell     Ctrl  drag = remove a rectangle
//
// Three properties are decided here rather than in the pointer layer, because
// they are the ones that go wrong when they are decided per event:
//
// - **the unit is the CELL.** The rectangle is spanned between the cell the
//   press started on and the cell the pointer currently addresses, inclusive on
//   both ends. No pixel rectangle, no overlap percentage, no "is half of this
//   button inside?" — a cell is either in the block or it is not;
// - **the pointer always addresses exactly one cell.** A position in the 4px
//   gutter, or outside the grid entirely, resolves to the nearest track instead
//   of to nothing, so a gesture can neither die in a gap nor at the grid edge;
// - **every step is derived from the BASELINE**, the selection as it was when
//   the press started — never from the previous step. Growing a rectangle and
//   shrinking it again therefore lands back on exactly `baseline ± rectangle`,
//   which an incremental application cannot guarantee.
//
// Nothing here touches the DOM, React or settings.

import type { GridCellKey } from '@/types/settings';
import { gridCellKey, type GridDimensions } from '@/utils/categoryGrid';
import { sortCellKeysRowMajor } from '@/utils/gridCellSelection';

/** A cell addressed by its position, zero-based. */
export interface GridCellCoordinate {
    row: number;
    column: number;
}

/** The two gestures a rectangle can carry. A plain drag is not one of them. */
export type RectangleGesture = 'add' | 'remove';

/** One axis of a CSS grid, as measured from the rendered element. */
export interface GridAxisGeometry {
    /** Viewport coordinate of the axis' first track. */
    start: number;
    /** Length of ONE track, without the gap. */
    cellSize: number;
    /** Gap between two tracks. */
    gap: number;
    /** Number of tracks on this axis. */
    count: number;
}

/**
 * The track a position falls on — the NEAREST one, never none.
 *
 * Measured from track centres rather than from track bounds, which is what
 * makes the gutters behave: a position inside a cell is trivially nearest to
 * that cell, and a position in the gap belongs to whichever of the two
 * neighbours is closer. Exactly on the gap's midpoint the later track wins;
 * that tie has to be broken somehow and breaking it deterministically is worth
 * more than which side it falls on. Outside the grid the value clamps to the
 * first or last track, so dragging past the edge keeps extending the rectangle
 * instead of dropping the gesture.
 *
 * `offset` is measured from the axis' own `start`, which is therefore the one
 * field of the geometry this function does not read itself.
 */
export function nearestTrackIndex(
    offset: number,
    { cellSize, gap, count }: GridAxisGeometry
): number {
    if (!Number.isFinite(offset) || !Number.isFinite(count) || count < 1) {
        return 0;
    }
    const step = cellSize + gap;
    if (!Number.isFinite(step) || step <= 0) {
        return 0;
    }
    const raw = Math.round((offset - cellSize / 2) / step);
    return Math.min(count - 1, Math.max(0, raw));
}

/** The cell a viewport point addresses, clamped into the grid. */
export function cellAtPoint(
    point: { x: number; y: number },
    columns: GridAxisGeometry,
    rows: GridAxisGeometry
): GridCellCoordinate {
    return {
        row: nearestTrackIndex(point.y - rows.start, rows),
        column: nearestTrackIndex(point.x - columns.start, columns),
    };
}

/** Whether two coordinates address the same cell. */
export function sameCell(a: GridCellCoordinate, b: GridCellCoordinate): boolean {
    return a.row === b.row && a.column === b.column;
}

/**
 * Every cell of the inclusive rectangle between two coordinates, row-major.
 *
 * Direction-free: `r2c3 → r1c1` spans the same block as `r1c1 → r2c3`. The
 * result is clipped to the grid, so a coordinate that is out of range (a grid
 * that shrank mid-gesture) can never produce a key the grid does not have.
 */
export function rectangleCellKeys(
    a: GridCellCoordinate,
    b: GridCellCoordinate,
    dimensions: GridDimensions
): GridCellKey[] {
    const firstRow = Math.max(0, Math.min(a.row, b.row));
    const lastRow = Math.min(dimensions.rows - 1, Math.max(a.row, b.row));
    const firstColumn = Math.max(0, Math.min(a.column, b.column));
    const lastColumn = Math.min(dimensions.columns - 1, Math.max(a.column, b.column));

    const keys: GridCellKey[] = [];
    for (let row = firstRow; row <= lastRow; row += 1) {
        for (let column = firstColumn; column <= lastColumn; column += 1) {
            keys.push(gridCellKey(row, column));
        }
    }
    return keys;
}

/**
 * The selection a rectangle produces from the baseline, row-major.
 *
 * `add` is the union, `remove` is the difference. Always computed from the
 * baseline, so the same rectangle always yields the same answer however the
 * pointer got there.
 */
export function rectangleSelectionCells(
    baseline: ReadonlySet<GridCellKey>,
    rectangle: readonly GridCellKey[],
    gesture: RectangleGesture
): GridCellKey[] {
    const next = new Set(baseline);
    if (gesture === 'add') {
        for (const cell of rectangle) {
            next.add(cell);
        }
    } else {
        for (const cell of rectangle) {
            next.delete(cell);
        }
    }
    return sortCellKeysRowMajor(next);
}

/**
 * The cells an ADD rectangle actually brings in — the rectangle minus the
 * baseline, in reading order.
 *
 * This is the set the ephemeral paint colour applies to (§13 of the spec): only
 * what the gesture ADDED is painted, never a cell that was already selected and
 * never one the rectangle merely passed over on the way. A `remove` gesture has
 * no such set by construction, which is why this function takes no gesture.
 */
export function cellsAddedByRectangle(
    baseline: ReadonlySet<GridCellKey>,
    rectangle: readonly GridCellKey[]
): GridCellKey[] {
    return rectangle.filter((cell) => !baseline.has(cell));
}
