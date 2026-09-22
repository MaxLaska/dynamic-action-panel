// readerContract.ts
// The ONE place that knows what the embedded reader's DOM looks like.
//
// Everything this plugin does rests on names that belong to somebody else: the
// Zotero reader fork that ZotFlow builds into `reader.html` and loads into an
// iframe. Those names are upstream constants, not a published API — the same
// de-facto-contract class already recorded for the annotation work in
// docs/ocap/audits/2026-09-18-zotflow-annotation-integration.md.
//
// Two consequences shape this file:
//
// 1. EVERY selector lives here. Not one of these strings may appear anywhere
//    else in the plugin, so that a reader update is a single edit and a single
//    review, rather than a hunt.
//
// 2. THE STRUCTURE IS VERIFIED BEFORE IT IS TOUCHED. `probeReader` either
//    returns every part the patch needs, or it returns null and the reader is
//    left exactly as it was. There is deliberately no partial success: a half
//    applied patch on somebody else's UI is worse than no patch at all.
//
// Measured against ZotFlow 1.6.5 / reader submodule `c971316`; see
// docs/ocap/audits/2026-09-22-zotflow-reader-sidebar-side.md.

/** ZotFlow's view type for a vault file opened in its reader (1.6.5). */
export const READER_VIEW_TYPE = 'zotflow-local-zotero-reader-view';

/**
 * The reader DOM this plugin depends on, named once.
 *
 * `splitViewId` is not a duplicate of `splitViewClass`. The reader ships both a
 * class-based and an id-based split view, and only the id-based one carries the
 * document iframe — a patch that moves just the class-based one leaves the PDF
 * sitting where it was, to be covered by the sidebar. That cost one wrong
 * build during the feasibility study and is the single most load-bearing line
 * in this file.
 */
export const SELECTORS = {
    toolbar: '.toolbar',
    toolbarStart: '.toolbar .start',
    toolbarEnd: '.toolbar .end',
    sidebarToggle: '#sidebarToggle',
    /** Matches the toggle wherever it currently sits, for event delegation. */
    sidebarToggleAny: '.sidebar-toggle',
    sidebarContainer: '#sidebarContainer',
    splitViewClass: '.split-view',
    splitViewId: '#split-view',
    sidebarResizer: '.sidebar-resizer',
    divider: '.divider',
    /**
     * The two right-group buttons whose order this plugin swaps. Both are
     * OPTIONAL: a reader that does not show them still gets the sidebar
     * feature, so their absence is not a reason to refuse the patch.
     */
    toolbarFind: '.toolbar .end .find',
    toolbarAppearance: '.toolbar .end #appearance',
} as const;

/** Classes and ids this plugin owns. Prefixed so they cannot collide upstream. */
export const OWN = {
    /** Set on the reader's `body` while the sidebar is on the right. */
    rightClass: 'zfrx-sidebar-right',
    /** The injected stylesheet. */
    styleId: 'zfrx-sidebar-style',
    /** Marks the divider orphaned by moving the toggle out of `.start`. */
    orphanDivider: 'zfrx-orphan-divider',
    /** Records the side currently applied, for cheap idempotency checks. */
    appliedAttr: 'data-zfrx-side',
} as const;

/** The live reader instance the fork exposes on its own window. */
const READER_GLOBAL = '_reader';

/** The parts of one reader instance the patch needs, all present. */
export interface ReaderParts {
    doc: Document;
    win: Window;
    body: HTMLElement;
    toolbarStart: HTMLElement;
    toolbarEnd: HTMLElement;
    toggle: HTMLElement;
}

/**
 * The slice of the reader instance this plugin calls.
 *
 * Only `setSidebarWidth` is used, and only for the right-hand resize. The
 * reader keeps owning the width; this plugin never holds a second copy of it.
 */
export interface ReaderInstance {
    setSidebarWidth(width: number): void;
}

/**
 * Names every required part that is missing from a reader document.
 *
 * Returning the list rather than a boolean is what makes a reader update
 * diagnosable from a single log line instead of a bisect.
 */
export function missingParts(doc: Document | null | undefined): string[] {
    if (!doc || !doc.body) return ['document'];
    const missing: string[] = [];
    const required: Array<[string, string]> = [
        ['toolbar', SELECTORS.toolbar],
        ['toolbar start group', SELECTORS.toolbarStart],
        ['toolbar end group', SELECTORS.toolbarEnd],
        ['sidebar toggle', SELECTORS.sidebarToggle],
    ];
    for (const [label, selector] of required) {
        if (!doc.querySelector(selector)) missing.push(`${label} (${selector})`);
    }
    return missing;
}

/**
 * Resolves a reader document into the parts the patch needs, or null.
 *
 * Null is the normal, expected answer in two very different situations — the
 * iframe has not finished loading yet, and the reader's DOM has changed under a
 * ZotFlow update — and the caller treats both the same way: do nothing. Only
 * the second is worth logging, which is why `missingParts` is separate.
 */
export function probeReader(doc: Document | null | undefined): ReaderParts | null {
    if (!doc || !doc.body || !doc.defaultView) return null;
    const toolbarStart = doc.querySelector<HTMLElement>(SELECTORS.toolbarStart);
    const toolbarEnd = doc.querySelector<HTMLElement>(SELECTORS.toolbarEnd);
    const toggle = doc.querySelector<HTMLElement>(SELECTORS.sidebarToggle);
    if (!toolbarStart || !toolbarEnd || !toggle) return null;
    return { doc, win: doc.defaultView, body: doc.body, toolbarStart, toolbarEnd, toggle };
}

/**
 * The reader instance on a reader window, when it is there and usable.
 *
 * Probed structurally rather than trusted: this is a global on somebody else's
 * page, and the only honest test of "can I call setSidebarWidth" is whether it
 * is a function right now.
 */
export function readerInstance(win: Window | null | undefined): ReaderInstance | null {
    if (!win) return null;
    const candidate = (win as unknown as Record<string, unknown>)[READER_GLOBAL];
    if (!candidate || typeof candidate !== 'object') return null;
    const setter = (candidate as { setSidebarWidth?: unknown }).setSidebarWidth;
    if (typeof setter !== 'function') return null;
    return candidate as unknown as ReaderInstance;
}
