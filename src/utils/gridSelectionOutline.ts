// gridSelectionOutline.ts
// The pure core of the PERSISTENT selection outline: the contour of whatever is
// selected right now, however oddly shaped.
//
// The wash alone said "selected" but never said "this shape". The contour does,
// and it has to keep saying it after the gesture that produced it is over — a
// selection built by subtracting a block from a larger one is exactly the case
// the wash reads worst.
//
// The whole thing is one idea:
//
//     a cell draws a border on each side whose orthogonal neighbour is NOT
//     selected, and every piece grows by half a gutter toward every side that
//     has an in-grid neighbour.
//
// That is enough. Following the cells' own edges rather than a bounding box
// means the contour is the real topology for free:
//
// - a solid block gets one closed outline, because the shared edges inside it
//   are never drawn;
// - a hole gets its own inner outline, because the cells around it have edges
//   facing in;
// - several disconnected islands each get their own outline, because nothing
//   here assumes the selection is connected;
// - a cell touching another only diagonally stays its own outline, which is the
//   honest reading: they do not share an edge.
//
// The uniform growth is what makes it read as one shape instead of tiled boxes.
// Two neighbouring pieces meet exactly at the middle of the gutter between them,
// so a run of cells produces one unbroken line — and, less obviously, a CONCAVE
// corner closes exactly too: the piece above the corner and the piece beside it
// both reach the same point. Growing only toward selected neighbours would leave
// a notch there.
//
// At the grid's own boundary there is no gutter to reach into and nothing to
// meet, so a piece stops at the cell edge and the contour stays inside the grid
// frame.
//
// Nothing here touches the DOM, React or settings.

import type { GridCellKey } from '@/types/settings';
import {
    gridCellKey,
    parseGridCellKey,
    type GridDimensions,
} from '@/utils/categoryGrid';
import { sortCellKeysRowMajor } from '@/utils/gridCellSelection';

/** The four sides of a cell, in the order CSS writes them. */
export interface GridCellSides<T> {
    top: T;
    right: T;
    bottom: T;
    left: T;
}

/** One cell's share of the contour. */
export interface GridOutlinePiece {
    cell: GridCellKey;
    row: number;
    column: number;
    /** Sides to draw: those whose orthogonal neighbour is not selected. */
    edges: GridCellSides<boolean>;
    /**
     * Sides that may reach into the gutter — those with an in-grid neighbour.
     * False at the grid's own boundary, where there is nothing to meet.
     */
    reach: GridCellSides<boolean>;
}

/**
 * The contour of a selection, one piece per selected cell.
 *
 * Row-major, so the rendered order is stable and a cell always keeps its key.
 * Cells outside `dimensions` are skipped rather than drawn: a selection is
 * pruned to the grid on read, and a stale coordinate must not produce a stray
 * box floating over the panel.
 */
export function selectionOutlinePieces(
    cells: ReadonlySet<GridCellKey>,
    dimensions: GridDimensions
): GridOutlinePiece[] {
    const pieces: GridOutlinePiece[] = [];
    for (const cell of sortCellKeysRowMajor(cells)) {
        const position = parseGridCellKey(cell);
        if (position === null) {
            continue;
        }
        const { row, column } = position;
        if (
            row < 0 ||
            column < 0 ||
            row >= dimensions.rows ||
            column >= dimensions.columns
        ) {
            continue;
        }
        const selected = (r: number, c: number) => cells.has(gridCellKey(r, c));
        pieces.push({
            cell,
            row,
            column,
            edges: {
                top: !selected(row - 1, column),
                right: !selected(row, column + 1),
                bottom: !selected(row + 1, column),
                left: !selected(row, column - 1),
            },
            reach: {
                top: row > 0,
                right: column < dimensions.columns - 1,
                bottom: row < dimensions.rows - 1,
                left: column > 0,
            },
        });
    }
    return pieces;
}

/** How many border segments a contour draws — its perimeter, in cell edges. */
export function outlineEdgeCount(pieces: readonly GridOutlinePiece[]): number {
    return pieces.reduce(
        (total, piece) =>
            total +
            Number(piece.edges.top) +
            Number(piece.edges.right) +
            Number(piece.edges.bottom) +
            Number(piece.edges.left),
        0
    );
}
