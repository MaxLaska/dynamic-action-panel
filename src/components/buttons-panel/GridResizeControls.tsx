import React from 'react';
import { setIcon } from 'obsidian';
import { t, tWithParams } from '@/utils/i18n';
import type { GridResizeAvailability } from '@/hooks/useGridResize';
import type {
    GridDimensions,
    GridResizeDirection,
    GridResizeEdge,
} from '@/utils/categoryGrid';

/**
 * A press on any resize control must not bubble: in list view the whole
 * category block carries the category-drag listeners, so a press that escaped
 * would drag the category instead of resizing its grid.
 */
function swallow(event: React.SyntheticEvent): void {
    event.stopPropagation();
}

interface ResizeButtonProps {
    icon: 'plus' | 'minus';
    className?: string;
    label: string;
    disabled: boolean;
    onClick: (event: React.MouseEvent) => void;
    onPointerDown?: (event: React.PointerEvent) => void;
}

const ResizeButton: React.FC<ResizeButtonProps> = ({
    icon,
    className,
    label,
    disabled,
    onClick,
    onPointerDown,
}) => {
    const iconRef = React.useRef<HTMLSpanElement>(null);

    React.useEffect(() => {
        if (iconRef.current) {
            setIcon(iconRef.current, icon);
        }
    }, [icon]);

    return (
        <button
            type="button"
            className={['ocap-grid-resize-button', className].filter(Boolean).join(' ')}
            aria-label={label}
            title={label}
            disabled={disabled}
            onPointerDown={(event) => {
                swallow(event);
                onPointerDown?.(event);
            }}
            onMouseDown={swallow}
            onTouchStart={swallow}
            onClick={onClick}
        >
            <span ref={iconRef} className="ocap-grid-resize-icon" />
        </button>
    );
};

interface GridResizeControlsProps {
    dimensions: GridDimensions;
    availability: GridResizeAvailability;
    /**
     * Absent while a button drag is in flight: the strip stays in place (so the
     * grid keeps its width) but offers no action.
     */
    onResize?: (edge: GridResizeEdge, direction: GridResizeDirection) => void;
    /** Starts the press that may become a drag resize. */
    onHandlePointerDown?: (edge: GridResizeEdge, event: React.PointerEvent) => void;
    /** This strip's handle is currently being dragged. */
    dragging?: boolean;
    /** 'column' renders the strip at the right edge, 'row' the one below. */
    edge: GridResizeEdge;
}

/**
 * The compact grid resize strips of edit mode: columns at the RIGHT edge, rows
 * BELOW the grid — the control sits where the thing it adds or removes
 * appears.
 *
 * Two controls per strip, and the second one carries both gestures:
 * - `−` removes the outermost column / row in one click;
 * - `+` is the Notion-style HANDLE — click it to add one, or press and drag it
 *   to snap the grid to any size in one gesture.
 *
 * The handle therefore stays interactive at the maximum, where adding is
 * impossible but dragging back is exactly what the user wants; only its label
 * and its dimmed glyph say that a click would do nothing.
 *
 * Both strips are chrome AROUND the slot grid, never cells of it: they live
 * outside the `.ocap-palette-grid` element, so they cannot influence a row
 * track, a cell rect or a drag index. Nothing here may key on occupancy,
 * target or preview state — see tests/paletteGridGeometry.test.ts.
 */
export const GridResizeControls: React.FC<GridResizeControlsProps> = ({
    dimensions,
    availability,
    onResize,
    onHandlePointerDown,
    dragging = false,
    edge,
}) => {
    const isColumn = edge === 'column';
    const canAdd = isColumn ? availability.canAddColumn : availability.canAddRow;
    const canRemove = isColumn
        ? availability.canRemoveColumn
        : availability.canRemoveRow;
    const count = isColumn ? dimensions.columns : dimensions.rows;

    const removeLabel = isColumn
        ? tWithParams('grid_remove_column_tooltip', { count })
        : tWithParams('grid_remove_row_tooltip', { count });
    const handleLabel = canAdd
        ? tWithParams(
              isColumn ? 'grid_handle_column_tooltip' : 'grid_handle_row_tooltip',
              { count }
          )
        : tWithParams(
              isColumn ? 'grid_handle_column_max_tooltip' : 'grid_handle_row_max_tooltip',
              { count }
          );

    return (
        <div
            className={[
                'ocap-grid-resize',
                `ocap-grid-resize--${edge}`,
                dragging && 'ocap-grid-resize--dragging',
            ]
                .filter(Boolean)
                .join(' ')}
            role="group"
            aria-label={t(isColumn ? 'grid_columns' : 'grid_rows')}
        >
            <ResizeButton
                icon="minus"
                label={removeLabel}
                disabled={!onResize || !canRemove}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onResize?.(edge, -1);
                }}
            />
            <ResizeButton
                icon="plus"
                className={[
                    'ocap-grid-resize-handle',
                    !canAdd && 'ocap-grid-resize-handle--at-max',
                ]
                    .filter(Boolean)
                    .join(' ')}
                label={handleLabel}
                // Never disabled while resizing is possible at all: a disabled
                // button receives no pointer events, and at the maximum the
                // handle is the only way back down.
                disabled={!onResize}
                onPointerDown={(event) => onHandlePointerDown?.(edge, event)}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    // Pointer input is served by the drag layer's pointer-up,
                    // which also knows whether the press became a drag. Only a
                    // KEYBOARD activation (detail === 0) has no pointer-up to
                    // be served by, so it acts here.
                    if (event.detail === 0 && canAdd) {
                        onResize?.(edge, 1);
                    }
                }}
            />
        </div>
    );
};

/**
 * The size readout that follows a resize drag: `columns × rows`, the reading
 * order every spreadsheet and Notion uses.
 *
 * It is absolutely positioned inside the grid frame and therefore cannot push
 * anything around — a readout that reflowed the grid it describes would fight
 * the very preview it is annotating.
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
