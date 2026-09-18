// zotflowReader.ts
// The ONE place that knows anything about ZotFlow's insides.
//
// Everything ZotFlow-version-specific is collected here — view type string,
// frontmatter key, reader globals — so the rest of the plugin only ever sees
// plain values (a vault path, an annotation id, a page). Two jobs:
//
// 1. Resolve a source-note embed to the file it annotates (LEVEL 1: ordinary
//    vault metadata — a wikilink in the note's frontmatter). This is the normal
//    path and needs nothing private.
//
// 2. Read which annotation is currently being dragged, and what it says, from
//    the open reader (LEVEL 3: the reader's own globals). Needed because a
//    ZotFlow annotation drag carries NO usable payload when the file has no
//    source note, and because the embed alone carries no page or text for the
//    label. Strictly read-only: nothing here writes to ZotFlow, its sidecars or
//    its annotations.
//
// ZotFlow 1.6.5 compatibility adapter. Every field is probed with `typeof`
// before use and nothing here throws: when ZotFlow changes, capture degrades to
// "not an annotation" and the drop falls through to the normal file handling.
// Details and the empirical basis:
// docs/ocap/audits/2026-09-18-zotflow-annotation-integration.md

import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import {
    basenameOf,
    isAnnotationKey,
    metaFields,
    type LocalAnnotationRef,
    type ZotflowAnnotationMeta,
} from '@/utils/zotflowAnnotationDrop';

/** ZotFlow's view type for a vault file opened in its reader (1.6.5). */
const LOCAL_READER_VIEW_TYPE = 'zotflow-local-zotero-reader-view';

/**
 * Frontmatter key ZotFlow writes into a source note, holding a wikilink to the
 * file the note annotates. This is the documented-by-usage link between note and
 * PDF, and the only thing that makes an `![[note#^id]]` payload resolvable.
 */
const ATTACHMENT_FRONTMATTER_KEY = 'zotflow-local-attachment';

// --- narrow structural views of ZotFlow's objects -----------------------------

/** The annotation record ZotFlow keeps (Zotero reader shape). */
interface ReaderAnnotation {
    id?: unknown;
    type?: unknown;
    text?: unknown;
    comment?: unknown;
    pageLabel?: unknown;
    position?: unknown;
}

interface LocalReaderView {
    getState?: () => unknown;
    file?: unknown;
    containerEl?: unknown;
    dataManager?: { getAnnotation?: (id: string) => unknown };
}

function asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readString(source: Record<string, unknown> | null, key: string): string | undefined {
    const value = source?.[key];
    return typeof value === 'string' ? value : undefined;
}

// --- level 1: source note -> annotated file -----------------------------------

/**
 * The link target inside a frontmatter value that should hold a wikilink.
 *
 * ZotFlow writes it quoted (`"[[A2_Bib/…/x.pdf]]"`), so Obsidian yields the
 * string with its brackets. An unquoted value would come back as nested arrays
 * instead, which is why a list is unwrapped rather than rejected.
 */
function frontmatterLinkTarget(value: unknown, depth = 0): string | null {
    if (depth > 3) {
        return null;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = frontmatterLinkTarget(entry, depth + 1);
            if (found) return found;
        }
        return null;
    }
    if (typeof value !== 'string') {
        return null;
    }
    const raw = value.trim();
    const wiki = /^!?\[\[([^\]]+)\]\]$/.exec(raw);
    const inner = (wiki ? (wiki[1] ?? '') : raw).split('|')[0]?.trim() ?? '';
    return inner.length > 0 ? inner : null;
}

/**
 * The file a ZotFlow source note annotates, or null when this note is not a
 * ZotFlow source note at all.
 *
 * The frontmatter key is the discriminator that makes the whole local capture
 * safe: an ordinary Obsidian block embed may look identical to ZotFlow's drag
 * payload, but only a real source note points back at an attachment. When this
 * returns null the caller must fall through to the normal file handling.
 */
