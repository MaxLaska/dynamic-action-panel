// tests/gridSelectionOutline.test.ts
//
// The persistent selection outline: the contour of whatever is selected right
// now, and the reason it is derived from cell EDGES rather than from a bounding
// box (docs/ocap/cell-selection-colors.md §9.2).
//
// A bounding box would be wrong the moment a selection stops being a rectangle,
// which is exactly what Ctrl-removal produces. Following the edges means the
// topology comes out right for free — holes, islands, concave corners — and
// that is what these tests pin.

import { describe, expect, it } from 'vitest';
import type { GridCellKey } from '@/types/settings';
import type { GridDimensions } from '@/utils/categoryGrid';
import {
    outlineEdgeCount,
    selectionOutlinePieces,
    type GridOutlinePiece,
} from '@/utils/gridSelectionOutline';

const GRID_4x4: GridDimensions = { rows: 4, columns: 4 };
const GRID_5x5: GridDimensions = { rows: 5, columns: 5 };

const set = (...keys: string[]): ReadonlySet<GridCellKey> => new Set(keys);

/** Every cell of an inclusive block, as keys. */
function block(r0: number, c0: number, r1: number, c1: number): string[] {
    const keys: string[] = [];
    for (let r = r0; r <= r1; r += 1) {
        for (let c = c0; c <= c1; c += 1) {
            keys.push(`r${r}c${c}`);
        }
    }
    return keys;
}

const pieceAt = (pieces: GridOutlinePiece[], cell: string) =>
    pieces.find((p) => p.cell === cell);

describe('one cell', () => {
    it('draws all four sides', () => {
        const pieces = selectionOutlinePieces(set('r1c1'), GRID_4x4);
        expect(pieces).toHaveLength(1);
        expect(pieces[0]!.edges).toEqual({
            top: true,
            right: true,
            bottom: true,
            left: true,
        });
    });

    it('reaches into every gutter it has a neighbour across', () => {
        const middle = selectionOutlinePieces(set('r1c1'), GRID_4x4)[0]!;
        expect(middle.reach).toEqual({ top: true, right: true, bottom: true, left: true });
    });

    it('stops at the grid boundary, where there is nothing to meet', () => {
        const topLeft = selectionOutlinePieces(set('r0c0'), GRID_4x4)[0]!;
        expect(topLeft.reach).toEqual({
            top: false,
            right: true,
            bottom: true,
            left: false,
        });
        const bottomRight = selectionOutlinePieces(set('r3c3'), GRID_4x4)[0]!;
        expect(bottomRight.reach).toEqual({
            top: true,
            right: false,
            bottom: false,
            left: true,
        });
    });
});

describe('a solid block reads as one shape', () => {
    it('never draws an edge between two selected cells', () => {
        const pieces = selectionOutlinePieces(set(...block(1, 1, 2, 2)), GRID_4x4);
        // The inner sides of a 2x2: each cell faces two selected neighbours.
        expect(pieceAt(pieces, 'r1c1')!.edges).toEqual({
            top: true,
            right: false,
            bottom: false,
            left: true,
        });
        expect(pieceAt(pieces, 'r2c2')!.edges).toEqual({
            top: false,
            right: true,
            bottom: true,
            left: false,
        });
    });

    it('draws exactly the perimeter, in cell edges', () => {
        // 2(m+n) for an m x n block — the classic result, and the check that
        // nothing internal leaks through.
        for (const [r0, c0, r1, c1] of [
            [0, 0, 0, 0],
            [1, 1, 2, 3],
            [0, 0, 3, 3],
            [0, 1, 3, 1],
            [2, 0, 2, 3],
        ] as const) {
            const rows = r1 - r0 + 1;
            const columns = c1 - c0 + 1;
            const pieces = selectionOutlinePieces(set(...block(r0, c0, r1, c1)), GRID_4x4);
            expect(outlineEdgeCount(pieces), `${rows}x${columns}`).toBe(
                2 * (rows + columns)
            );
        }
    });

    it('outlines the whole grid with its own border and nothing more', () => {
        const pieces = selectionOutlinePieces(set(...block(0, 0, 3, 3)), GRID_4x4);
        expect(pieces).toHaveLength(16);
        expect(outlineEdgeCount(pieces)).toBe(16);
        // Nothing may reach outside the grid.
        for (const piece of pieces) {
            if (piece.row === 0) expect(piece.reach.top).toBe(false);
            if (piece.column === 0) expect(piece.reach.left).toBe(false);
            if (piece.row === 3) expect(piece.reach.bottom).toBe(false);
            if (piece.column === 3) expect(piece.reach.right).toBe(false);
        }
    });
});

