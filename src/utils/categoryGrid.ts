// categoryGrid.ts
// Pure slot logic for the OCAP palette grid.
//
// Product model (see docs/ocap/DECISIONS.md):
// - a grid category has `rows` x `columns` slots with stable identities
//   0..slotCount-1, read row-major (slot = row * columns + column);
// - the dimensions are part of the grid the user edits, are bounded by
//   1x1 .. 5x5, and are stored on that grid (see GridDimensionFields);
// - stored data WITHOUT dimensions is the historical fixed 4x4 grid, so absent
//   fields read as LEGACY_GRID_DIMENSIONS and existing panels keep their shape
//   without any migration. NEW grids start at DEFAULT_GRID_DIMENSIONS;
// - a slot holds at most one button, and an empty slot stays empty: buttons
//   never slide up to fill a hole, not after a reload, a context change, a
//   visibility change, a drag or an edit;
// - the slot is the future hotkey identity, so it must stay independent of
//   which button currently occupies it. A RESIZE is the one operation that may
//   renumber slots — and it does so coordinate-aware (see remapSlot), so a
//   button keeps its logical row/column even though its flat index changes.
//
// Representation: the slot lives on the button (`ButtonConfig.slot`). A hole is
// therefore unambiguous — slot i is empty iff no button of the category claims
// it — and it survives every operation that filters `category.buttons`
// (context projection, search) without any extra bookkeeping, because the
// surviving buttons keep their own slot.
//
// All functions here are pure and never mutate their inputs. Edits follow the
// immutable-edit convention from DECISIONS.md: a button whose content changes
// is replaced by a new object; unchanged buttons keep their identity so
// memoized React subtrees stay stable.

import type { ButtonConfig, CategoryConfig } from '@/types/settings';

/** Rows and columns of one grid. Always normalized (inside the bounds). */
export interface GridDimensions {
    rows: number;
    columns: number;
}

/** The optional persisted fields a grid carries (category or variant). */
export interface GridDimensionFields {
    rows?: number;
    columns?: number;
}

export const MIN_GRID_ROWS = 1;
export const MIN_GRID_COLUMNS = 1;
export const MAX_GRID_ROWS = 5;
export const MAX_GRID_COLUMNS = 5;

/**
 * What a grid without stored dimensions means: the fixed 4x4 palette every
 * grid was before variable grids existed. Reading absent fields this way is
 * the whole backward-compatibility story — no migration, no data rewrite.
 */
export const LEGACY_GRID_DIMENSIONS: GridDimensions = { rows: 4, columns: 4 };

/** Slot count of the historical fixed grid (16). */
export const LEGACY_GRID_SLOT_COUNT = 16;

/**
 * What a NEWLY created grid starts at: three slots side by side. A user grows
 * the grid when they actually need more room instead of facing sixteen empty
 * cells; existing grids are unaffected (see LEGACY_GRID_DIMENSIONS).
 */
export const DEFAULT_GRID_DIMENSIONS: GridDimensions = { rows: 1, columns: 3 };

export function gridSlotCount(dimensions: GridDimensions): number {
    return dimensions.rows * dimensions.columns;
}

function clampInt(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function clampGridDimensions(dimensions: GridDimensions): GridDimensions {
    return {
        rows: clampInt(dimensions.rows, MIN_GRID_ROWS, MAX_GRID_ROWS),
        columns: clampInt(dimensions.columns, MIN_GRID_COLUMNS, MAX_GRID_COLUMNS),
    };
}

function readDimension(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        return fallback;
    }
    return clampInt(value, min, max);
}

/**
 * Dimensions of a stored grid. An absent or structurally invalid field falls
 * back to the legacy 4x4 value — data that predates variable grids must keep
 * rendering exactly as it always did, and a corrupt number must never produce
 * a zero-slot grid that would hide every tool in it.
 */
export function readGridDimensions(
    source: GridDimensionFields | null | undefined
): GridDimensions {
    return {
        rows: readDimension(source?.rows, MIN_GRID_ROWS, MAX_GRID_ROWS, LEGACY_GRID_DIMENSIONS.rows),
        columns: readDimension(
            source?.columns,
            MIN_GRID_COLUMNS,
            MAX_GRID_COLUMNS,
            LEGACY_GRID_DIMENSIONS.columns
        ),
    };
}

export function sameGridDimensions(a: GridDimensions, b: GridDimensions): boolean {
    return a.rows === b.rows && a.columns === b.columns;
}

/**
 * Smallest sensible grid holding `count` buttons, starting from the default
 * width. Used by the flow -> grid conversion, which must fit every existing
 * button. Null when even 5x5 is too small.
 */
