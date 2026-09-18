// gridCellSelection.ts
// Pure core of the grid CELL selection — the generic batch-selection mechanism
// whose first consumer is cell colors.
//
// Product model (see docs/ocap/cell-selection-colors.md):
// - the selection unit is the CELL COORDINATE (`r<row>c<column>`), never a tool
//   id and never the flat slot index. Only a coordinate can address an EMPTY
//   cell, only a coordinate survives a resize unchanged, and it is exactly the
//   key `cellStyles` is already stored under;
// - a selection lives in exactly ONE grid context `(categoryId, variantId)`.
//   `variantId === null` means the static grid of that category;
// - at most one grid in the panel carries a selection — there is no hidden
//   multi-grid selection state;
// - the three gestures are fixed: plain click REPLACES, Shift ADDS, Ctrl/Cmd
//   REMOVES. Shift never deselects, Ctrl never selects, and there is no toggle;
// - the selection is ephemeral UI state. Nothing here touches, reads or
//   produces persisted settings, and no type in this module is allowed into
//   `src/types/settings.ts`.
//
// Everything is pure and immutable: an operation that changes nothing returns
// the very same state object, so memoized React subtrees stay stable.

import type { GridCellKey, GridCellStyle, GridCellStyles } from '@/types/settings';
import {
    gridCellKey,
    isCellKeyInsideGrid,
    parseGridCellKey,
    type GridDimensions,
} from '@/utils/categoryGrid';

/**
 * The ONE grid a cell selection lives in — the owner of `cellStyles`, `rows`
 * and `columns`.
 *
 * `variantId === null` means the category's own static grid; a non-null id
 * means that variant's own grid. The pair is deliberately explicit: in the
 * domain layer a `null` variant id is NOT self-validating (it is read as "the
 * first variant" for a dynamic category), so every consumer must carry the
 * stricter reading itself.
 */
export interface GridSelectionContextKey {
    categoryId: string;
    variantId: string | null;
}

/**
 * The panel's cell selection.
 *
 * `context === null` means nothing is selected anywhere. A non-null context
 * with an empty `cells` set is the same thing expressed after the last cell was
 * removed, and is normalized back to `NO_CELL_SELECTION` by the operations
 * below so the two can never drift apart.
 */
export interface GridCellSelectionState {
    context: GridSelectionContextKey | null;
    cells: ReadonlySet<GridCellKey>;
}

const EMPTY_CELLS: ReadonlySet<GridCellKey> = new Set<GridCellKey>();

/** Nothing selected, in no grid. */
export const NO_CELL_SELECTION: GridCellSelectionState = {
    context: null,
    cells: EMPTY_CELLS,
};

/**
 * The three decided gestures.
 *
 * `replace` is the plain click, `add` is Shift, `remove` is Ctrl (Cmd on
 * macOS). There is deliberately no `toggle`.
 */
export type CellSelectionGesture = 'replace' | 'add' | 'remove';

/** The modifier state of one activation, however it was produced. */
export interface SelectionModifierFlags {
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
}

/**
 * The gesture an activation means, or null when it means nothing at all.
 *
 * Fixed semantics: plain = replace, Shift = add, Ctrl = remove. Shift and Ctrl
 * together resolve to `add` — Shift wins, deterministically, because the
 * combination has no meaning of its own in v1 and the additive reading is the
 * one that cannot destroy a selection by accident.
 *
 * macOS: Ctrl+click is the SECONDARY click there and opens a context menu, so
 * it must never also change the selection — it returns null and the activation
 * is ignored. Cmd takes the subtractive role instead. The product semantics are
 * identical on both platforms; only the key carrying "remove" differs.
 */
export function cellGestureOf(
    flags: SelectionModifierFlags,
    isMac: boolean
): CellSelectionGesture | null {
    if (isMac && flags.ctrlKey) {
        return null;
    }
    if (flags.shiftKey) {
        return 'add';
    }
    if (isMac ? flags.metaKey : flags.ctrlKey) {
        return 'remove';
    }
    return 'replace';
}

/** Whether an activation carries a modifier that makes it a selection edit. */
export function hasSelectionModifierFlags(
    flags: SelectionModifierFlags,
    isMac: boolean
): boolean {
    const gesture = cellGestureOf(flags, isMac);
    return gesture === null || gesture !== 'replace';
}

