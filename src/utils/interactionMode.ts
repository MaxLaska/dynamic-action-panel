// interactionMode.ts
// What the two interaction modes MEAN, as a pure predicate.
//
// The panel has exactly two modes since settings version 5 merged the old
// `sort` into `edit`. Since 2026-09-19 the difference between them is ONE
// thing: whether the LAYOUT may change.
//
//     locked = layout locked        edit = layout editable
//
// Everything operative works the same in both, and deliberately so:
//
// - a plain click (or Enter/Space) on a tool RUNS it — in edit mode too;
// - Shift/Ctrl(Cmd) click and drag SELECT cells — in locked mode too;
// - the colour palette, select-by-colour, Escape and the background click;
// - dropping a file onto a slot.
//
// What `edit` adds is exactly the spatial manipulation of what is already
// there: moving and swapping tools, reordering categories, resizing a grid,
// creating through the `+`, and the context menus that restructure.
//
// Before, locked meant "consume" and edit meant "manage", and the price was a
// panel whose tools stopped working the moment you unlocked it and whose
// selection vanished the moment you locked it. See
// docs/ocap/cell-selection-colors.md §3.

import type { InteractionMode } from '@/types/settings';

/**
 * Whether the LAYOUT may be changed: move, swap, reorder, resize, the `+`.
 *
 * This is the whole of what distinguishes the two modes. Running a tool and
 * selecting cells are NOT gated here — they are available in both, and a
 * component that finds itself checking the mode for one of them has
 * reintroduced the old model.
 */
export function allowsLayoutEditing(mode: InteractionMode): boolean {
    return mode === 'edit';
}

/**
 * The mode the panel actually runs in — ONE, for every user (experimental,
 * 2026-09-20).
 *
 * The mouse grammar took the ambiguity the two modes existed to resolve: a
 * left click runs a tool and a left drag moves it, told apart by the drag
 * threshold; a category moves only by its grip; and selecting happens on the
 * RIGHT button, where nothing else lives. With no gesture left that means two
 * things at once, there is nothing for a mode to protect.
 *
 * Deliberately a runtime constant rather than a migration: `panelConfig
 * .interactionMode` keeps whatever it holds, nothing is rewritten, no schema
 * version moves, and restoring the switch is one line. Everything the modes
 * ever gated — layout editing, the variant selector, context menus, the
 * "hidden category" marking — follows from this single value, so the prototype
 * has exactly one place to undo.
 */
export const SINGLE_INTERACTION_MODE: InteractionMode = 'edit';