export function fitGridDimensions(count: number): GridDimensions | null {
    for (
        let columns = DEFAULT_GRID_DIMENSIONS.columns;
        columns <= MAX_GRID_COLUMNS;
        columns += 1
    ) {
        const rows = Math.max(MIN_GRID_ROWS, Math.ceil(count / columns));
        if (rows <= MAX_GRID_ROWS) {
            return { rows, columns };
        }
    }
    return null;
}

/**
 * Button layout of a category.
 * - `flow`: the historical behavior — buttons render in `order` sequence and
 *   reflow when one is added, removed or hidden;
 * - `grid`: the palette with stable slots.
 * An absent `layout` field means `flow`, so all pre-existing categories keep
 * behaving exactly as before.
 */
export type CategoryLayout = 'flow' | 'grid';

export const DEFAULT_CATEGORY_LAYOUT: CategoryLayout = 'flow';

/** Layout of a category; unknown/absent values fall back to `flow`. */
export function getCategoryLayout(category: Pick<CategoryConfig, 'layout'>): CategoryLayout {
    return category.layout === 'grid' ? 'grid' : DEFAULT_CATEGORY_LAYOUT;
}

export function isGridCategory(category: Pick<CategoryConfig, 'layout'>): boolean {
    return getCategoryLayout(category) === 'grid';
}