/** Whether two grid contexts address the same grid. */
export function sameSelectionContext(
    a: GridSelectionContextKey | null,
    b: GridSelectionContextKey | null
): boolean {
    if (a === null || b === null) {
        return a === b;
    }
    return a.categoryId === b.categoryId && a.variantId === b.variantId;
}

/** The selected cells of `context`, empty when another grid holds the selection. */
export function selectedCellsOf(
    state: GridCellSelectionState,
    context: GridSelectionContextKey
): ReadonlySet<GridCellKey> {
    return sameSelectionContext(state.context, context) ? state.cells : EMPTY_CELLS;
}

/** Whether `context` is the grid that currently holds the selection. */
export function holdsSelection(
    state: GridCellSelectionState,
    context: GridSelectionContextKey
): boolean {
    return sameSelectionContext(state.context, context) && state.cells.size > 0;
}

function sameCellSet(a: ReadonlySet<GridCellKey>, b: ReadonlySet<GridCellKey>): boolean {
    if (a === b) {
        return true;
    }
    if (a.size !== b.size) {
        return false;
    }
    for (const cell of a) {
        if (!b.has(cell)) {
            return false;
        }
    }
    return true;
}

/**
 * Builds the next state, normalizing an empty result to NO_CELL_SELECTION and
 * preserving identity when nothing actually changed.
 */
function nextState(
    previous: GridCellSelectionState,
    context: GridSelectionContextKey,
    cells: ReadonlySet<GridCellKey>
): GridCellSelectionState {
    if (cells.size === 0) {
        return previous.context === null ? previous : NO_CELL_SELECTION;
    }
    if (
        sameSelectionContext(previous.context, context) &&
        sameCellSet(previous.cells, cells)
    ) {
        return previous;
    }
    return { context: { ...context }, cells };
}

/**
 * Applies ONE gesture to ONE cell.
 *
 * Cross-grid rule: a plain click always moves the selection to the clicked
 * grid, but Shift and Ctrl are inert on a grid that does not already hold the
 * selection — otherwise a modifier click in grid B would extend (or silently
 * re-home) a selection the user is looking at in grid A. A modifier on a grid
 * where nothing is selected yet still works, because there is no other
 * selection it could reach across to.
 */
export function applyCellGesture(
    state: GridCellSelectionState,
    context: GridSelectionContextKey,
    cell: GridCellKey,
    gesture: CellSelectionGesture
): GridCellSelectionState {
    const foreign = state.context !== null && !sameSelectionContext(state.context, context);

    if (gesture === 'replace') {
        return nextState(state, context, new Set([cell]));
    }

    // Shift/Ctrl never reach across grids.
    if (foreign) {
        return state;
    }

    const current = selectedCellsOf(state, context);

    if (gesture === 'add') {
        if (current.has(cell)) {
            return state;
        }
        const next = new Set(current);
        next.add(cell);
        return nextState(state, context, next);
    }

    // remove
    if (!current.has(cell)) {
        return state;
    }
    const next = new Set(current);
    next.delete(cell);
    return nextState(state, context, next);
}

/**
 * Applies a gesture to a whole SET of cells at once — the palette's
 * same-color selection (Ctrl replaces with, Shift adds, all cells of a color).
 */
export function applyCellSetGesture(
    state: GridCellSelectionState,
    context: GridSelectionContextKey,
    cells: readonly GridCellKey[],
    gesture: CellSelectionGesture
): GridCellSelectionState {
    const foreign = state.context !== null && !sameSelectionContext(state.context, context);

    if (gesture === 'replace') {
        return nextState(state, context, new Set(cells));
    }
    if (foreign) {
        return state;
    }

    const current = selectedCellsOf(state, context);
    const next = new Set(current);
    if (gesture === 'add') {
        for (const cell of cells) {
            next.add(cell);
        }
    } else {
        for (const cell of cells) {
            next.delete(cell);
        }
    }
    if (sameCellSet(current, next)) {
        return state;
    }
    return nextState(state, context, next);
}

/**
 * Drops the selection when it belongs to `context`; leaves another grid's
 * selection alone. Used when a grid stops being selectable (mode change,
 * variant switch, collapse, unmount).
 */
export function clearSelectionOf(
    state: GridCellSelectionState,
    context: GridSelectionContextKey
): GridCellSelectionState {
    return sameSelectionContext(state.context, context) ? NO_CELL_SELECTION : state;
}

