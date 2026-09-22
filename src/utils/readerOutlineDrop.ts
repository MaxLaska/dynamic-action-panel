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
// only one shape. `{dest}` and `{position}` are two others, and WHICH ONE is
// used decides where the document actually ends up:
//
//     navigate(e, t = {}) { t.block ||= "center"; …
//       else if (e.dest)     pdfLinkService.goToDestination(e.dest)   // ignores t
//       else if (e.position) navigateToPosition(e.position, t)        // honours t
//
// ZotFlow's own glue calls `reader.navigate(x, {behavior:"smooth"})` — hardcoded,
// with no `block` — so the position branch always centres. The reader's OWN
// outline calls the view directly with `{block:"start"}`, which aligns the
// destination to the top of the viewport. That difference is the whole reason
// this module builds a `dest`: the destination branch consults no options at
// all, so it reproduces the outline's own landing exactly instead of half a
// screen below it. Measured against the reader's outline across six entries,
// the destination form is scroll-position-identical and the position form is
// not — off by a third of a page nearby and by ten pages far away.
//
// So an outline section is an ordinary `file` tool with a subpath, like a
// dropped annotation before it. What makes it a SECTION rather than a page
// bookmark is the `section` description stored beside it — see
// DocumentSectionRef in src/types/action.ts.

import type { DocumentSectionRef, PdfDestination } from '@/types/action';

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
    const location: OutlineLocation = {
        position: { pageIndex, rects: readRects(own(positionValue, 'rects')) },
    };
    // Derived here rather than taken from the payload, so that a payload
    // written by an older companion build gets the same destination as a new
    // one. It is the reader's own point either way, only re-expressed.
    const dest = sectionDestination(location);

    return {
        filePath,
        section: {
            title: title.trim(),
            level,
            ...(parents.length > 0 ? { parents } : {}),
            pageIndex,
            ...(dest ? { dest } : {}),
            ...(pageLabel !== undefined ? { pageLabel: pageLabel.trim() } : {}),
            // Only a boundary that lies after this section says anything.
            ...(nextPageIndex !== undefined && nextPageIndex > pageIndex
                ? { nextPageIndex }
                : {}),
        },
        location,
    };
}

/**
 * The reader's own destination point, expressed as a PDF destination.
 *
 * This is a RE-EXPRESSION, not a new coordinate: the point is exactly the one
 * the reader resolved for this outline entry, written in the standard explicit
 * form so that the reader's navigation takes its destination branch. Nothing is
 * measured, estimated or converted to pixels, and nothing viewport-dependent is
 * stored.
 *
 * `rects[3]` rather than `rects[1]`: PDF coordinates grow upwards, so the top
 * edge of a rectangle is its larger y. Outline destinations are degenerate
 * points where the two agree, but the top-left corner is the right reading for
 * any rectangle.
 */
export function sectionDestination(location: OutlineLocation): PdfDestination | null {
    const rect = location.position.rects[0];
    const left = rect?.[0];
    const top = rect?.[3];
    if (typeof left !== 'number' || typeof top !== 'number') {
        return null;
    }
    return [location.position.pageIndex, { name: 'XYZ' }, left, top, null];
}

/**
 * The subpath that sends the reader to this section.
 *
 * Three parts, each for a different reader, in the one order that works:
 *
 * - `#page=` carries the 1-based physical page. ZotFlow ignores it, but
 *   Obsidian's own PDF view understands it, so a vault without ZotFlow still
 *   lands on the right page.
 * - `dest` is the destination the reader's own navigation honours FIRST, and
 *   the reason this function exists. Its branch calls PDF.js's
 *   `goToDestination` and consults no options at all — which matters, because
 *   ZotFlow hands the reader a hardcoded `{behavior:'smooth'}` with no `block`,
 *   and the position branch then defaults to `block: 'center'`. Centering puts
 *   the destination in the MIDDLE of the viewport, half a screen below where
 *   the outline puts it; measured against the reader's own outline, that was
 *   off by a third of a page nearby and by ten pages far away.
 * - `position` stays as the fallback for anything that does not know `dest`.
 *   It is what this plugin stored before, so a reader without the destination
 *   branch behaves exactly as it did.
 *
 * The order of the two subpath segments is not cosmetic: ZotFlow extracts the
 * second with `/annotation=([^&]+)/` and JSON-parses it, so anything appended
 * after it would be swallowed into the JSON and break the parse.
 */
export function buildSectionSubpath(location: OutlineLocation): string {
    const pageIndex = location.position.pageIndex;
    const dest = sectionDestination(location);
    const navigation = {
        ...(dest ? { dest } : {}),
        position: location.position,
    };
    return `#page=${pageIndex + 1}#annotation=${encodeURIComponent(
        JSON.stringify(navigation)
    )}`;
}
