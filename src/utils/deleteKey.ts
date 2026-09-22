// deleteKey.ts
// When the Delete key means "delete the selected tools", and — mostly — when it
// does not.
//
// A key that removes things from the panel while the user is typing somewhere
// else is worse than no shortcut at all, so almost everything here is a refusal.
// The rules are pure functions rather than conditions buried in a listener,
// because "does this keystroke belong to a text field" is exactly the kind of
// thing that has to be testable without a browser.

/** The keydown fields the decision needs. Any KeyboardEvent satisfies this. */
export interface DeleteKeyEvent {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    defaultPrevented?: boolean;
    repeat?: boolean;
}

/**
 * Whether this keystroke is the plain Delete key.
 *
 * Deliberately narrow:
 *
 * - `Delete` only. Backspace is NOT a second shortcut for it: on a Mac it is
 *   the key people reach for to correct typing, and the panel has never claimed
 *   it.
 * - No modifiers. Ctrl/Cmd/Alt/Shift + Delete belong to whoever bound them, and
 *   a destructive action is the last thing that should answer to a combination
 *   it was never given.
 * - Nothing already handled. A `defaultPrevented` event has been claimed by
 *   something closer to the user.
 * - Not an auto-repeat. Holding the key opens one dialog, not forty.
 */
export function isSelectionDeleteKey(event: DeleteKeyEvent): boolean {
    return (
        event.key === 'Delete' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.defaultPrevented &&
        !event.repeat
    );
}

/** The parts of an event target this module inspects, duck-typed. */
interface TargetLike {
    tagName?: unknown;
    isContentEditable?: unknown;
    closest?: (selector: string) => unknown;
}

/** Elements whose whole purpose is to receive typing. */
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Whether the keystroke was aimed at somewhere text is being entered.
 *
 * Three layers, because each catches something the others miss: the tag (a
 * settings field, a rename box), `isContentEditable` (Obsidian's editor, an
 * inline rename), and an ancestor marked editable (a rich control whose inner
 * node is a plain span).
 *
 * Duck-typed rather than `instanceof HTMLElement`: the panel lives in Obsidian,
 * where a popout window is a SEPARATE REALM with its own constructors, and an
 * `instanceof` against this window's would quietly answer false for every node
 * in it — turning the guard off exactly where it is still needed.
 */
export function isTextEntryTarget(target: unknown): boolean {
    const node = target as TargetLike | null | undefined;
    if (!node) return false;
    if (typeof node.tagName === 'string' && TEXT_ENTRY_TAGS.has(node.tagName.toUpperCase())) {
        return true;
    }
    if (node.isContentEditable === true) return true;
    if (typeof node.closest === 'function') {
        // `[contenteditable]` alone would match `contenteditable="false"`,
        // which is an explicit "not editable".
        if (node.closest('[contenteditable="true"], [contenteditable=""], input, textarea')) {
            return true;
        }
    }
    return false;
}

/** Everything the Delete key has to be true of before it deletes anything. */
export interface DeleteKeyContext {
    event: DeleteKeyEvent;
    /** Whatever the event names as its target; inspected structurally. */
    target: unknown;
    /** How many tools the current selection would actually remove. */
    targetCount: number;
    /** A tool drag or a rectangle gesture is running. */
    dragging: boolean;
    /** Any dialog is already open, this plugin's or another's. */
    modalOpen: boolean;
    /** The keystroke came from the panel's own leaf, or from nothing focused. */
    inScope: boolean;
}

/**
 * Whether this keystroke should open the delete confirmation.
 *
 * Every clause is a way of saying "not now", and the order is only for
 * readability — they are all necessary:
 *
 * - it has to be the plain Delete key;
 * - it must not have been aimed at a text field;
 * - there has to be something to delete, so an empty selection and no selection
 *   are both silently nothing;
 * - a drag owns the keyboard while it runs;
 * - a dialog that is already open owns it too, so Delete cannot stack a second
 *   confirmation on top of the first;
 * - and it has to have come from this panel, or from nothing at all — a Delete
 *   aimed at the file explorer is the file explorer's business.
 */
export function shouldOpenDeleteConfirmation(context: DeleteKeyContext): boolean {
    return (
        isSelectionDeleteKey(context.event) &&
        !isTextEntryTarget(context.target) &&
        context.targetCount > 0 &&
        !context.dragging &&
        !context.modalOpen &&
        context.inScope
    );
}