/** A slot index is a non-negative integer — the bare shape, without bounds. */
export function isSlotIndexValue(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** A slot index inside a grid of `slotCount` slots. */
export function isValidSlotIndex(value: unknown, slotCount: number): value is number {
    return isSlotIndexValue(value) && value < slotCount;
}

/** Row/column of a slot, for rendering and for future hotkey labels. */
export function slotRow(slot: number, columns: number): number {
    return Math.floor(slot / columns);
}

export function slotColumn(slot: number, columns: number): number {
    return slot % columns;
}

/** Flat slot index of a logical cell. */
export function slotAt(row: number, column: number, columns: number): number {
    return row * columns + column;
}

/**
 * The slot a button on `slot` must move to when the grid changes dimensions,
 * or null when that cell no longer exists (the removed right column / bottom
 * row). This is the whole reason a resize cannot simply keep the flat index:
 * with a different column count the same number names a different cell.
 *
 *     2x3            + column        2x4
 *     A B C          ------->        A B C .
 *     D E F                          D E F .
 *
 * A keeps (0,0) = 0, D moves from flat 3 to flat 4 — same logical cell.
 */
export function remapSlot(
    slot: number,
    from: GridDimensions,
    to: GridDimensions
): number | null {
    const row = slotRow(slot, from.columns);
    const column = slotColumn(slot, from.columns);
    if (row >= to.rows || column >= to.columns) {
        return null;
    }
    return slotAt(row, column, to.columns);
}

/**
 * Resolved placement of a category's buttons on the grid.
 * `slots` always has `gridSlotCount(dimensions)` entries; `overflow` is
 * normally empty and only carries buttons that could not be placed
 * (hand-edited or corrupt data with more buttons than slots). Overflow buttons
 * are never dropped.
 */
export interface GridPlacement {
    slots: (ButtonConfig | null)[];
    overflow: ButtonConfig[];
}

function emptySlots(slotCount: number): (ButtonConfig | null)[] {
    return new Array<ButtonConfig | null>(slotCount).fill(null);
}

/** Buttons in their deterministic base sequence (`order`, stable by index). */
function inOrder(buttons: readonly ButtonConfig[]): ButtonConfig[] {
    return buttons
        .map((button, index) => ({ button, index }))
        .sort((a, b) => a.button.order - b.button.order || a.index - b.index)
        .map((entry) => entry.button);
}

export interface GridPlacementOptions {
    /**
     * Slots this set of buttons may not occupy — used by the legacy palette
     * context layers, where the base layer reserves its slots in every context
     * profile. A button whose stored slot is blocked is relocated to the lowest
     * free unblocked slot, never dropped and never allowed to overwrite the
     * block.
     */
    blocked?: readonly boolean[];
}

/**
 * Place buttons on a grid of the given dimensions, deterministically and
 * without losing any button. Buttons carrying a valid, still-free slot keep
 * it; buttons with a missing, out-of-range, blocked or already-taken slot are
 * assigned the lowest free slot in `order` sequence. This makes corrupt data
 * (duplicate slots) self-heal predictably instead of throwing or silently
 * dropping buttons.
 */
export function placeButtonsOnGrid(
    buttons: readonly ButtonConfig[],
    dimensions: GridDimensions,
    options?: GridPlacementOptions
): GridPlacement {
    const slotCount = gridSlotCount(dimensions);
    const blocked = options?.blocked;
    const isBlocked = (slot: number): boolean => blocked?.[slot] === true;

    const slots = emptySlots(slotCount);
    const ordered = inOrder(buttons);
    const unplaced: ButtonConfig[] = [];

    for (const button of ordered) {
        const slot = button.slot;
        if (isValidSlotIndex(slot, slotCount) && !isBlocked(slot) && slots[slot] === null) {
            slots[slot] = button;
        } else {
            unplaced.push(button);
        }
    }

    const overflow: ButtonConfig[] = [];
    let cursor = 0;
    for (const button of unplaced) {
        while (cursor < slotCount && (slots[cursor] !== null || isBlocked(cursor))) {
            cursor += 1;
        }
        if (cursor >= slotCount) {
            overflow.push(button);
            continue;
        }
        slots[cursor] = button;
    }

    return { slots, overflow };
}

/** Slot ids of a category's buttons as a slot-indexed array (null = empty). */
export function buildGridSlotIds(
    buttons: readonly ButtonConfig[],
    dimensions: GridDimensions
): (string | null)[] {
    return placeButtonsOnGrid(buttons, dimensions).slots.map((button) => button?.id ?? null);
}

/** Lowest free slot index, or null when the grid is full. */
export function findFirstFreeSlot(slotIds: readonly (string | null)[]): number | null {
    for (let i = 0; i < slotIds.length; i++) {
        if ((slotIds[i] ?? null) === null) {
            return i;
        }
    }
    return null;
}

/** Slot currently holding `buttonId`, or null. */
export function findSlotOfId(
    slotIds: readonly (string | null)[],
    buttonId: string
): number | null {
    const index = slotIds.indexOf(buttonId);
    return index === -1 ? null : index;
}

/** True when every non-null entry appears at most once. */
export function hasUniqueSlotIds(slotIds: readonly (string | null)[]): boolean {
    const seen = new Set<string>();
    for (const id of slotIds) {
        if (id === null) continue;
        if (seen.has(id)) return false;
        seen.add(id);
    }
    return true;
}

/**
 * Move a button within one grid: onto an empty slot it simply relocates, onto
 * an occupied slot the two buttons swap. The grid is positional, so nothing
 * else shifts — no cascading reorder of a whole chain. The live slot array
 * already has the grid's size, so it is the bound that counts here.
 * Returns the same array reference when nothing changes.
 */
export function moveIdToSlotWithinGrid(
    slotIds: readonly (string | null)[],
    buttonId: string,
    targetSlot: number
): (string | null)[] {
    if (!isValidSlotIndex(targetSlot, slotIds.length)) {
        return slotIds as (string | null)[];
    }
    const from = findSlotOfId(slotIds, buttonId);
    if (from === null || from === targetSlot) {
        return slotIds as (string | null)[];
    }
    const next = [...slotIds];
    const displaced = next[targetSlot] ?? null;
    next[targetSlot] = buttonId;
    // Occupied target => swap; empty target => the source slot becomes a hole.
    next[from] = displaced;
    return next;
}

/** Outcome of resizing one grid. */
export interface GridResizeResult {
    /** Buttons that survive, on their remapped slots. */
    buttons: ButtonConfig[];
    /**
     * Buttons that stood on the cut-off strip. The caller decides what that
     * means — right now the confirmation counts them and the commit drops
     * them; nothing here deletes anything on its own.
     */
    removed: ButtonConfig[];
}

/**
 * Resize one grid's buttons COORDINATE-AWARE: every surviving button keeps its
 * logical row and column, so growing a grid never re-flows the existing
 * arrangement and shrinking it removes exactly the outer strip.
 *
 * Buttons that could not be placed on the OLD grid at all (overflow from
 * hand-edited data) are carried over untouched — they stood on no cell, so no
 * cell of theirs can be cut away.
 */
export function resizeGridButtons(
    buttons: readonly ButtonConfig[],
    from: GridDimensions,
    to: GridDimensions
): GridResizeResult {
    const placement = placeButtonsOnGrid(buttons, from);
    const kept: ButtonConfig[] = [];
    const removed: ButtonConfig[] = [];

    placement.slots.forEach((button, slot) => {
        if (!button) return;
        const next = remapSlot(slot, from, to);
        if (next === null) {
            removed.push(button);
            return;
        }
        kept.push(button.slot === next ? button : { ...button, slot: next });
    });
    kept.push(...placement.overflow);

    return {
        buttons: kept.map((button, index) =>
            button.order === index ? button : { ...button, order: index }
        ),
        removed,
    };
}

/** Buttons in their deterministic base sequence; exported for the converters. */
export function buttonsInOrder(buttons: readonly ButtonConfig[]): ButtonConfig[] {
    return inOrder(buttons);
}

// Layout conversion (flow <-> grid) lives in src/utils/categoryVariants.ts,
// because converting a grid category has to account for its variants as well.
