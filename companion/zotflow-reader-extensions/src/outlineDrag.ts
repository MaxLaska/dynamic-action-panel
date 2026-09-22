// outlineDrag.ts
// Making an entry of the reader's own outline draggable, and saying precisely
// what was dragged.
//
// The rule this file follows: **the DOM is the handle, the reader's state is the
// truth.** The list in the sidebar is only how a person points at a section; the
// title, the depth, the destination and the page all come from
// `_reader._state.outline`, which is the structure the reader built from the
// document itself. Scraping the rendered text would throw away the hierarchy and
// the destination, and would be wrong the moment a title wraps or is truncated.
//
// Correlating the two is the delicate part, and the obvious key is a trap: the
// rendered rows carry `id="outline-N"` and `data-id="N"`, but N is the index in
// the CURRENTLY RENDERED sequence and renumbers on every expand and collapse —
// measured: expanding the seventh entry turned `outline-7` from "B
// Wissenschaftliches Arbeiten" into "1 Studieren". So neither is an identity.
//
// What IS stable is the shape of the tree. Collapsing hides descendants, never
// siblings, so the rendered list at every level holds exactly that level's nodes
// in order. The index path of a row through the rendered `ul`/`li` tree is
// therefore the index path of its node through the outline tree. Verified
// against a fully expanded 211-entry outline across depths 1 to 4: 211 of 211
// rows resolved to the node with the same title.

import { OWN, SELECTORS, readerOutlineState } from './readerContract';
import { closestFrom } from './sidebarPatch';

/**
 * The MIME type carrying a reader object to the panel.
 *
 * Deliberately generic in its name and explicit in its payload: the `kind`
 * field says what the object is, so a later reader object (a figure, a table)
 * travels the same channel without a second MIME type and without the panel
 * having to guess from shape.
 */
export const READER_OBJECT_MIME = 'application/x-dap-reader-object';

/** The reader's own destination object for an outline entry. */
export interface OutlineLocation {
    position: { pageIndex: number; rects: number[][] };
}

/** What a dragged outline entry tells the panel. */
export interface OutlineDragPayload {
    kind: 'pdf-outline';
    version: 1;
    /** Vault path of the document, supplied by the plugin, not by the reader. */
    filePath: string;
    title: string;
    /** Depth in the outline tree; 0 is a top-level entry. */
    level: number;
    /** Ancestor titles, outermost first, excluding the entry itself. */
    parents: string[];
    /** 0-based page index the entry points at. */
    pageIndex: number;
    /** Printed page label of that page, when the document numbers its pages. */
    pageLabel?: string;
    /**
     * Where the NEXT entry at the same or a shallower level starts.
     *
     * This is a neighbour's start read off the same outline, not an end and not
     * an estimate. It is carried because it is exact and free; a section whose
     * successor is unknown simply omits it rather than getting a guess.
     */
    nextPageIndex?: number;
    /** The reader's own destination, passed through untouched. */
    location: OutlineLocation;
}

/** One outline node as the reader keeps it. */
interface OutlineNode {
    title?: unknown;
    items?: unknown;
    location?: unknown;
}

/** Trimmed title; the reader's titles routinely carry a trailing carriage return. */
function titleOf(node: OutlineNode): string {
    return typeof node.title === 'string' ? node.title.trim() : '';
}

/** Children of a node, as an array, whatever the node actually holds. */
function itemsOf(node: OutlineNode): OutlineNode[] {
    return Array.isArray(node.items) ? (node.items as OutlineNode[]) : [];
}

/** The reader's destination for a node, when it has a usable one. */
function locationOf(node: OutlineNode): OutlineLocation | null {
    const location = node.location;
    if (!location || typeof location !== 'object') return null;
    const position = (location as { position?: unknown }).position;
    if (!position || typeof position !== 'object') return null;
    const pageIndex = (position as { pageIndex?: unknown }).pageIndex;
    if (typeof pageIndex !== 'number' || !Number.isInteger(pageIndex) || pageIndex < 0) {
        return null;
    }
    const rectsValue = (position as { rects?: unknown }).rects;
    const rects: number[][] = Array.isArray(rectsValue)
        ? (rectsValue as unknown[])
              .filter((r): r is number[] => Array.isArray(r) && r.every((n) => typeof n === 'number'))
              .map((r) => [...r])
        : [];
    return { position: { pageIndex, rects } };
}

