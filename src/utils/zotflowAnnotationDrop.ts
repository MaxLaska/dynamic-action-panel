// zotflowAnnotationDrop.ts
// Pure reading of what a ZotFlow annotation drag puts on the clipboard, and the
// pure construction of the link that reopens that annotation.
//
// ZotFlow (a Zotero reader embedded in Obsidian) writes NO dedicated payload for
// an annotation dragged out of a LOCAL file's reader. What arrives is one of:
//
//   "![[<source note>#^<annotation id>]]"   when ZotFlow keeps a source note
//                                           for the file (the normal case)
//   " "                                     when it does not
//   '{"type":"zotflow-citation",…}'          in `application/zotflow-citation`,
//                                           for Zotero LIBRARY attachments only
//
// So the embed is the identity carrier for local annotations, and the citation
// JSON is it for library ones. Everything here is a value transformation with no
// Obsidian runtime involved: resolving the embed against the vault lives in
// src/utils/zotflowReader.ts, the tool it becomes in src/utils/annotationButton.ts.
//
// Version note: these are ZotFlow 1.6.5 formats, taken from what it writes into
// the user's own notes (`![[note#^id]]`, `#page=…#annotation=…`) and from the
// MIME type it consumes itself. They are stable de-facto contracts, not a
// published API — see docs/ocap/audits/2026-09-18-zotflow-annotation-integration.md.

/** The MIME type ZotFlow uses for its own citation drags. */
export const ZOTFLOW_CITATION_MIME = 'application/zotflow-citation';

/**
 * Annotation keys are Zotero object keys: exactly 8 characters from an alphabet
 * that deliberately omits 0, 1 and O. Matching that shape is what keeps an
 * ordinary Obsidian block embed ("![[note#^a1b2c3]]") from being mistaken for
 * an annotation — and for the local case the frontmatter check that follows is
 * the real proof.
 */
const ANNOTATION_KEY = '[23456789A-NP-Z]{8}';
const ANNOTATION_KEY_RE = new RegExp(`^${ANNOTATION_KEY}$`);

/**
 * The first "![[<note>#^<key>]]" in the payload. A multi-annotation drag writes
 * one per annotation; one cell is one tool, so only the first is read — the same
 * rule the file drop already follows.
 *
 * The note part may contain spaces, parentheses and folders (ZotFlow writes a
 * full vault path), so it is bounded only by the characters a wikilink target
 * cannot contain.
 */
const EMBED_RE = new RegExp(`!\\[\\[([^\\[\\]|#]+)#\\^(${ANNOTATION_KEY})\\]\\]`);

/** Identity of an annotation, as far as a payload can carry it. */
export interface ZotflowEmbedRef {
    /** Link target of the source note, exactly as written (may omit `.md`). */
    notePath: string;
    annotationId: string;
}

/** What the reader knows about an annotation; all of it optional and display-only. */
export interface ZotflowAnnotationMeta {
    /** 0-based page index, as the reader stores it. */
    pageIndex?: number;
    /** Printed page label, which need not equal `pageIndex + 1`. */
    pageLabel?: string;
    text?: string;
    comment?: string;
    /** highlight | underline | note | image | text | ink */
    annotationType?: string;
}

export interface LocalAnnotationRef extends ZotflowAnnotationMeta {
    kind: 'local';
    /** Vault path of the PDF/EPUB the annotation lives in. */
    filePath: string;
    /** File name without extension, for the fallback label. */
    fileBasename: string;
    annotationId: string;
}

export interface LibraryAnnotationRef extends ZotflowAnnotationMeta {
    kind: 'library';
    libraryID: number;
    annotationId: string;
}

export type ZotflowAnnotationRef = LocalAnnotationRef | LibraryAnnotationRef;

/** Whether a string has the shape of a Zotero annotation key. */
export function isAnnotationKey(value: string): boolean {
    return ANNOTATION_KEY_RE.test(value);
}

/**
 * The source note and annotation key named by a ZotFlow annotation drag, or
 * null when the payload is anything else (a plain wikilink, a file-explorer
 * URI, prose, the lone space ZotFlow writes when it has no source note).
 */
export function parseZotflowEmbedLink(text: string): ZotflowEmbedRef | null {
    if (typeof text !== 'string' || text.trim().length === 0) {
        return null;
    }
    const match = EMBED_RE.exec(text);
    if (!match) {
        return null;
    }
    const notePath = (match[1] ?? '').trim();
    const annotationId = match[2] ?? '';
    if (notePath.length === 0 || annotationId.length === 0) {
        return null;
    }
    return { notePath, annotationId };
}

// --- library citation payload -------------------------------------------------

