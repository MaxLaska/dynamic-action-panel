// contextMenuSuppression.ts
// One right press, one meaning: a click opens the menu, a DRAG moves the tool.
//
// The drag is the case that needs help. On Windows the browser fires
// `contextmenu` on the release, so the menu would pop up at the end of every
// tool move. The grid latches the press and could say so itself — except that
// a button drag remounts the category subtree (ListModeContent swaps the
// sortable block for a plain one while a drag is in flight), and the fresh
// instance no longer remembers the press that started it.
//
// So the suppression is armed from the DRAG, which is the thing that actually
// happened, and from a place that survives the remount: one self-removing
// listener on the document, for the next `contextmenu` only.

/** Removes the armed suppressor, if any. Exported for the tests. */
let disarm: (() => void) | null = null;

/**
 * Swallows the next `contextmenu` — the one a finished right-button drag would
 * otherwise produce. Never a standing block: it fires once, and a timeout
 * clears it if no menu event ever arrives (a drag cancelled by Escape, a
 * platform that reports the menu on press instead of release).
 */
export function suppressNextContextMenu(doc: Document, timeoutMs = 1000): void {
    disarm?.();

    const onContextMenu = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        disarm?.();
    };
    const timer = doc.defaultView?.setTimeout(() => disarm?.(), timeoutMs);

    disarm = () => {
        doc.removeEventListener('contextmenu', onContextMenu, true);
        if (timer !== undefined) {
            doc.defaultView?.clearTimeout(timer);
        }
        disarm = null;
    };
    doc.addEventListener('contextmenu', onContextMenu, true);
}

/** Drops an armed suppressor without waiting for a menu or the timeout. */
export function cancelContextMenuSuppression(): void {
    disarm?.();
}
