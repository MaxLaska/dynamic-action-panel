// GridContextTarget.tsx
// The seam between the grid, which knows the selection, and the tool, which
// knows it was right-clicked.
//
// The grid publishes ONE function: given a cell and a tool, what is this click
// about (`resolveContextTarget`). Each slot binds its own cell key on the way
// down, so the tool inside it does not need to know where it sits — and, more
// importantly, does not have to go looking in the DOM for it.
//
// Nothing here holds state. The resolver reads the grid's CURRENT selection
// when it is called, not when it was created, so a menu opened after the
// selection changed still describes the selection as it is.

import React from 'react';
import type { GridCellKey } from '@/types/settings';
import {
    toolOnlyContextTarget,
    type ContextTarget,
} from '@/utils/contextTarget';

/** Answers for any cell of the grid that provided it. */
export type GridTargetResolver = (
    clickedCell: GridCellKey | null,
    clickedToolId: string | null
) => ContextTarget;

const GridTargetResolverContext = React.createContext<GridTargetResolver | null>(null);
const GridCellKeyContext = React.createContext<GridCellKey | null>(null);

export const GridTargetResolverProvider = GridTargetResolverContext.Provider;
export const GridCellKeyProvider = GridCellKeyContext.Provider;

/**
 * What a right click on `toolId` is about, resolved fresh at call time.
 *
 * Outside a grid — a flow category, the overflow row, the folder view — there
 * is no cell and no cell selection, so the answer is a plain tool context. The
 * caller gets the same shape either way and never has to special-case it.
 */
export function useContextTarget(): (toolId: string | null) => ContextTarget {
    const resolve = React.useContext(GridTargetResolverContext);
    const cellKey = React.useContext(GridCellKeyContext);
    return React.useCallback(
        (toolId: string | null) =>
            resolve === null ? toolOnlyContextTarget(toolId) : resolve(cellKey, toolId),
        [resolve, cellKey]
    );
}