function ownString(source: object, key: string): string | undefined {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
    const value = (source as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
}

function ownNumber(source: object, key: string): number | undefined {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
    const value = (source as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function ownObject(source: object, key: string): object | null {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return null;
    const value = (source as Record<string, unknown>)[key];
    return value !== null && typeof value === 'object' ? value : null;
}

/**
 * The first annotation of a `application/zotflow-citation` payload.
 *
 * This is untrusted input from another plugin, so nothing is spread and nothing
 * is trusted by shape alone: the result is BUILT from individually type-checked
 * own properties, exactly like the template parser treats an imported file. A
 * tree-view item drag uses the same MIME type without any annotations and
 * therefore yields null, which is not an error — it simply is not an annotation.
 */
export function parseZotflowCitationPayload(raw: string): LibraryAnnotationRef | null {
    if (typeof raw !== 'string' || raw.length === 0) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }
    if (ownString(parsed, 'type') !== 'zotflow-citation') {
        return null;
    }
    const libraryID = ownNumber(parsed, 'libraryID');
    if (libraryID === undefined) {
        return null;
    }
    const annotationsValue = Object.prototype.hasOwnProperty.call(parsed, 'annotations')
        ? (parsed as Record<string, unknown>)['annotations']
        : undefined;
    // Keep the element type `unknown`: `Array.isArray` on an `unknown` widens to
    // `any[]`, which would silently disable every check below it.
    const annotations: unknown[] = Array.isArray(annotationsValue)
        ? (annotationsValue as unknown[])
        : [];
    const first: unknown = annotations[0];
    if (first === null || typeof first !== 'object' || Array.isArray(first)) {
        return null;
    }
    const annotationId = ownString(first, 'id');
    if (annotationId === undefined || !isAnnotationKey(annotationId)) {
        return null;
    }
    const position = ownObject(first, 'position');
    const pageIndex = position ? ownNumber(position, 'pageIndex') : undefined;

    return {
        kind: 'library',
        libraryID,
        annotationId,
        ...metaFields({
            pageIndex,
            pageLabel: ownString(first, 'pageLabel'),
            text: ownString(first, 'text'),
            comment: ownString(first, 'comment'),
            annotationType: ownString(first, 'type'),
        }),
    };
}

/** Drops the absent fields so a ref never carries explicit `undefined`. */
export function metaFields(meta: ZotflowAnnotationMeta): ZotflowAnnotationMeta {
    const pageIndex =
        typeof meta.pageIndex === 'number' && Number.isInteger(meta.pageIndex) && meta.pageIndex >= 0
            ? meta.pageIndex
            : undefined;
    const trimmed = (value: string | undefined): string | undefined => {
        const text = value?.trim();
        return text ? text : undefined;
    };
    return {
        ...(pageIndex !== undefined ? { pageIndex } : {}),
        ...(trimmed(meta.pageLabel) !== undefined ? { pageLabel: trimmed(meta.pageLabel) } : {}),
        ...(trimmed(meta.text) !== undefined ? { text: trimmed(meta.text) } : {}),
        ...(trimmed(meta.comment) !== undefined ? { comment: trimmed(meta.comment) } : {}),
        ...(trimmed(meta.annotationType) !== undefined
            ? { annotationType: trimmed(meta.annotationType) }
            : {}),
    };
}

// --- the link that reopens the annotation -------------------------------------

/**
 * The subpath that sends ZotFlow's reader back to this annotation.
 *
 * Shape and order are ZotFlow's own, as it writes them into source notes:
 *
 *   #page=<1-based page>#annotation=<urlencoded {"annotationID":…}>
 *
 * Two details are load-bearing:
 *
 * - `page` must come FIRST. ZotFlow extracts the annotation part with
 *   /annotation=([^&]+)/ and then JSON-parses it, so a `#page=` appended after
 *   it would be swallowed into the JSON and break the parse.
 * - `pageIndex` is repeated INSIDE the JSON on purpose. It is what the reader
 *   falls back to when the annotation id no longer resolves (deleted, or
 *   re-keyed by a highlight/underline conversion), which turns a dead reference
 *   into "the right page" instead of nothing.
 *
 * `#page=` itself carries the 1-based physical page, not the printed label,
 * because that is what Obsidian's own PDF view understands — ZotFlow ignores
 * this part entirely, so the only reader of it is the fallback viewer.
 */
export function buildAnnotationSubpath(annotationId: string, pageIndex?: number): string {
    const hasPage = typeof pageIndex === 'number' && Number.isInteger(pageIndex) && pageIndex >= 0;
    const navigation = JSON.stringify({
        annotationID: annotationId,
        ...(hasPage ? { pageIndex } : {}),
    });
    const pagePart = hasPage ? `#page=${pageIndex + 1}` : '';
    return `${pagePart}#annotation=${encodeURIComponent(navigation)}`;
}

/**
 * The URI that reopens a LIBRARY annotation: ZotFlow's own protocol handler,
 * which looks the annotation up in its database and navigates its parent
 * attachment there. Nothing else can address a library item.
 */
export function buildLibraryAnnotationUrl(ref: LibraryAnnotationRef): string {
    const params = new URLSearchParams({
        type: 'open-annotation',
        libraryID: String(ref.libraryID),
        key: ref.annotationId,
    });
    return `obsidian://zotflow?${params.toString()}`;
}