/**
 * The index path of a rendered row through the outline tree.
 *
 * The climb asks for the nearest ancestor `li` rather than assuming the list's
 * parent is one: the reader wraps every nested list in a `div.children`, so a
 * direct `parentElement` check stops one level too early and silently produces
 * a short path that resolves to the wrong node. That mistake resolved 20 of 22
 * rows correctly, which is exactly the kind of wrong that survives a quick look.
 */
export function outlineIndexPath(row: Element | null): number[] | null {
    const path: number[] = [];
    let current: Element | null = row;
    while (current) {
        const list = current.parentElement;
        if (!list || list.tagName !== 'UL') return null;
        const siblings = Array.from(list.children).filter((c) => c.tagName === 'LI');
        const at = siblings.indexOf(current);
        if (at < 0) return null;
        path.unshift(at);
        current = list.parentElement ? list.parentElement.closest('li') : null;
    }
    return path.length > 0 ? path : null;
}

/** The node an index path names, with the titles of its ancestors. */
export function resolveOutlineNode(
    outline: unknown,
    path: number[]
): { node: OutlineNode; parents: string[] } | null {
    let list: OutlineNode[] = Array.isArray(outline) ? (outline as OutlineNode[]) : [];
    const parents: string[] = [];
    let node: OutlineNode | null = null;
    for (const index of path) {
        const next = list[index];
        if (!next || typeof next !== 'object') return null;
        if (node) parents.push(titleOf(node));
        node = next;
        list = itemsOf(next);
    }
    return node ? { node, parents } : null;
}

/**
 * Every node in document order, with its depth — the order the outline is read
 * in, which is what makes "the next entry at the same or a shallower level"
 * answerable without a second pass over the tree.
 */
export function flattenOutline(outline: unknown): Array<{ depth: number; pageIndex: number | null }> {
    const flat: Array<{ depth: number; pageIndex: number | null }> = [];
    const walk = (nodes: OutlineNode[], depth: number): void => {
        for (const node of nodes) {
            flat.push({ depth, pageIndex: locationOf(node)?.position.pageIndex ?? null });
            walk(itemsOf(node), depth + 1);
        }
    };
    walk(Array.isArray(outline) ? (outline as OutlineNode[]) : [], 0);
    return flat;
}

/**
 * Where the entry after this one, at the same or a shallower level, begins.
 *
 * Returns undefined for the last such entry, and for a successor that starts on
 * the same page — a boundary that would say nothing is better left unsaid than
 * written down as if it meant something.
 */
export function nextSectionStart(
    outline: unknown,
    path: number[],
    pageIndex: number
): number | undefined {
    const flat = flattenOutline(outline);
    // The entry's own position in document order is its index among all nodes
    // visited before it, which the path gives directly.
    const ordinal = documentOrdinal(outline, path);
    if (ordinal === null) return undefined;
    const depth = path.length - 1;
    for (let i = ordinal + 1; i < flat.length; i++) {
        const candidate = flat[i];
        if (!candidate || candidate.depth > depth) continue;
        if (candidate.pageIndex === null || candidate.pageIndex <= pageIndex) return undefined;
        return candidate.pageIndex;
    }
    return undefined;
}

/** How many nodes precede this one in document order. */
function documentOrdinal(outline: unknown, path: number[]): number | null {
    let list: OutlineNode[] = Array.isArray(outline) ? (outline as OutlineNode[]) : [];
    let ordinal = -1;
    for (const index of path) {
        const node = list[index];
        if (!node) return null;
        // Every earlier sibling contributes itself and its whole subtree.
        for (let i = 0; i < index; i++) {
            const sibling = list[i];
            if (sibling) ordinal += 1 + subtreeSize(sibling);
        }
        ordinal += 1;
        list = itemsOf(node);
    }
    return ordinal;
}

function subtreeSize(node: OutlineNode): number {
    return itemsOf(node).reduce((total, child) => total + 1 + subtreeSize(child), 0);
}