/** Every cell key of a grid, row-major. */
export function allGridCellKeys(dimensions: GridDimensions): GridCellKey[] {
    const keys: GridCellKey[] = [];
    for (let row = 0; row < dimensions.rows; row += 1) {
        for (let column = 0; column < dimensions.columns; column += 1) {
            keys.push(gridCellKey(row, column));
        }
    }
    return keys;
}

/** Cell keys in reading order (row, then column). Unparseable keys sort last. */
export function sortCellKeysRowMajor(cells: Iterable<GridCellKey>): GridCellKey[] {
    return [...cells].sort((a, b) => {
        const left = parseGridCellKey(a);
        const right = parseGridCellKey(b);
        if (left === null || right === null) {
            if (left === right) return a < b ? -1 : a > b ? 1 : 0;
            return left === null ? 1 : -1;
        }
        if (left.row !== right.row) return left.row - right.row;
        return left.column - right.column;
    });
}

/**
 * The selection restricted to the cells a grid of `dimensions` actually has.
 *
 * Derived on READ rather than maintained by an effect: a grid can shrink from
 * outside this panel (a second leaf, a sync, an import), and a pruning that has
 * to be remembered can be forgotten. Shrinking therefore drops exactly the
 * strip the tools and the cell colors are cut from too.
 */
export function pruneToDimensions(
    cells: ReadonlySet<GridCellKey>,
    dimensions: GridDimensions
): ReadonlySet<GridCellKey> {
    let allInside = true;
    for (const cell of cells) {
        if (!isCellKeyInsideGrid(cell, dimensions)) {
            allInside = false;
            break;
        }
    }
    if (allInside) {
        return cells;
    }
    const next = new Set<GridCellKey>();
    for (const cell of cells) {
        if (isCellKeyInsideGrid(cell, dimensions)) {
            next.add(cell);
        }
    }
    return next;
}

/**
 * The color of ONE cell, normalized.
 *
 * "No color" has two possible representations in stored data — an absent entry
 * and an entry without a `color` field (the template parser can produce
 * `styles[key] = {}`) — and this is the ONE accessor that flattens both to
 * `null`, so no caller has to know.
 */
export function gridCellColorOf(
    styles: GridCellStyles | undefined,
    cell: GridCellKey
): string | null {
    const entry: GridCellStyle | undefined = styles?.[cell];
    const color = entry?.color;
    return typeof color === 'string' && color.length > 0 ? color : null;
}

/**
 * All cells of the grid carrying exactly `color` (`null` = uncolored), in
 * reading order.
 *
 * Iterates the GRID, not the sparse style map: "every uncolored cell" has to be
 * answerable, and cells outside the current dimensions must never be returned.
 * The comparison runs on the RAW stored value, never on resolved CSS, so
 * `ocap:red` and a hex literal that happens to look the same stay different
 * colors.
 */
export function cellsWithColor(
    styles: GridCellStyles | undefined,
    dimensions: GridDimensions,
    color: string | null
): GridCellKey[] {
    return allGridCellKeys(dimensions).filter(
        (cell) => gridCellColorOf(styles, cell) === color
    );
}

/** What the palette shows as active for the current selection. */
export interface SelectionColorSummary {
    /** The one color all selected cells share (`null` = all uncolored). */
    color: string | null;
    /** True when the selection mixes colors, or when nothing is selected. */
    mixed: boolean;
}

/**
 * The common color of a selection.
 *
 * `mixed` is also true for an empty selection: there is then no value to show
 * as active, which is exactly what the palette needs to know. A selection of
 * cells that all carry an unlisted but valid color (`ocap:orange`, a hex
 * literal) reports that color — the palette must not promote a look-alike
 * swatch to "active" just because the real value has no swatch.
 */
export function selectionColorSummary(
    styles: GridCellStyles | undefined,
    cells: ReadonlySet<GridCellKey>
): SelectionColorSummary {
    if (cells.size === 0) {
        return { color: null, mixed: true };
    }
    let first: string | null = null;
    let seen = false;
    for (const cell of cells) {
        const color = gridCellColorOf(styles, cell);
        if (!seen) {
            first = color;
            seen = true;
            continue;
        }
        if (color !== first) {
            return { color: null, mixed: true };
        }
    }
    return { color: first, mixed: false };
}
