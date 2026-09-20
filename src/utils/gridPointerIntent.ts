// gridPointerIntent.ts
// What a press on the grid means — decided ONCE, from the button and the
// modifiers, at the moment the button goes down.
//
// The mouse grammar (experimental, corrected 2026-09-20):
//
//     left                 use it: a click runs the tool
//     left, dragged        RESERVED — no move, no selection, and no run either
//     Shift + left         add to the selection (a cell, or a rectangle)
//     Ctrl/Cmd + left      take out of the selection
//     right                context: a click opens the menu, a drag MOVES the tool
//
// Superseded on the same day: the first attempt put the selection on the right
// button and the layout move on the left. Using it said otherwise — the hand
// expects the left button to *use* things and the right one to be the odd one
// out, so the odd job (moving a tool around) belongs there. The left drag is
// deliberately left empty; an outbound resource drag is the obvious later
// claimant, and nothing else may take it in the meantime.
//
// Pure, and deliberately the ONLY place that reads a mouse button: the click
// handler, the rectangle drag, the drag activators and the context menu must
// not each decide for themselves what a press was, or they can contradict each
// other mid-gesture.

import type { CellSelectionGesture } from '@/utils/gridCellSelection';

/** `MouseEvent.button` values this module speaks about. */
export const MOUSE_BUTTON = { left: 0, middle: 1, right: 2 } as const;

/** What a press means. Decided at pointer-down and never revised. */
export type GridPointerIntent =
    /** Plain left: a click runs the tool, a drag is reserved and does nothing. */
    | 'use'
    /** Shift + left: add what the gesture covers to the selection. */
    | 'select-add'
    /** Ctrl/Cmd + left: take what it covers out of the selection. */
    | 'select-remove'
    /** Right: a click opens the context menu, a drag moves the tool. */
    | 'secondary'
    /** Anything else (middle button, extra buttons): nothing at all. */
    | 'none';

export interface GridPointerPress {
    /** `MouseEvent.button` — 0 left, 1 middle, 2 right. */
    button: number;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
}

/**
 * The meaning of one press.
 *
 * `isMac` moves the subtractive modifier to Cmd, because Ctrl + left IS the
 * secondary click there: on macOS that press is a right click, so it means the
 * context menu and the tool move, never a removal.
 */
export function gridPointerIntent(
    press: GridPointerPress,
    isMac: boolean
): GridPointerIntent {
    if (
        press.button === MOUSE_BUTTON.right ||
        (isMac && press.button === MOUSE_BUTTON.left && press.ctrlKey)
    ) {
        // A modifier changes nothing here: the right button has exactly two
        // readings, and which one it is depends on travel, not on a key.
        return 'secondary';
    }

    if (press.button !== MOUSE_BUTTON.left) {
        return 'none';
    }

    // Shift wins over Ctrl/Cmd, the same precedence every other surface of the
    // panel uses, so both held is an ADD and the cursor can say so honestly.
    if (press.shiftKey) {
        return 'select-add';
    }
    if (isMac ? press.metaKey : press.ctrlKey) {
        return 'select-remove';
    }
    return 'use';
}

/** The set gesture an intent hands to the selection, or null when it has none. */
export function gestureOfIntent(
    intent: GridPointerIntent
): Exclude<CellSelectionGesture, 'replace'> | null {
    if (intent === 'select-add') {
        return 'add';
    }
    if (intent === 'select-remove') {
        return 'remove';
    }
    return null;
}

/** Whether this intent belongs to the selection (single cell or rectangle). */
export function isSelectionIntent(intent: GridPointerIntent): boolean {
    return intent === 'select-add' || intent === 'select-remove';
}

/**
 * Whether a press carries a selection modifier, whatever button it is on.
 *
 * Used by the drag activators OUTSIDE a grid — the category grip, the tabs,
 * the folder tiles — where there is no cell to select but a held modifier
 * still means "I am building a selection", so the press must not reorder
 * anything.
 */
export function pressCarriesSelectionModifier(
    press: GridPointerPress,
    isMac: boolean
): boolean {
    return isSelectionIntent(
        gridPointerIntent({ ...press, button: MOUSE_BUTTON.left }, isMac)
    );
}