/** The payload for a row, or null when the reader cannot place the entry. */
export function buildOutlinePayload(options: {
    outline: unknown;
    pageLabels: unknown;
    filePath: string;
    path: number[];
}): OutlineDragPayload | null {
    const resolved = resolveOutlineNode(options.outline, options.path);
    if (!resolved) return null;
    const title = titleOf(resolved.node);
    const location = locationOf(resolved.node);
    // A section with no destination cannot be navigated to, so it is not
    // offered: a tool that does nothing would be worse than no tool.
    if (!title || !location) return null;

    const pageIndex = location.position.pageIndex;
    const labels = Array.isArray(options.pageLabels) ? (options.pageLabels as unknown[]) : [];
    const rawLabel = labels[pageIndex];
    const pageLabel = typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel.trim() : undefined;
    const nextPageIndex = nextSectionStart(options.outline, options.path, pageIndex);

    return {
        kind: 'pdf-outline',
        version: 1,
        filePath: options.filePath,
        title,
        level: options.path.length - 1,
        parents: resolved.parents,
        pageIndex,
        ...(pageLabel !== undefined ? { pageLabel } : {}),
        ...(nextPageIndex !== undefined ? { nextPageIndex } : {}),
        location,
    };
}

/** What one bound outline needs torn down again. */
export interface OutlineBinding {
    disconnect(): void;
}

/**
 * Makes the outline rows draggable and describes what leaves them.
 *
 * Three things are deliberately left alone. Clicking a row still navigates,
 * because nothing here handles `click`. The expand/collapse control still
 * works, because `draggable` does not swallow clicks and a drag only begins
 * once the pointer actually moves. And a row the reader re-renders is covered
 * by the same observer the sidebar patch already runs, so this never polls.
 */
export function bindOutlineDrag(
    doc: Document,
    options: { filePath(): string | null; onPayloadFailed(reason: string): void }
): OutlineBinding {
    const win = doc.defaultView;
    if (!win) return { disconnect: () => undefined };

    const onDragStart = (event: Event): void => {
        const row = closestFrom(event.target, SELECTORS.outlineItem);
        if (!row) return;
        const li = row.closest('li');
        const filePath = options.filePath();
        const state = readerOutlineState(win);
        if (!li || !filePath || !state) {
            options.onPayloadFailed('no outline state or no file for this reader');
            return;
        }
        const path = outlineIndexPath(li);
        const payload = path
            ? buildOutlinePayload({
                  outline: state.outline,
                  pageLabels: state.pageLabels,
                  filePath,
                  path,
              })
            : null;
        if (!payload) {
            options.onPayloadFailed('could not place this row in the outline tree');
            return;
        }
        const transfer = (event as DragEvent).dataTransfer;
        if (!transfer) return;
        transfer.setData(READER_OBJECT_MIME, JSON.stringify(payload));
        transfer.effectAllowed = 'copy';
    };

    doc.addEventListener('dragstart', onDragStart, true);

    return {
        disconnect(): void {
            doc.removeEventListener('dragstart', onDragStart, true);
            for (const row of Array.from(doc.querySelectorAll(SELECTORS.outlineItem))) {
                row.removeAttribute('draggable');
                row.classList.remove(OWN.draggableRow);
            }
        },
    };
}

/**
 * Marks every outline row as draggable, and says how many it had to change.
 *
 * Idempotent, and keyed on the ATTRIBUTE rather than on our own marker class.
 * That matters: the two can disagree — a re-render that keeps the class but
 * drops the attribute would leave a row that looks marked and is not draggable,
 * and keying on the class would never notice. The class is kept alongside, as
 * something to ask about from the outside, but it is never the question.
 *
 * Costs one attribute read per row and runs from the reader's own mutation
 * observer, so nothing here polls.
 */
export function markOutlineRowsDraggable(doc: Document): number {
    let marked = 0;
    for (const row of Array.from(doc.querySelectorAll(SELECTORS.outlineItem))) {
        row.classList.add(OWN.draggableRow);
        if (row.getAttribute('draggable') === 'true') continue;
        row.setAttribute('draggable', 'true');
        marked++;
    }
    return marked;
}
