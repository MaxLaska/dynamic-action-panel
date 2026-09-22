// readerOutlineDrop.ts
// Reading a reader object dragged out of a PDF outline, and turning it into the
// link that navigates back to it.
//
// The payload is written by the companion plugin `zotflow-reader-extensions`,
// which reads the reader's OWN outline tree — titles, hierarchy and the
// destination the reader itself navigates to — rather than scraping the
// rendered list. This module is the panel's side of that contract and treats it
// exactly like every other foreign payload: untrusted input, rebuilt field by
// field from individually type-checked own properties, never spread.
//
// The navigation channel is deliberately NOT a new one. ZotFlow's reader view
// parses `annotation=<urlencoded JSON>` out of an Obsidian subpath and hands the
// PARSED OBJECT straight to the reader's `navigate()` — measured in its own
// bundle:
//
//     parseNavigationInfo(s) { let m = s.match(/annotation=([^&]+)/);
//                              return m && m[1] ? JSON.parse(decodeURIComponent(m[1])) : null }
//     readerNavigate(info)   { this.bridge.navigate(info) }
//
// and the reader's `navigate` accepts a location, of which `{annotationID}` is
// only one shape. `{position: {pageIndex, rects}}` — exactly what an outline
// entry carries — is another, and it lands on the precise destination rather
// than the top of a page. Verified end to end against a live reader: both the
// direct call and the full `setEphemeralState({subpath})` route arrived at the
// expected page.
//
// So an outline section is an ordinary `file` tool with a subpath, like a
// dropped annotation before it. What makes it a SECTION rather than a page
// bookmark is the `section` description stored beside it — see
// DocumentSectionRef in src/types/action.ts.

import type { DocumentSectionRef } from '@/types/action';

/**
 * The MIME type the companion plugin writes.
 *
 * Generic in name and explicit in payload: `kind` says what the object is, so a
 * later reader object travels the same channel without a second MIME type.
 */
export const READER_OBJECT_MIME = 'application/x-dap-reader-object';

/** The reader's own destination for an outline entry. */
export interface OutlineLocation {
    position: { pageIndex: number; rects: number[][] };
}

/** A section of a document, as a drag from the reader's outline describes it. */
export interface OutlineSectionRef {
    /** Vault path of the document the outline belongs to. */
    filePath: string;
    section: DocumentSectionRef;
    location: OutlineLocation;
}

function own(source: object, key: string): unknown {
    return Object.prototype.hasOwnProperty.call(source, key)
        ? (source as Record<string, unknown>)[key]
        : undefined;
}

function ownString(source: object, key: string): string | undefined {
    const value = own(source, key);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** A non-negative integer, or undefined for anything else. */
function ownPageIndex(source: object, key: string): number | undefined {
    const value = own(source, key);
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
        ? value
        : undefined;
}

/** The rectangles of a destination, keeping only well-formed numeric ones. */
function readRects(value: unknown): number[][] {
    if (!Array.isArray(value)) return [];
    const rects: number[][] = [];
    for (const entry of value as unknown[]) {
        if (!Array.isArray(entry)) continue;
        const numbers = (entry as unknown[]).filter(
            (n): n is number => typeof n === 'number' && Number.isFinite(n)
        );
        if (numbers.length === (entry as unknown[]).length && numbers.length > 0) {
            rects.push(numbers);
        }
    }
    return rects;
}

/** Ancestor titles, as strings and nothing else. */
function readParents(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return (value as unknown[]).filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
    );
}

/**
 * The section a `application/x-dap-reader-object` payload describes, or null.
 *
 * Null is the answer for anything that is not a PDF outline object — a future
 * `kind`, a truncated payload, a different version — and is never an error: the
 * drop simply keeps whatever meaning it had before.
 */
export function parseReaderOutlinePayload(raw: string): OutlineSectionRef | null {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (ownString(parsed, 'kind') !== 'pdf-outline') return null;
    if (own(parsed, 'version') !== 1) return null;

    const filePath = ownString(parsed, 'filePath');
    const title = ownString(parsed, 'title');
    if (filePath === undefined || title === undefined) return null;

    const locationValue = own(parsed, 'location');
    if (!locationValue || typeof locationValue !== 'object') return null;
    const positionValue = own(locationValue, 'position');
    if (!positionValue || typeof positionValue !== 'object') return null;
    const pageIndex = ownPageIndex(positionValue, 'pageIndex');
    if (pageIndex === undefined) return null;

    const level = ownPageIndex(parsed, 'level') ?? 0;
    const parents = readParents(own(parsed, 'parents'));
    const pageLabel = ownString(parsed, 'pageLabel');
    const nextPageIndex = ownPageIndex(parsed, 'nextPageIndex');

    return {
        filePath,
        section: {
            title: title.trim(),
            level,
            ...(parents.length > 0 ? { parents } : {}),
            pageIndex,
            ...(pageLabel !== undefined ? { pageLabel: pageLabel.trim() } : {}),
            // Only a boundary that lies after this section says anything.
            ...(nextPageIndex !== undefined && nextPageIndex > pageIndex
                ? { nextPageIndex }
                : {}),
        },
        location: {
            position: { pageIndex, rects: readRects(own(positionValue, 'rects')) },
        },
    };
}

/**
 * The subpath that sends the reader to this section.
 *
 * `#page=` comes first and carries the 1-based physical page: ZotFlow ignores
 * it, but Obsidian's own PDF view understands it, so a vault without ZotFlow
 * still lands on the right page. The `annotation=` part is ZotFlow's parameter
 * name for "navigate here", and its value is the reader's own location object —
 * a position, not an annotation id.
 *
 * The order is not cosmetic: ZotFlow extracts the second part with
 * `/annotation=([^&]+)/` and JSON-parses it, so anything appended after it
 * would be swallowed into the JSON and break the parse.
 */
export function buildSectionSubpath(location: OutlineLocation): string {
    const pageIndex = location.position.pageIndex;
    return `#page=${pageIndex + 1}#annotation=${encodeURIComponent(
        JSON.stringify({ position: location.position })
    )}`;
}