export function resolveAnnotatedFile(app: App, notePath: string): TFile | null {
    try {
        const note = app.metadataCache.getFirstLinkpathDest(notePath, '');
        if (!note) {
            return null;
        }
        const frontmatter = asObject(app.metadataCache.getFileCache(note)?.frontmatter);
        if (!frontmatter) {
            return null;
        }
        const target = frontmatterLinkTarget(frontmatter[ATTACHMENT_FRONTMATTER_KEY]);
        if (!target) {
            return null;
        }
        // Resolved relative to the note, as Obsidian resolves any link in it.
        return app.metadataCache.getFirstLinkpathDest(target, note.path);
    } catch {
        return null;
    }
}

// --- level 3: the open reader -------------------------------------------------

/** The vault path a reader leaf is showing, however it exposes it. */
function readerFilePath(view: LocalReaderView): string | undefined {
    const fromFile = readString(asObject(view.file), 'path');
    if (fromFile) {
        return fromFile;
    }
    try {
        return readString(asObject(view.getState?.()), 'file');
    } catch {
        return undefined;
    }
}

/**
 * Whether the focus of the surrounding document sits inside this leaf.
 *
 * Pressing the mouse inside a same-origin iframe focuses the iframe ELEMENT in
 * the parent document, so during a drag out of a reader this points at the
 * reader the gesture started in — evidence about this drag rather than about the
 * session. Uses the leaf's own document so a popout window works too.
 */
function holdsFocus(leaf: WorkspaceLeaf): boolean {
    try {
        const container = (leaf.view as unknown as LocalReaderView).containerEl;
        if (!container || typeof container !== 'object') {
            return false;
        }
        const element = container as HTMLElement;
        const active = element.ownerDocument?.activeElement;
        return active !== null && active !== undefined && element.contains(active);
    } catch {
        return false;
    }
}

/** Every open ZotFlow reader leaf; empty when ZotFlow is absent or idle. */
function localReaderLeaves(app: App): WorkspaceLeaf[] {
    try {
        return app.workspace.getLeavesOfType(LOCAL_READER_VIEW_TYPE);
    } catch {
        return [];
    }
}

/** Display metadata of one annotation known to this leaf, if it knows it. */
function annotationMetaOf(view: LocalReaderView, annotationId: string): ZotflowAnnotationMeta | null {
    const getAnnotation = view.dataManager?.getAnnotation;
    if (typeof getAnnotation !== 'function') {
        return null;
    }
    let record: unknown;
    try {
        record = getAnnotation.call(view.dataManager, annotationId);
    } catch {
        return null;
    }
    const annotation = asObject(record) as ReaderAnnotation | null;
    if (!annotation || readString(asObject(annotation), 'id') !== annotationId) {
        return null;
    }
    const position = asObject(annotation.position);
    const pageIndex = position?.['pageIndex'];
    return metaFields({
        ...(typeof pageIndex === 'number' ? { pageIndex } : {}),
        pageLabel: readString(asObject(annotation), 'pageLabel'),
        text: readString(asObject(annotation), 'text'),
        comment: readString(asObject(annotation), 'comment'),
        annotationType: readString(asObject(annotation), 'type'),
    });
}

/**
 * Page, text and type of an annotation in a given file — best effort, and only
 * from a reader that actually has that file open. Absent metadata costs the
 * label its detail and the reference its page fallback; the annotation id, which
 * is what reopens it, never depends on this.
 */
export function readAnnotationMeta(
    app: App,
    filePath: string,
    annotationId: string
): ZotflowAnnotationMeta | null {
    for (const leaf of localReaderLeaves(app)) {
        try {
            const view = leaf?.view as unknown as LocalReaderView | undefined;
            if (!view || readerFilePath(view) !== filePath) {
                continue;
            }
            const meta = annotationMetaOf(view, annotationId);
            if (meta) {
                return meta;
            }
        } catch {
            // A leaf shaped differently than expected is simply not an answer.
        }
    }
    return null;
}

