import React from 'react';
import type { GridRectangleBounds } from '@/utils/gridRectangleSelection';
import type { RectangleGesture } from '@/utils/gridRectangleSelection';

interface GridRectanglePreviewProps {
    /** The block the running gesture covers, as a grid span. */
    bounds: GridRectangleBounds;
    /** Adding reads as accent, removing as the error colour. */
    gesture: RectangleGesture;
}

/**
 * The outline of a running rectangle gesture — ONE box over the whole block.
 *
 * This is the element that makes the gesture readable. Ringing every cell
 * separately drew a tiled pattern that says "these cells", not "this
 * rectangle"; the gutters between them broke the shape into pieces and, for a
 * removal, there was nothing to ring at all — the cells simply stopped being
 * selected. A single continuous box says what the hand is doing, and its colour
 * says whether the block is being added or dropped.
 *
 * It is positioned from FOUR INTEGERS (row, column, rows, columns) against the
 * grid's own track sizes, computed in CSS from the same tokens the grid is laid
 * out with. That keeps the outline exact at any panel width without anyone
 * measuring pixels, and it deliberately spans the gaps: the cells stay
 * grid-snapped, the outline around them does not have to look it.
 *
 * Absolutely positioned, so it is out of flow and cannot displace the
 * auto-placed slot cells (an in-flow grid item would occupy tracks and push
 * them around), and `pointer-events: none`, so it can never swallow the very
 * gesture it draws.
 *
 * DASHED, and drawn above the persistent selection contour
 * (`GridSelectionOutline`), which is solid. The two answer different questions
 * — "what am I doing right now" against "what is selected" — and a gesture is
 * provisional until the pointer comes up, which is exactly what a dashed edge
 * has always meant.
 */
export const GridRectanglePreview: React.FC<GridRectanglePreviewProps> = ({
    bounds,
    gesture,
}) => (
    <div
        className={`ocap-grid-overlay ocap-grid-rect-preview ocap-grid-rect-preview--${gesture}`}
        aria-hidden
        style={
            {
                '--ocap-rect-row': bounds.row,
                '--ocap-rect-column': bounds.column,
                '--ocap-rect-rows': bounds.rows,
                '--ocap-rect-columns': bounds.columns,
            } as React.CSSProperties
        }
    />
);
