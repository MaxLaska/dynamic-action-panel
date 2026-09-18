// GridCellSelectionContext.tsx
// Distributes the panel's ephemeral CELL selection.
//
// The state itself is owned by PanelContent — same lifetime, same scope and
// same reasoning as the variant selection next to it: it has to survive every
// commit (applying a color re-renders the whole panel, and the user is usually
// about to try a second color), and at most one grid may hold it.
//
// Naming: `selection` / `selectVariant` already mean the VARIANT selection in
// this codebase. Everything here is therefore `cellSelection` / `GridCellSelection…`;
// a bare `selection` must not appear in cell-selection code.
//
// Nothing in this file decides anything: the rules are pure functions in
// src/utils/gridCellSelection.ts, and nothing here ever reaches settings.

import React, { createContext, useContext } from 'react';
import type { GridCellKey } from '@/types/settings';
import {
    NO_CELL_SELECTION,
    selectedCellsOf,
    type CellSelectionGesture,
    type GridCellSelectionState,
    type GridSelectionContextKey,
} from '@/utils/gridCellSelection';

/**
 * The colour the current selection session paints with, or null when none is
 * armed.
 *
 * A wrapper object rather than a bare `string | null`, because "no colour" is
 * itself a deliberate, armable choice: `{ color: null }` means "cells I add
 * from now on become uncoloured", while `null` means nothing is armed at all
 * and an additive gesture leaves the colours alone.
 */
export interface CellPaintColor {
    color: string | null;
}

interface GridCellSelectionValue {
    state: GridCellSelectionState;
    /** One gesture on one cell (plain click / Shift / Ctrl). */
    selectCell: (
        context: GridSelectionContextKey,
        cell: GridCellKey,
        gesture: CellSelectionGesture
    ) => void;
    /** One gesture on a whole set — the palette's same-color selection. */
    selectCells: (
        context: GridSelectionContextKey,
        cells: readonly GridCellKey[],
        gesture: CellSelectionGesture
    ) => void;
    /** Drop the selection entirely (Escape, mode change). */
    clearCellSelection: () => void;
    /**
     * Announce that a VISIBLE, interactive rendering of this grid exists.
     *
     * The returned cleanup says it is gone again. The selection is dropped when
     * the last such rendering disappears — checked one turn later, so a grid
     * that is merely REMOUNTED keeps its selection.
     *
     * That distinction is not academic: in list view the category block changes
     * element type while a tool is being dragged
     * (`categorySortEnabled = … && !buttonDrag.isDragging`), so React tears the
     * whole grid down and rebuilds it. An unmount alone therefore cannot mean
     * "this grid is gone".
     */
    registerSelectableGrid: (context: GridSelectionContextKey) => () => void;
    /**
     * The colour armed for this selection session (see CellPaintColor).
     *
     * Ephemeral like the selection itself and scoped to it: applying a colour
     * arms it, and it is dropped the moment the selection is cleared or moves
     * to another grid. It is never persisted — not in `data.json`, not in the
     * settings, not in a template. There is deliberately no permanent "paint
     * tool" mode; this is a property of one selection, not of the panel.
     */
    paint: CellPaintColor | null;
    /** Arm (or, with null, disarm) the session's paint colour. */
    armPaint: (paint: CellPaintColor | null) => void;
    /**
     * A modifier rectangle gesture is running.
     *
     * Escape then means "cancel this rectangle and go back to the baseline",
     * which is the gesture's own business — so the panel's Escape handler
     * stands down while this is true, the same way it stands down for a drag.
     */
    cellGestureActive: boolean;
    setCellGestureActive: (active: boolean) => void;
}

const DEFAULT_VALUE: GridCellSelectionValue = {
    state: NO_CELL_SELECTION,
    selectCell: () => {},
    selectCells: () => {},
    clearCellSelection: () => {},
    registerSelectableGrid: () => () => {},
    paint: null,
    armPaint: () => {},
    cellGestureActive: false,
    setCellGestureActive: () => {},
};

const GridCellSelectionContext = createContext<GridCellSelectionValue>(DEFAULT_VALUE);

export const GridCellSelectionProvider: React.FC<
    React.PropsWithChildren<GridCellSelectionValue>
> = ({
    state,
    selectCell,
    selectCells,
    clearCellSelection,
    registerSelectableGrid,
    paint,
    armPaint,
    cellGestureActive,
    setCellGestureActive,
    children,
}) => {
    const value = React.useMemo(
        () => ({
            state,
            selectCell,
            selectCells,
            clearCellSelection,
            registerSelectableGrid,
            paint,
            armPaint,
            cellGestureActive,
            setCellGestureActive,
        }),
        [
            state,
            selectCell,
            selectCells,
            clearCellSelection,
            registerSelectableGrid,
            paint,
            armPaint,
            cellGestureActive,
            setCellGestureActive,
        ]
    );
    return (
        <GridCellSelectionContext.Provider value={value}>
            {children}
        </GridCellSelectionContext.Provider>
    );
};

export function useGridCellSelection(): GridCellSelectionValue {
    return useContext(GridCellSelectionContext);
}

/**
 * The cells selected in ONE grid — empty whenever another grid holds the
 * selection, so a renderer can never accidentally show a foreign selection.
 */
export function useSelectedCellsOf(
    categoryId: string,
    variantId: string | null
): ReadonlySet<GridCellKey> {
    const { state } = useGridCellSelection();
    return React.useMemo(
        () => selectedCellsOf(state, { categoryId, variantId }),
        [state, categoryId, variantId]
    );
}

/**
 * Whether anything is selected anywhere.
 *
 * Used by handlers that must yield to the selection before doing their own
 * thing — the folder overlay's Escape being the one that matters: clearing a
 * selection must never also close the folder the user is working in.
 */
export function useHasCellSelection(): boolean {
    return useGridCellSelection().state.cells.size > 0;
}
