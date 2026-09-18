import React from 'react';
import type { GridCellKey } from '@/types/settings';
import type { GridDimensions } from '@/utils/categoryGrid';
import {
    selectionOutlinePieces,
    type GridCellSides,
    type GridOutlinePiece,
} from '@/utils/gridSelectionOutline';

interface GridSelectionOutlineProps {
    /** The cells selected right now, already pruned to the grid. */
    cells: ReadonlySet<GridCellKey>;
    /** Dimensions of exactly the grid on screen. */
    dimensions: GridDimensions;
}

/** A CSS `border-width` shorthand: the sides to draw, in CSS order. */
function borderWidths(edges: GridCellSides<boolean>, width: string): string {
    return [edges.top, edges.right, edges.bottom, edges.left]
        .map((draw) => (draw ? width : '0px'))
        .join(' ');
}

/** How far a piece reaches beyond its cell, side by side, in CSS order. */
function reachInset(reach: GridCellSides<boolean>): GridCellSides<string> {
    const half = 'calc(var(--ocap-grid-gap) / 2)';
    return {
        top: reach.top ? half : '0px',
        right: reach.right ? half : '0px',
        bottom: reach.bottom ? half : '0px',
        left: reach.left ? half : '0px',
    };
}

const OutlinePiece: React.FC<{ piece: GridOutlinePiece }> = ({ piece }) => {
    const inset = reachInset(piece.reach);
    return (
        <div
            className="ocap-grid-overlay ocap-grid-outline-piece"
            aria-hidden
            style={
                {
                    '--ocap-cell-row': piece.row,
                    '--ocap-cell-column': piece.column,
                    '--ocap-outline-top': inset.top,
                    '--ocap-outline-right': inset.right,
                    '--ocap-outline-bottom': inset.bottom,
                    '--ocap-outline-left': inset.left,
                    '--ocap-outline-widths': borderWidths(piece.edges, '2px'),
                } as React.CSSProperties
            }
        />
    );
};

/**
 * The outline of the current selection — its real shape, not its bounding box.
 *
 * One box per selected cell, each drawing a border only on the sides whose
 * neighbour is not selected (see `selectionOutlinePieces` for why that is
 * enough, and what it buys: holes, islands and every concave corner come out
 * right without anyone computing a polygon).
 *
 * The pieces are absolutely positioned against the grid's own tracks, using the
 * same tokens the grid is laid out with, so the contour is exact at any panel
 * width and nothing measures pixels. They are out of flow, so they cannot
 * occupy a track or displace an auto-placed cell, and pointer-transparent, so
 * they cannot swallow a click — they sit over the gutters, which belong to the
 * cells on either side.
 *
 * This is the PERSISTENT layer: it survives the gesture that produced it and is
 * what the user reads afterwards. The gesture's own preview
 * (`GridRectanglePreview`) is drawn dashed and above it, so "what is selected"
 * and "what am I doing" never have to be told apart by position alone.
 */
export const GridSelectionOutline: React.FC<GridSelectionOutlineProps> = ({
    cells,
    dimensions,
}) => {
    const pieces = React.useMemo(
        () => selectionOutlinePieces(cells, dimensions),
        [cells, dimensions]
    );
    if (pieces.length === 0) {
        return null;
    }
    return (
        <>
            {pieces.map((piece) => (
                <OutlinePiece key={piece.cell} piece={piece} />
            ))}
        </>
    );
};
