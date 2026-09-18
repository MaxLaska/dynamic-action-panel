import React from 'react';
import type { GridCellKey, GridCellStyles } from '@/types/settings';
import type { GridDimensions } from '@/utils/categoryGrid';
import {
    CELL_COLOR_PALETTE,
    resolveGridCellSwatchCss,
} from '@/utils/gridCellColor';
import {
    cellsWithColor,
    selectionColorSummary,
    type CellSelectionGesture,
} from '@/utils/gridCellSelection';
import { gestureOfEvent } from '@/utils/cellSelectionGesture';
import { t, tWithParams } from '@/utils/i18n';

interface CellColorPaletteProps {
    /** Cell metadata of exactly the grid on screen. */
    cellStyles?: GridCellStyles;
    /** Dimensions of exactly that grid — the search space of a color pick. */
    dimensions: GridDimensions;
    /** Cells currently selected in this grid. */
    selectedCells: ReadonlySet<GridCellKey>;
    /** Plain click: write this color (null clears) onto every selected cell. */
    onApply: (color: string | null) => void;
    /** Modifier click: change the SELECTION to the cells carrying this color. */
    onSelectByColor: (cells: GridCellKey[], gesture: CellSelectionGesture) => void;
}

/**
 * The cell color palette of ONE grid.
 *
 * It sits below the grid and is mounted for the whole of edit mode rather than
 * appearing with the first selection — for two concrete reasons:
 *
 * 1. A bar that appears on the first click pushes the grid down UNDER the
 *    pointer, so the next Shift-click lands on the wrong cell.
 * 2. `Ctrl + swatch` is a SELECTION tool and has to work before anything is
 *    selected. A bar that only exists once a selection does could not offer it.
 *
 * The one rule that makes the bar safe to explore:
 * **a modifier on a swatch never writes.** A plain click is the only gesture
 * here that changes the configuration; Shift and Ctrl only move the selection
 * around, always inside the grid on screen and never across variants or
 * categories.
 */
export const CellColorPalette: React.FC<CellColorPaletteProps> = ({
    cellStyles,
    dimensions,
    selectedCells,
    onApply,
    onSelectByColor,
}) => {
    const hasSelection = selectedCells.size > 0;
    const summary = React.useMemo(
        () => selectionColorSummary(cellStyles, selectedCells),
        [cellStyles, selectedCells]
    );

    const handleClick = (
        event: React.MouseEvent<HTMLButtonElement>,
        value: string | null
    ) => {
        event.preventDefault();
        event.stopPropagation();
        const gesture = gestureOfEvent(event);
        if (gesture === null) {
            return;
        }
        if (gesture === 'replace') {
            // The ONE writing gesture. With nothing selected there is no target,
            // so it does nothing rather than guessing one.
            if (hasSelection) {
                onApply(value);
            }
            return;
        }
        // Ctrl replaces the selection with every cell of this color, Shift adds
        // them to it — so `Ctrl red` then `Shift blue` selects both groups.
        onSelectByColor(
            cellsWithColor(cellStyles, dimensions, value),
            gesture === 'remove' ? 'replace' : 'add'
        );
    };

    return (
        <div
            className={[
                'ocap-cell-palette',
                hasSelection ? '' : 'ocap-cell-palette--idle',
            ]
                .filter(Boolean)
                .join(' ')}
            role="group"
            aria-label={t('cell_color_palette')}
        >
            <span className="ocap-cell-palette-count" role="status" aria-live="polite">
                {hasSelection
                    ? tWithParams('cell_selection_count', { count: selectedCells.size })
                    : t('cell_selection_none')}
            </span>
            <div className="ocap-cell-palette-swatches">
                {CELL_COLOR_PALETTE.map((entry) => {
                    const fill = resolveGridCellSwatchCss(entry.value);
                    const active = !summary.mixed && summary.color === entry.value;
                    const label = t(entry.labelKey);
                    return (
                        <button
                            key={entry.value ?? 'none'}
                            type="button"
                            className={[
                                'ocap-cell-swatch',
                                entry.value === null ? 'ocap-cell-swatch--none' : '',
                                active ? 'ocap-cell-swatch--active' : '',
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            style={
                                fill
                                    ? ({ '--ocap-swatch-color': fill } as React.CSSProperties)
                                    : undefined
                            }
                            aria-label={label}
                            aria-pressed={active}
                            title={`${label} — ${t('cell_color_swatch_hint')}`}
                            // Same reason the slot `+` swallows its press: in
                            // list view the whole category block is a drag
                            // handle, and a press that bubbles starts dragging
                            // the category instead of using the palette.
                            onPointerDown={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            onTouchStart={(event) => event.stopPropagation()}
                            onClick={(event) => handleClick(event, entry.value)}
                        />
                    );
                })}
            </div>
        </div>
    );
};