/**
 * The page the document prints for this annotation, as ZotFlow has it NOW.
 *
 * A page label is not a fixed property of a highlight: ZotFlow lets the user
 * correct it afterwards ("Edit Page Number"), which is routine because PDFs
 * usually carry an offset between the physical page and the printed folio. Only
 * `pageLabel` changes then — the annotation id and `pageIndex` stay — so a
 * bookmark can show the corrected page while still navigating by the same id.
 *
 * Two sources, cheapest first, and neither depends on the other:
 * 1. an open reader for that file, straight from memory;
 * 2. otherwise ZotFlow's own sidecar, read through Obsidian's cached read.
 *
 * Returns null when the annotation cannot be found at all — the caller then
 * keeps whatever was captured, rather than dropping the page.
 *
 * @param app Obsidian app
 * @param filePath Vault path of the annotated document
 * @param annotationId The annotation's stable id
 */
export async function resolveCurrentPageLabel(
    app: App,
    filePath: string,
    annotationId: string
): Promise<string | null> {
    // Never rejects and never throws: this runs while the pointer is moving, so
    // the only acceptable failure is "I do not know", which the caller answers by
    // keeping what was captured.
    try {
        if (typeof filePath !== 'string' || typeof annotationId !== 'string') {
            return null;
        }
        const fromReader = readAnnotationMeta(app, filePath, annotationId)?.pageLabel;
        if (fromReader) {
            return fromReader;
        }
        return await readSidecarPageLabel(app, filePath, annotationId);
    } catch {
        return null;
    }
}

/**
 * The sidecar ZotFlow keeps for a document, found rather than derived.
 *
 * The path follows the `localSidecarFolder` setting, but the order of the
 * document's own folder and that setting differs between ZotFlow builds (the
 * installed one is locally patched), so both candidates are probed and the one
 * that exists wins. Two path lookups, no scanning.
 */
function findSidecar(app: App, filePath: string): TFile | null {
    const slash = filePath.lastIndexOf('/');
    const dir = slash === -1 ? '' : filePath.slice(0, slash);
    const fileName = slash === -1 ? filePath : filePath.slice(slash + 1);
    const dot = fileName.lastIndexOf('.');
    const basename = dot === -1 ? fileName : fileName.slice(0, dot);

    const folder = sidecarFolderSetting(app).replace(/^\/+|\/+$/g, '');
    const dirPart = dir ? `${dir}/` : '';
    const folderPart = folder ? `${folder}/` : '';
    const candidates = [
        `${dirPart}${folderPart}${basename}.zf.json`,
        `${folderPart}${dirPart}${basename}.zf.json`,
    ];

    for (const candidate of candidates) {
        try {
            const file = app.vault.getFileByPath(candidate.replace(/\/+/g, '/'));
            if (file) {
                return file;
            }
        } catch {
            // Keep probing; a bad candidate is not an error.
        }
    }
    return null;
}

/**
 * ZotFlow's configured sidecar folder, or '' (its default: next to the
 * document).
 *
 * Read from the live plugin, so a DISABLED ZotFlow yields '' — the sidecar of a
 * vault that configures a folder is then not found and the caller keeps its
 * captured page. That is the right outcome: with ZotFlow off, the bookmark
 * cannot navigate either, so there is nothing to be current about.
 */
function sidecarFolderSetting(app: App): string {
    try {
        const plugin = (
            app as unknown as {
                plugins?: { plugins?: Record<string, { settings?: unknown }> };
            }
        ).plugins?.plugins?.['zotflow'];
        const value = asObject(plugin?.settings)?.['localSidecarFolder'];
        return typeof value === 'string' ? value : '';
    } catch {
        return '';
    }
}

/** `pageLabel` of one annotation inside the sidecar, or null. */
async function readSidecarPageLabel(
    app: App,
    filePath: string,
    annotationId: string
): Promise<string | null> {
    const sidecar = findSidecar(app, filePath);
    if (!sidecar) {
        return null;
    }
    try {
        // Obsidian's cached read: repeated hovers do not hit the disk again.
        const parsed: unknown = JSON.parse(await app.vault.cachedRead(sidecar));
        const annotations = asObject(parsed)?.['annotations'];
        if (!Array.isArray(annotations)) {
            return null;
        }
        for (const entry of annotations as unknown[]) {
            const record = asObject(entry);
            if (readString(record, 'id') !== annotationId) {
                continue;
            }
            const pageLabel = readString(record, 'pageLabel')?.trim();
            return pageLabel ? pageLabel : null;
        }
        return null;
    } catch {
        // Missing, unreadable or not JSON: the caller keeps its snapshot.
        return null;
    }
}

