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
import { cellPaletteMeaning } from '@/utils/cellPaletteAction';
import type { CellPaintColor } from '@/contexts/GridCellSelectionContext';
import { useSelectionModifierIntent } from '@/components/buttons-panel/CellSelectionModifierCursor';
import { t, tWithParams } from '@/utils/i18n';

interface CellColorPaletteProps {
    /** Cell metadata of exactly the grid on screen. */
    cellStyles?: GridCellStyles;
    /** Dimensions of exactly that grid — the search space of a color pick. */
    dimensions: GridDimensions;
    /** Cells currently selected in this grid. */
    selectedCells: ReadonlySet<GridCellKey>;
    /**
     * Choose this color (null = no color) as the paint colour, and write it
     * onto every selected cell if there is a selection.
     */
    onApply: (color: string | null) => void;
    /** The colour armed right now, or null when none is — shown on its swatch. */
    paint: CellPaintColor | null;
    /** Select: add this color's cells to the selection, or take them out of it. */
    onSelectByColor: (cells: GridCellKey[], gesture: CellSelectionGesture) => void;
}

/**
 * The cell color palette of ONE grid.
 *
 * It is OPERATIVE, not an edit affordance: it is available in locked and edit
 * mode alike, because colouring and choosing cells do not change the layout.
 *
 * It sits below the grid and is mounted whenever selection is available rather than
 * appearing with the first selection — for two concrete reasons:
 *
 * 1. A bar that appears on the first click pushes the grid down UNDER the
 *    pointer, so the next Shift-click lands on the wrong cell.
 * 2. A swatch works before anything is selected: a plain click there CHOOSES
 *    the paint colour, which the next Shift gesture in the grid carries. A bar
 *    that only exists once a selection does could not offer that.
 *
 * The grammar (`cellPaletteMeaning`): a plain click chooses this colour — and
 * paints the selection with it if there is one — while Shift adds that
 * colour's cells to the selection and Ctrl/Cmd takes them out again. Which
 * makes the bar safe to explore: **only a plain click with a selection present
 * writes anything.** The modifier gestures only move the selection around,
 * always inside the grid on screen and never across variants or categories.
 */
export const CellColorPalette: React.FC<CellColorPaletteProps> = ({
    cellStyles,
    dimensions,
    selectedCells,
    onApply,
    onSelectByColor,
    paint,
}) => {
    const hasSelection = selectedCells.size > 0;
    const summary = React.useMemo(
        () => selectionColorSummary(cellStyles, selectedCells),
        [cellStyles, selectedCells]
    );
    // The keys held right now, from the same tracker the cursor uses, so the
    // tooltip below says what THIS press would do — and changes the moment a
    // modifier goes down or up, without the mouse having to move.
    const heldIntent = useSelectionModifierIntent();

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
        const meaning = cellPaletteMeaning(gesture, hasSelection, value === null);
        if (meaning.arms) {
            // `apply` and `arm` alike: choosing the colour is the same act,
            // and the grid paints the selection only if there is one.
            onApply(value);
            return;
        }
        if (meaning.gesture === null) {
            return;
        }
        onSelectByColor(cellsWithColor(cellStyles, dimensions, value), meaning.gesture);
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
                    // Two different things, deliberately drawn differently:
                    // what the SELECTION currently is (a quiet rim), and what
                    // the next paint WILL be (the ring). They name the same
                    // swatch whenever a colour was just applied.
                    const uniform = !summary.mixed && summary.color === entry.value;
                    const armed = paint !== null && paint.color === entry.value;
                    const label = t(entry.labelKey);
                    // One sentence: what a click does now. Not a manual of
                    // everything the swatch could do in some other state.
                    const tooltip = tWithParams(
                        cellPaletteMeaning(heldIntent ?? 'replace', hasSelection, entry.value === null)
                            .tooltipKey,
                        { color: label.toLocaleLowerCase() }
                    );
                    return (
                        <button
                            key={entry.value ?? 'none'}
                            type="button"
                            className={[
                                'ocap-cell-swatch',
                                entry.value === null ? 'ocap-cell-swatch--none' : '',
                                uniform ? 'ocap-cell-swatch--uniform' : '',
                                armed ? 'ocap-cell-swatch--armed' : '',
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            style={
                                fill
                                    ? ({ '--ocap-swatch-color': fill } as React.CSSProperties)
                                    : undefined
                            }
                            aria-label={label}
                            // The swatch behaves like a chosen tool, so the
                            // pressed state is the ARMED colour, not what the
                            // selection happens to be.
                            aria-pressed={armed}
                            title={tooltip}
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
