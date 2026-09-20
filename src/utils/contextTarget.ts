// contextTarget.ts
// What a right click is ABOUT.
//
// A right click on a tool can mean two different things, and today the panel
// cannot tell them apart:
//   - the tool under the pointer          → a TOOL context;
//   - the selection the tool is part of   → a SELECTION context.
//
// This module answers that question and nothing else. It decides no actions,
// builds no menu, and — the hard rule — never changes the selection: a right
// click reads the selection, it does not replace, extend or clear it. What the
// two contexts eventually OFFER is a later question; the point of keeping the
// answer here is that whoever asks it later asks one function, not four
// components with four slightly different ideas of "the selection".
//
// Everything is pure: same inputs, same result, no React, no settings.

import type { GridCellKey } from '@/types/settings';
import { sortCellKeysRowMajor } from '@/utils/gridCellSelection';

/** Which of the two the click is about. */
export type ContextTargetKind = 'tool' | 'selection';

/** What the selection is, said in the terms a menu would need. */
export interface SelectionDescriptor {
    /** Selected cells in this grid — EMPTY ones included. */
    cellCount: number;
    /**
     * The tools those cells actually hold, in reading order and without
     * duplicates. Shorter than `cellCount` whenever empty cells are selected,
     * which is normal and not an error.
     */
    toolIds: string[];
}

/** The resolved answer, everything a caller needs and nothing it does not. */
export interface ContextTarget extends SelectionDescriptor {
    kind: ContextTargetKind;
    /** The cell the pointer was on, or null when it cannot be named. */
    clickedCell: GridCellKey | null;
    /** The tool under the pointer, or null on an empty cell. */
    clickedToolId: string | null;
    /** Whether that cell is part of the current selection. */
    clickedInSelection: boolean;
}

export interface ContextTargetInput {
    /** The cell under the pointer, or null (outside a grid, unknown slot). */
    clickedCell: GridCellKey | null;
    /** The tool under the pointer, or null for an empty cell. */
    clickedToolId: string | null;
    /** The selection OF THIS GRID. Another grid's selection is not passed in. */
    selectedCells: ReadonlySet<GridCellKey>;
    /** The tool of a cell, or null. Unknown cells must answer null, not throw. */
    toolIdOfCell: (cell: GridCellKey) => string | null;
}

/**
 * The selection, described.
 *
 * Deliberately tolerant: a cell that no longer holds anything, or holds
 * something the caller cannot name, simply contributes no tool id. A grid
 * remounts, a variant flips and a tool is deleted while a selection stands —
 * all three are ordinary, and none of them may produce a phantom id.
 */
export function getSelectionDescriptor(
    selectedCells: ReadonlySet<GridCellKey>,
    toolIdOfCell: (cell: GridCellKey) => string | null
): SelectionDescriptor {
    const toolIds: string[] = [];
    const seen = new Set<string>();
    for (const cell of sortCellKeysRowMajor(selectedCells)) {
        const toolId = toolIdOfCell(cell);
        if (toolId === null || toolId === '' || seen.has(toolId)) {
            continue;
        }
        seen.add(toolId);
        toolIds.push(toolId);
    }
    return { cellCount: selectedCells.size, toolIds };
}

/**
 * What the click is about.
 *
 * The rule is one line, and it is the whole product decision: a right click
 * INSIDE the current selection is about the selection; anywhere else — on an
 * unselected cell, or with nothing selected at all — it is about the tool
 * under the pointer. A click outside does NOT reduce the selection to the
 * clicked cell; it just is not talking about it.
 */
export function resolveContextTarget(input: ContextTargetInput): ContextTarget {
    const { clickedCell, clickedToolId, selectedCells, toolIdOfCell } = input;
    const descriptor = getSelectionDescriptor(selectedCells, toolIdOfCell);
    const clickedInSelection = clickedCell !== null && selectedCells.has(clickedCell);
    return {
        kind: clickedInSelection && descriptor.cellCount > 0 ? 'selection' : 'tool',
        clickedCell,
        clickedToolId,
        clickedInSelection,
        ...descriptor,
    };
}

/** The answer outside any grid — a flow category, the overflow row, a tab. */
export function toolOnlyContextTarget(clickedToolId: string | null): ContextTarget {
    return {
        kind: 'tool',
        clickedCell: null,
        clickedToolId,
        clickedInSelection: false,
        cellCount: 0,
        toolIds: [],
    };
}