describe('a hole gets its own contour', () => {
    // The case the user named: select everything, then Ctrl-remove a block out
    // of the middle. A bounding box would still draw the full rectangle.
    const ring = set(...block(1, 1, 3, 3).filter((key) => key !== 'r2c2'));

    it('draws the outer perimeter AND the inner one', () => {
        const pieces = selectionOutlinePieces(ring, GRID_5x5);
        expect(pieces).toHaveLength(8);
        // 3x3 outer perimeter (12) plus the four sides facing the hole.
        expect(outlineEdgeCount(pieces)).toBe(16);
    });

    it('turns exactly the four cells around the hole inwards', () => {
        const pieces = selectionOutlinePieces(ring, GRID_5x5);
        expect(pieceAt(pieces, 'r1c2')!.edges.bottom).toBe(true);
        expect(pieceAt(pieces, 'r3c2')!.edges.top).toBe(true);
        expect(pieceAt(pieces, 'r2c1')!.edges.right).toBe(true);
        expect(pieceAt(pieces, 'r2c3')!.edges.left).toBe(true);
        // A corner only touches the hole diagonally, so it faces nothing.
        expect(pieceAt(pieces, 'r1c1')!.edges).toEqual({
            top: true,
            right: false,
            bottom: false,
            left: true,
        });
    });

    it('keeps the hole when it is a whole block, not just one cell', () => {
        const cells = set(
            ...block(0, 0, 4, 4).filter(
                (key) => !block(1, 1, 3, 3).includes(key)
            )
        );
        const pieces = selectionOutlinePieces(cells, GRID_5x5);
        expect(pieces).toHaveLength(16);
        // 5x5 outer perimeter (20) plus the 3x3 hole's own perimeter (12).
        expect(outlineEdgeCount(pieces)).toBe(32);
    });
});

describe('disconnected islands are outlined separately', () => {
    it('gives each island its own full perimeter', () => {
        const cells = set(...block(0, 0, 1, 1), ...block(3, 3, 3, 3));
        const pieces = selectionOutlinePieces(cells, GRID_4x4);
        // 2x2 (8) plus a single cell (4).
        expect(outlineEdgeCount(pieces)).toBe(12);
        expect(pieceAt(pieces, 'r3c3')!.edges).toEqual({
            top: true,
            right: true,
            bottom: true,
            left: true,
        });
    });

    it('treats a diagonal touch as two shapes, because it is', () => {
        const pieces = selectionOutlinePieces(set('r1c1', 'r2c2'), GRID_4x4);
        expect(outlineEdgeCount(pieces)).toBe(8);
        for (const piece of pieces) {
            expect(piece.edges).toEqual({
                top: true,
                right: true,
                bottom: true,
                left: true,
            });
        }
    });
});

describe('the contour is always closed', () => {
    // A shape's outline is closed exactly when every cell agrees with its
    // neighbours about the shared edge: either both are selected and neither
    // draws it, or one is and draws it alone. Checking that over many random
    // shapes is a stronger statement than any single example.
    it('never leaves a side drawn from both sides, or from neither', () => {
        let seed = 12345;
        const random = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };
        for (let attempt = 0; attempt < 200; attempt += 1) {
            const cells = new Set<GridCellKey>();
            for (let r = 0; r < 5; r += 1) {
                for (let c = 0; c < 5; c += 1) {
                    if (random() < 0.5) cells.add(`r${r}c${c}`);
                }
            }
            const pieces = selectionOutlinePieces(cells, GRID_5x5);
            const byCell = new Map(pieces.map((p) => [p.cell, p]));
            for (const piece of pieces) {
                const right = byCell.get(`r${piece.row}c${piece.column + 1}`);
                if (right) {
                    // Both selected: the shared edge is drawn by neither.
                    expect(piece.edges.right).toBe(false);
                    expect(right.edges.left).toBe(false);
                } else if (piece.column < 4) {
                    expect(piece.edges.right).toBe(true);
                }
                const below = byCell.get(`r${piece.row + 1}c${piece.column}`);
                if (below) {
                    expect(piece.edges.bottom).toBe(false);
                    expect(below.edges.top).toBe(false);
                } else if (piece.row < 4) {
                    expect(piece.edges.bottom).toBe(true);
                }
            }
        }
    });
});

describe('nothing is drawn where the grid has no cell', () => {
    it('ignores a coordinate outside the current dimensions', () => {
        const pieces = selectionOutlinePieces(set('r1c1', 'r9c9', 'r0c7'), GRID_4x4);
        expect(pieces.map((p) => p.cell)).toEqual(['r1c1']);
    });

    it('ignores an unparseable key instead of throwing', () => {
        const pieces = selectionOutlinePieces(set('r1c1', 'nonsense'), GRID_4x4);
        expect(pieces.map((p) => p.cell)).toEqual(['r1c1']);
    });

    it('returns nothing at all for an empty selection', () => {
        expect(selectionOutlinePieces(set(), GRID_4x4)).toEqual([]);
    });

    it('is row-major, so a piece keeps its identity across renders', () => {
        const pieces = selectionOutlinePieces(set('r2c0', 'r0c3', 'r1c1'), GRID_4x4);
        expect(pieces.map((p) => p.cell)).toEqual(['r0c3', 'r1c1', 'r2c0']);
    });
});
