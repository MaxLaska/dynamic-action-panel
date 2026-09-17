import React from 'react';
import { setIcon } from 'obsidian';
import { t, tWithParams } from '@/utils/i18n';
import type { GridResizeDirection, GridResizeEdge } from '@/utils/categoryVariants';
import type { GridResizeAvailability } from '@/hooks/useGridResize';
import type { GridDimensions } from '@/utils/categoryGrid';

interface ResizeButtonProps {
    icon: 'plus' | 'minus';
    label: string;
    disabled: boolean;
    onClick: () => void;
}

/**
 * One resize control.
 *
 * Like the cell's `+` it must swallow its own press: in list view the whole
 * category block carries the category-drag listeners, so a bubbling press
 * would drag the category instead of resizing its grid.
 */
const ResizeButton: React.FC<ResizeButtonProps> = ({ icon, label, disabled, onClick }) => {
    const iconRef = React.useRef<HTMLSpanElement>(null);

    React.useEffect(() => {
        if (iconRef.current) {
            setIcon(iconRef.current, icon);
        }
    }, [icon]);

    const swallow = (event: React.SyntheticEvent) => {
        event.stopPropagation();
    };

    return (
        <button
            type="button"
            className="ocap-grid-resize-button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onPointerDown={swallow}
            onMouseDown={swallow}
            onTouchStart={swallow}
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onClick();
            }}
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
    /** 'column' renders the strip at the right edge, 'row' the one below. */
    edge: GridResizeEdge;
}

/**
 * The compact grid resize strips of edit mode: columns at the RIGHT edge, rows
 * BELOW the grid — the control sits where the thing it adds or removes
 * appears. Only the outermost column / row is addressable, which keeps the
 * model predictable (see planGridResizeStep).
 *
 * They are chrome AROUND the slot grid, never cells of it: they live outside
 * the `.ocap-palette-grid` element, so they cannot influence a row track, a
 * cell rect or a drag index. Nothing here may key on occupancy, target or
 * preview state — see tests/paletteGridGeometry.test.ts.
 */
export const GridResizeControls: React.FC<GridResizeControlsProps> = ({
    dimensions,
    availability,
    onResize,
    edge,
}) => {
    const isColumn = edge === 'column';
    const removeLabel = isColumn
        ? tWithParams('grid_remove_column_tooltip', { count: dimensions.columns })
        : tWithParams('grid_remove_row_tooltip', { count: dimensions.rows });
    const addLabel = isColumn
        ? tWithParams('grid_add_column_tooltip', { count: dimensions.columns })
        : tWithParams('grid_add_row_tooltip', { count: dimensions.rows });

    return (
        <div
            className={`ocap-grid-resize ocap-grid-resize--${edge}`}
            role="group"
            aria-label={t(isColumn ? 'grid_columns' : 'grid_rows')}
        >
            <ResizeButton
                icon="minus"
                label={removeLabel}
                disabled={
                    !onResize ||
                    (isColumn ? !availability.canRemoveColumn : !availability.canRemoveRow)
                }
                onClick={() => onResize?.(edge, -1)}
            />
            <ResizeButton
                icon="plus"
                label={addLabel}
                disabled={
                    !onResize ||
                    (isColumn ? !availability.canAddColumn : !availability.canAddRow)
                }
                onClick={() => onResize?.(edge, 1)}
            />
        </div>
    );
};
