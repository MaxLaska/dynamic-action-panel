// gridPointerIntent.ts
// What a press on the grid means — decided ONCE, from the button and the
// modifiers, at the moment the button goes down.
//
// The mouse grammar (experimental, 2026-09-20; cell-selection-colors.md §4.1):
//
//     left                 use it: run the tool, move it, resize, create
//     right                context: the menu for what is under the pointer
//     Shift + right        add to the selection
//     Ctrl/Cmd + right     take out of the selection
//
// Why the BUTTON carries part of the meaning: a filled cell cannot let one
// button mean both "run this tool" and "select this one cell" — the panel
// solved that with a locked/edit mode, and the mode is what this replaces.
// Left keeps every left-button habit; the selection moves to the button that
// had no job in a grid of buttons.
//
// Pure, and deliberately the ONLY place that reads a mouse button: the click
// handler, the rectangle drag and the context menu must not each decide for
// themselves what a press was, or they can contradict each other mid-gesture.

import type { CellSelectionGesture } from '@/utils/gridCellSelection';

/** `MouseEvent.button` values this module speaks about. */
export const MOUSE_BUTTON = { left: 0, middle: 1, right: 2 } as const;

/** What a press means. Decided at pointer-down and never revised. */
export type GridPointerIntent =
    /** The left button: run a tool, drag it, hit the `+`, grab a handle. */
    | 'layout'
    /** Shift + right: add what the gesture covers to the selection. */
    | 'select-add'
    /** Ctrl/Cmd + right: take what it covers out of the selection. */
    | 'select-remove'
    /** Right, without a selection modifier: the context menu. */
    | 'context'
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
 * secondary click there: on macOS that press is a right click, and it means
 * the context menu, not a layout press.
 */
export function gridPointerIntent(
    press: GridPointerPress,
    isMac: boolean
): GridPointerIntent {
    const secondary =
        press.button === MOUSE_BUTTON.right ||
        (isMac && press.button === MOUSE_BUTTON.left && press.ctrlKey);

    if (!secondary) {
        // The left button keeps every habit it had: a click runs the tool, a
        // drag moves it. A modifier held by accident changes none of that —
        // the selection is not on this button any more.
        return press.button === MOUSE_BUTTON.left ? 'layout' : 'none';
    }

    // Shift wins over Ctrl/Cmd, the same precedence every other surface of the
    // panel uses, so both held is an ADD and the cursor can say so honestly.
    if (press.shiftKey) {
        return 'select-add';
    }
    if (isMac ? press.metaKey : press.ctrlKey) {
        return 'select-remove';
    }
    return 'context';
}

/**
 * The set gesture an intent hands to the selection, or null when it has none.
 *
 * Narrower than CellSelectionGesture on purpose: the palette's 'replace' is a
 * set operation of its own, and no press on the grid produces it any more.
 */
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
