import React from 'react';
import { setIcon } from 'obsidian';
import { tWithParams } from '@/utils/i18n';
import type { GridResizeAvailability } from '@/hooks/useGridResize';
import type {
    GridDimensions,
    GridResizeDirection,
    GridResizeEdge,
} from '@/utils/categoryGrid';

interface GridResizeEdgeZoneProps {
    dimensions: GridDimensions;
    availability: GridResizeAvailability;
    /**
     * Absent while a button drag is in flight: the zone stays in place (so the
     * grid keeps its width) but offers no action.
     */
    onResize?: (edge: GridResizeEdge, direction: GridResizeDirection) => void;
    /** Starts the press that may become a drag resize. */
    onHandlePointerDown?: (edge: GridResizeEdge, event: React.PointerEvent) => void;
    /** This zone is currently being dragged. */
    dragging?: boolean;
    /** 'column' renders the zone at the right edge, 'row' the one below. */
    edge: GridResizeEdge;
}

/**
 * The grid's graspable EDGE — one per axis, in edit mode only.
 *
 * The whole right border of the grid (full height) and the whole bottom border
 * (full width) are the resize surface. That is the point of this component:
 * the user grabs "the edge of the grid", not a 16px icon they first have to
 * find. The `+` glyph rides in the middle of the zone as the compact
 * affordance for the one thing a drag cannot express in a single gesture —
 * "one more" — and a click anywhere on the zone does exactly that, so no part
 * of a control-shaped surface is inert.
 *
 * Big hit area, small visual: at rest the zone is only its faint `+`; hovering
 * lights a thin accent line along the grid edge; dragging keeps it lit. It is
 * never `disabled`, not even at 5x5 — a disabled button receives no pointer
 * events at all, and dragging inwards is the only way back down from the
 * maximum.
 *
 * Both zones live strictly OUTSIDE `.ocap-palette-grid`, occupying a 16px
 * gutter next to it. They are not cells, carry no slot index and cannot
 * influence a row track or a cell rect, and because they do not overlap the
 * grid at all they cannot swallow a click, a button drag or a file drop that
 * belongs to the outermost cells.
 */
export const GridResizeEdgeZone: React.FC<GridResizeEdgeZoneProps> = ({
    dimensions,
    availability,
    onResize,
    onHandlePointerDown,
    dragging = false,
    edge,
}) => {
    const iconRef = React.useRef<HTMLSpanElement>(null);
    const isColumn = edge === 'column';
    const canAdd = isColumn ? availability.canAddColumn : availability.canAddRow;
    const count = isColumn ? dimensions.columns : dimensions.rows;

    React.useEffect(() => {
        if (iconRef.current) {
            setIcon(iconRef.current, 'plus');
        }
    }, []);

    const label = canAdd
        ? tWithParams(
              isColumn ? 'grid_handle_column_tooltip' : 'grid_handle_row_tooltip',
              { count }
          )
        : tWithParams(
              isColumn ? 'grid_handle_column_max_tooltip' : 'grid_handle_row_max_tooltip',
              { count }
          );

    return (
        <button
            type="button"
            className={[
                'ocap-grid-edge',
                `ocap-grid-edge--${edge}`,
                dragging && 'ocap-grid-edge--dragging',
                !canAdd && 'ocap-grid-edge--at-max',
            ]
                .filter(Boolean)
                .join(' ')}
            aria-label={label}
            title={label}
            // Never disabled while resizing is possible at all: see above.
            disabled={!onResize}
            onPointerDown={(event) => {
                // In list view the whole category block carries the
                // category-drag listeners, so a press that escaped here would
                // drag the category instead of resizing its grid.
                event.stopPropagation();
                onHandlePointerDown?.(edge, event);
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                // Pointer input is served by the drag layer's pointer-up,
                // which also knows whether the press became a drag. Only a
                // KEYBOARD activation (detail === 0) has no pointer-up to be
                // served by, so it acts here.
                if (event.detail === 0 && canAdd) {
                    onResize?.(edge, 1);
                }
            }}
        >
            <span className="ocap-grid-edge-line" aria-hidden="true" />
            <span ref={iconRef} className="ocap-grid-edge-plus" aria-hidden="true" />
        </button>
    );
};

/**
 * The size readout that follows a resize drag: `columns × rows`, the reading
 * order every spreadsheet and Notion uses.
 *
 * It is absolutely positioned just ABOVE the grid box — outside it, so it can
 * never cover the cells it is describing (a 1x1 grid used to lose its only
 * cell behind it) — and it is pointer-transparent, so it can neither reflow
 * the preview nor swallow the drag it annotates.
 */
export const GridResizeReadout: React.FC<{
    dimensions: GridDimensions;
    edge: GridResizeEdge;
}> = ({ dimensions, edge }) => (
    <div
        className={`ocap-grid-resize-readout ocap-grid-resize-readout--${edge}`}
        role="status"
        aria-live="polite"
    >
        {`${dimensions.columns} × ${dimensions.rows}`}
    </div>
);
