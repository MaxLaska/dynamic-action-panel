// action.ts
// Types for button actions.

/**
 * A PDF explicit destination, in the array form PDF readers use:
 * `[pageIndex, { name: 'XYZ' }, left, top, zoom]`.
 *
 * Stored verbatim rather than translated. `zoom` is null, which a PDF
 * destination reads as "keep the current zoom".
 */
export type PdfDestination = [number, { name: string }, ...Array<number | null>];

/**
 * A section of a document, as its own table of contents describes it.
 *
 * This is DESCRIPTION, not instruction: the action already knows how to get
 * there (`filePath` + `subpath`), and nothing here is read to navigate. It says
 * WHAT the destination is, so that a tool created from a document outline stays
 * a section rather than decaying into "page 106 of some PDF" — which is what a
 * bare subpath would leave behind.
 *
 * Every field is captured once, at the moment of the drop, and never
 * synchronised afterwards. It is a snapshot of the document's own structure,
 * which is exactly as stable as the document is.
 */
export interface DocumentSectionRef {
    /** The entry's title, as the document states it. */
    title: string;
    /** Depth in the outline tree; 0 is a top-level entry. */
    level: number;
    /** Ancestor titles, outermost first, excluding the entry itself. */
    parents?: string[];
    /** 0-based page index the entry points at. */
    pageIndex: number;
    /**
     * The entry's destination, in the PDF's own explicit form:
     * `[pageIndex, { name: 'XYZ' }, left, top, zoom]`.
     *
     * A point in PDF user space, not a measurement of anything rendered — no
     * pixels, no viewport, nothing that changes with the window. It is what
     * makes a section land exactly where the document's own table of contents
     * points, rather than merely on the right page, and it is the field later
     * work should read when it needs the destination rather than the page.
     *
     * Absent for a tool created before this was stored, and for an entry whose
     * position carries no usable rectangle. Navigation still works without it,
     * from `pageIndex` and the stored subpath.
     */
    dest?: PdfDestination;
    /** Printed page label of that page, which need not be `pageIndex + 1`. */
    pageLabel?: string;
    /**
     * Where the next entry at the same or a shallower level begins.
     *
     * A neighbour's start, read off the same outline — NOT an end, and never an
     * estimate. A section whose successor is unknown, or which shares its page,
     * simply omits this rather than carrying a guess that later work would
     * mistake for a measurement.
     */
    nextPageIndex?: number;
}

/**
 * Parameters of the "open file" action.
 */
export interface FileActionParams {
    /** Vault-relative file path */
    filePath: string;
    /**
     * Optional Obsidian link subpath, stored WITH its leading `#`
     * (`#heading`, `#^block`, `#page=3`). It is handed to the target view as
     * ephemeral state, so what it means is the view's business, not this
     * plugin's — a heading for a Markdown view, a page for a PDF view.
     * Absent means "just open the file", which is the historical behaviour.
     */
    subpath?: string;
    /**
     * What the subpath POINTS AT, when the drop that created this tool knew.
     *
     * Purely additive and never required: the action opens and navigates
     * identically with or without it, and a build that has never heard of it
     * still opens the file at the right place. That is the whole reason this is
     * a field on the existing action rather than an action type of its own — a
     * new type would make every one of these tools inert in any build that does
     * not know it, for no gain in what they do.
     */
    section?: DocumentSectionRef;
}

/**
 * Parameters of the "run command" action.
 */
export interface CommandActionParams {
    /** Obsidian command id */
    commandId: string;
    /** Command arguments (optional) */
	args?: unknown[];
}

/**
 * Parameters of the "open URL" action.
 */
export interface UrlActionParams {
    /** Target URL */
    url: string;
}

/**
 * Parameters of the "create file" action.
 */
export interface CreateFileActionParams {
    /** Folder path (optional) */
    folderPath?: string;
    /** File name */
    fileName: string;
    /** Template name (optional) */
    templateName?: string;
}

/**
 * Parameters of the "run script" action.
 */
export interface ScriptActionParams {
    /** Script name */
    scriptName: string;
}

/**
 * ButtonAction is the union of every supported action type and its parameters.
 */
export type ButtonAction =
    | { type: 'file'; parameters: FileActionParams }
    | { type: 'command'; parameters: CommandActionParams }
    | { type: 'url'; parameters: UrlActionParams }
    | { type: 'create_file'; parameters: CreateFileActionParams }
    | { type: 'script'; parameters: ScriptActionParams };
