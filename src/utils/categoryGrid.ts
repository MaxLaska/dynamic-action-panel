// categoryGrid.ts
// Pure slot logic for the OCAP palette grid.
//
// Product model (see docs/ocap/DECISIONS.md):
// - a grid category has exactly GRID_SLOT_COUNT (4x4 = 16) slots with stable
//   identities 0..15;
// - a slot holds at most one button, and an empty slot stays empty: buttons
//   never slide up to fill a hole, not after a reload, a context change, a
//   visibility change, a drag or an edit;
// - the slot is the future hotkey identity, so it must stay independent of
//   which button currently occupies it.
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

export const GRID_COLUMNS = 4;
export const GRID_ROWS = 4;
/** Number of addressable slots in a grid category (0..GRID_SLOT_COUNT - 1). */
export const GRID_SLOT_COUNT = GRID_COLUMNS * GRID_ROWS;

/**
 * Button layout of a category.
 * - `flow`: the historical behavior — buttons render in `order` sequence and
 *   reflow when one is added, removed or hidden;
 * - `grid`: the 4x4 palette with stable slots.
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

/** A slot index is an integer in [0, GRID_SLOT_COUNT). */
export function isValidSlotIndex(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value < GRID_SLOT_COUNT
    );
}

/** Row/column of a slot, for rendering and for future hotkey labels. */
export function slotRow(slot: number): number {
    return Math.floor(slot / GRID_COLUMNS);
}

export function slotColumn(slot: number): number {
    return slot % GRID_COLUMNS;
}

/**
 * Resolved placement of a category's buttons on the grid.
 * `slots` always has length GRID_SLOT_COUNT; `overflow` is normally empty and
 * only carries buttons that could not be placed (hand-edited or corrupt data
 * with more than GRID_SLOT_COUNT buttons). Overflow buttons are never dropped.
 */
export interface GridPlacement {
    slots: (ButtonConfig | null)[];
    overflow: ButtonConfig[];
}

function emptySlots(): (ButtonConfig | null)[] {
    return new Array<ButtonConfig | null>(GRID_SLOT_COUNT).fill(null);
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
     * Slots this set of buttons may not occupy — used by the palette context
     * layers, where the base layer reserves its slots in every context profile.
     * A button whose stored slot is blocked is relocated to the lowest free
     * unblocked slot, never dropped and never allowed to overwrite the block.
     */
    blocked?: readonly boolean[];
}

/**
 * Place buttons on the 4x4 grid, deterministically and without losing any
 * button. Buttons carrying a valid, still-free slot keep it; buttons with a
 * missing, out-of-range, blocked or already-taken slot are assigned the lowest
 * free slot in `order` sequence. This makes corrupt data (duplicate slots)
 * self-heal predictably instead of throwing or silently dropping buttons.
 */
export function placeButtonsOnGrid(
    buttons: readonly ButtonConfig[],
    options?: GridPlacementOptions
): GridPlacement {
    const blocked = options?.blocked;
    const isBlocked = (slot: number): boolean => blocked?.[slot] === true;

    const slots = emptySlots();
    const ordered = inOrder(buttons);
    const unplaced: ButtonConfig[] = [];

    for (const button of ordered) {
        const slot = button.slot;
        if (isValidSlotIndex(slot) && !isBlocked(slot) && slots[slot] === null) {
            slots[slot] = button;
        } else {
            unplaced.push(button);
        }
    }

    const overflow: ButtonConfig[] = [];
    let cursor = 0;
    for (const button of unplaced) {
        while (cursor < GRID_SLOT_COUNT && (slots[cursor] !== null || isBlocked(cursor))) {
            cursor += 1;
        }
        if (cursor >= GRID_SLOT_COUNT) {
            overflow.push(button);
            continue;
        }
        slots[cursor] = button;
    }

    return { slots, overflow };
}

/** Slot ids of a category's buttons as a length-16 array (null = empty slot). */
export function buildGridSlotIds(buttons: readonly ButtonConfig[]): (string | null)[] {
    return placeButtonsOnGrid(buttons).slots.map((button) => button?.id ?? null);
}

/** Lowest free slot index, or null when the grid is full. */
export function findFirstFreeSlot(slotIds: readonly (string | null)[]): number | null {
    for (let i = 0; i < GRID_SLOT_COUNT; i++) {
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
 * else shifts — no cascading reorder of a whole chain.
 * Returns the same array reference when nothing changes.
 */
export function moveIdToSlotWithinGrid(
    slotIds: readonly (string | null)[],
    buttonId: string,
    targetSlot: number
): (string | null)[] {
    if (!isValidSlotIndex(targetSlot)) {
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

/** Buttons in their deterministic base sequence; exported for the converters. */
export function buttonsInOrder(buttons: readonly ButtonConfig[]): ButtonConfig[] {
    return inOrder(buttons);
}

// Layout conversion (flow <-> palette) lives in src/utils/paletteLayers.ts,
// because converting a palette has to account for its context layers as well.
