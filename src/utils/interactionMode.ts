// interactionMode.ts
// What each of the two interaction modes MEANS, as pure predicates.
//
// The panel has exactly two modes since settings version 5 merged the old
// `sort` into `edit`: locked consumes, edit manages. Keeping the meaning here
// rather than inline in a component makes the product rule testable in a plain
// node environment — which matters most for the one rule whose whole point is
// that it is a deliberate behavior change.

import type { InteractionMode } from '@/types/settings';

/**
 * Whether activating a tool runs its actions.
 *
 * ONLY locked mode executes. In edit mode an activation means selecting the
 * cell the tool sits on, and the tool's actions must not run — not from a
 * click, and not from Enter or Space on the focused tool either, which produce
 * the very same click event on a real `<button>`.
 *
 * Before this rule existed there was no interaction-mode guard anywhere in the
 * click path, so a slipped click while rearranging the panel could start a
 * script. See docs/ocap/cell-selection-colors.md §3.
 */
export function executesToolActions(mode: InteractionMode): boolean {
    return mode === 'locked';
}

/**
 * Whether cells can be selected and coloured.
 *
 * The mirror image of the rule above: edit mode is the management surface, and
 * it is the only one that has a selection at all. Locked mode still SHOWS cell
 * colours — they are content — but offers no selection, no palette and no `+`.
 */
export function allowsCellSelection(mode: InteractionMode): boolean {
    return mode === 'edit';
}