/**
 * The ids the reader believes are being dragged right now.
 *
 * Upstream Zotero's reader parks them on its own iframe window at dragstart. The
 * iframe is same-origin (a blob: document under the Obsidian app origin), so the
 * parent can read it — but it is never cleared when a drag ends, so the value
 * alone proves nothing. It is only ever used together with the guards in
 * `readDraggedLocalAnnotation`.
 */
function draggingAnnotationIds(view: LocalReaderView): string[] {
    const container = view.containerEl;
    if (!container || typeof container !== 'object') {
        return [];
    }
    // The PROPERTY READ has to be inside the guard, not just the lookup: a
    // cross-origin frame hands back a WindowProxy without complaint and only
    // throws when a non-whitelisted property is touched.
    try {
        const iframe = (container as HTMLElement).querySelector?.('iframe');
        const ids = asObject(iframe?.contentWindow)?.['_draggingAnnotationIDs'];
        if (!Array.isArray(ids)) {
            return [];
        }
        return ids.filter((id): id is string => typeof id === 'string' && isAnnotationKey(id));
    } catch {
        // Cross-origin, detached, or a frame that is not the reader's.
        return [];
    }
}

/**
 * The annotation this drag is carrying, read from the reader itself — the only
 * route when the file has no source note and ZotFlow's payload is a bare space.
 *
 * The ids on the reader window are stale-prone (never cleared), so a match is
 * only accepted when the leaf that claims the drag also OWNS that annotation:
 * `dataManager` must still resolve it. When `expectedId` is given (the payload
 * named an annotation but its note did not resolve to a file) the reader must
 * agree with it, so a leftover id can never substitute a different annotation.
 * Anything short of that returns null — no tool is better than a wrong one.
 */
export function readDraggedLocalAnnotation(
    app: App,
    expectedId?: string
): LocalAnnotationRef | null {
    const candidates: { leaf: WorkspaceLeaf; ref: LocalAnnotationRef }[] = [];

    for (const leaf of localReaderLeaves(app)) {
        const view = leaf.view as unknown as LocalReaderView;
        const filePath = readerFilePath(view);
        if (!filePath) {
            continue;
        }
        for (const annotationId of draggingAnnotationIds(view)) {
            if (expectedId !== undefined && annotationId !== expectedId) {
                continue;
            }
            const meta = annotationMetaOf(view, annotationId);
            if (!meta) {
                // This leaf does not own the id, so it is not this leaf's drag.
                continue;
            }
            candidates.push({
                leaf,
                ref: {
                    kind: 'local',
                    filePath,
                    fileBasename: basenameOf(filePath),
                    annotationId,
                    ...meta,
                },
            });
        }
    }

    if (candidates.length === 1) {
        return candidates[0]!.ref;
    }
    if (candidates.length === 0) {
        return null;
    }
    // Several readers claim a drag, which happens because ZotFlow never clears
    // these ids: every reader the user has ever dragged from still looks busy.
    // Taking the first in tree order would silently capture an annotation from a
    // different document, so the tie needs actual evidence.

    // Best evidence, and specific to THIS drag: a drag begins with a mousedown
    // inside the reader's iframe, which moves the surrounding document's focus
    // to that iframe element.
    const focused = candidates.filter((candidate) => holdsFocus(candidate.leaf));
    if (focused.length === 1) {
        return focused[0]!.ref;
    }

    // Weaker, session-level evidence: the reader the user last worked in.
    let recent: WorkspaceLeaf | null = null;
    try {
        recent = app.workspace.getMostRecentLeaf();
    } catch {
        recent = null;
    }
    const inRecentLeaf = candidates.filter((candidate) => candidate.leaf === recent);
    if (inRecentLeaf.length === 1) {
        return inRecentLeaf[0]!.ref;
    }

    console.warn(
        '[Dynamic Action Panel] Several ZotFlow readers claim a dragged annotation; ' +
            'refusing to guess which one it is.'
    );
    return null;
}

/** File name without folders or extension. */
export { basenameOf } from '@/utils/zotflowAnnotationDrop';
