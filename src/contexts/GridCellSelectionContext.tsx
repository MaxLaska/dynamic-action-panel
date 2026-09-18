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
    /** Drop it only if it belongs to this grid (a grid stops being selectable). */
    exitCellSelectionOf: (context: GridSelectionContextKey) => void;
}

const DEFAULT_VALUE: GridCellSelectionValue = {
    state: NO_CELL_SELECTION,
    selectCell: () => {},
    selectCells: () => {},
    clearCellSelection: () => {},
    exitCellSelectionOf: () => {},
};

const GridCellSelectionContext = createContext<GridCellSelectionValue>(DEFAULT_VALUE);

export const GridCellSelectionProvider: React.FC<
    React.PropsWithChildren<GridCellSelectionValue>
> = ({
    state,
    selectCell,
    selectCells,
    clearCellSelection,
    exitCellSelectionOf,
    children,
}) => {
    const value = React.useMemo(
        () => ({
            state,
            selectCell,
            selectCells,
            clearCellSelection,
            exitCellSelectionOf,
        }),
        [state, selectCell, selectCells, clearCellSelection, exitCellSelectionOf]
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
