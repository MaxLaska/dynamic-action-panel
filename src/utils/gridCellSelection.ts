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
// - the three gestures are fixed: REPLACE, ADD (Shift), REMOVE (Ctrl/Cmd).
//   Shift never deselects, Ctrl never selects, and there is no toggle. Since
//   2026-09-19 a plain CLICK on a cell no longer produces `replace` — it runs
//   the tool (see `gridPointerIntent`); since 2026-09-20 the palette speaks the
//   same three gestures too (`cellPaletteAction.ts`), so `replace` is left as
//   the set operation of a rectangle's live preview;
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
 * `replace` is an unmodified activation, `add` is Shift, `remove` is Ctrl (Cmd on
 * macOS). There is deliberately no `toggle`.
 */
export type CellSelectionGesture = 'replace' | 'add' | 'remove';

/** A stable string key for one grid context. Length-prefixed, so no id can
 * collide with another merely by containing the separator. */
export function gridContextKey(context: GridSelectionContextKey): string {
    return `${context.categoryId.length}:${context.categoryId}:${context.variantId ?? ''}`;
}

/**
 * Counts the VISIBLE, interactive renderings each grid currently has.
 *
 * A selection may only outlive its grid's last such rendering — but an unmount
 * on its own does not mean the grid is gone. React rebuilds a whole subtree
 * whenever the element TYPE at a position changes, and list view does exactly
 * that while a tool is being dragged (`categorySortEnabled` excludes an active
 * button drag, so the category block switches between a sortable block and a
 * plain div). The grid is then torn down and rebuilt mid-gesture, which is
 * indistinguishable from disappearing if you only watch unmounts.
 *
 * Counting separates the two: a rebuild deregisters and registers again within
 * the same commit, so the count is back above zero by the time anyone asks.
 * The asking is deliberately left to the caller, which defers it by a turn.
 */
export interface GridInstanceCounter {
    /** Announce a rendering; the returned function takes it back. */
    register(context: GridSelectionContextKey): () => void;
    /** How many renderings that grid has right now. */
    liveCount(context: GridSelectionContextKey): number;
}

export function createGridInstanceCounter(): GridInstanceCounter {
    const counts = new Map<string, number>();
    return {
        register(context) {
            const key = gridContextKey(context);
            counts.set(key, (counts.get(key) ?? 0) + 1);
            let released = false;
            return () => {
                if (released) {
                    return;
                }
                released = true;
                counts.set(key, Math.max(0, (counts.get(key) ?? 0) - 1));
            };
        },
        liveCount(context) {
            return counts.get(gridContextKey(context)) ?? 0;
        },
    };
}

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

/**
 * Whether a pointer activation was a click rather than the end of a drag.
 *
 * A keyboard activation (Enter/Space on a focused tool) reports `detail === 0`
 * and never travelled, so it always is. A pointer has to prove it: it must
 * still have a remembered press (an activated drag forgets it on purpose,
 * because a drag that comes back ends near its start) and must have travelled
 * no further than the drag sensor's own euclidean threshold, so "click" and
 * "drag" stay exact complements with nothing falling between them.
 */
export function isClickNotDrag(
    detail: number,
    origin: { x: number; y: number } | null,
    point: { x: number; y: number },
    threshold: number
): boolean {
    if (detail === 0) {
        return true;
    }
    if (origin === null) {
        return false;
    }
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    return Math.sqrt(dx * dx + dy * dy) <= threshold;
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
 * Cross-grid rule (2026-09-19): there is exactly ONE active selection
 * context in the panel, and a selection never spans two grids.
 *
 * - `add` (Shift) on another grid MOVES the context there: the old selection
 *   is dropped and this grid starts a new one. Shift is how a user says
 *   "select here", and since a plain click runs the tool, it is the only way
 *   to begin a selection in a second grid at all;
 * - `remove` (Ctrl/Cmd) on another grid is a NO-OP. It can only take away from
 *   what exists, and there is nothing of this grid's to take away — it must
 *   neither move the context nor touch the other grid's cells;
 * - `replace` always re-homes (a rectangle's live preview, which replaces the
 *   whole selection with baseline ± rectangle on every move).
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

    if (foreign) {
        // Shift moves the one context here; Ctrl never reaches across.
        return gesture === 'add' ? nextState(state, context, new Set([cell])) : state;
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
 * same-color selection (plain or Shift adds a colour's cells, Ctrl/Cmd takes
 * them out again).
 * Same cross-grid rule as `applyCellGesture`: an `add` from another grid moves
 * the context here, a `remove` from another grid does nothing.
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
        return gesture === 'add' ? nextState(state, context, new Set(cells)) : state;
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
