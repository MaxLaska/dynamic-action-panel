// Tests for the reader side of an outline drag: placing a rendered row in the
// outline tree, and describing the section it names.
//
// The correlation these tests protect is the one thing about this feature that
// is easy to get plausibly wrong. The rendered rows carry `id="outline-N"` and
// `data-id="N"`, which look like identities and are not: N is the index in the
// CURRENTLY RENDERED sequence and renumbers on every expand — measured against
// a live reader, expanding the seventh entry turned `outline-7` from
// "B Wissenschaftliches Arbeiten" into "1 Studieren". The index PATH through
// the tree is stable instead, because collapsing hides descendants and never
// siblings.

import { describe, expect, it } from 'vitest';

import {
    buildOutlinePayload,
    flattenOutline,
    nextSectionStart,
    outlineIndexPath,
    resolveOutlineNode,
} from '../companion/zotflow-reader-extensions/src/outlineDrag';

// --- a small outline, shaped exactly like the reader's -----------------------

const node = (title: string, pageIndex: number | null, items: unknown[] = []) => ({
    title: `${title}\r`, // the reader's titles carry a trailing carriage return
    items,
    ...(pageIndex === null
        ? {}
        : { location: { position: { pageIndex, rects: [[28, 658.331, 28, 658.331]] } } }),
});

const outline = [
    node('Deckblatt', 0),
    node('A Soziale Arbeit studieren', 6, [
        node('1 Studieren', 8, [
            node('1.1 Akademisches Lernen', 9),
            node('1.2 Motivation', 12),
            node('1.3 Verhalten an der Hochschule', 20, [
                node('1.3.1 Umgang mit Kommilitoninnen', 21),
            ]),
        ]),
        node('2 Planung', 30),
    ]),
    node('B Wissenschaftliches Arbeiten', 40),
];

const pageLabels = Array.from({ length: 60 }, (_, i) => (i === 0 ? 'Cover' : String(i)));

// --- a minimal DOM double, shaped like the reader's rendered list -------------
//
// The reader nests each child list inside a `div.children`, which is exactly
// what makes a naive `parentElement` climb stop one level too early.

interface FakeEl {
    tagName: string;
    children: FakeEl[];
    parentElement: FakeEl | null;
    closest(selector: string): FakeEl | null;
}

function el(tagName: string, children: FakeEl[] = []): FakeEl {
    const element: FakeEl = {
        tagName,
        children,
        parentElement: null,
        closest: () => null,
    };
    // Closed over `element` rather than written against `this`, so the double
    // behaves the same however it is called or destructured.
    element.closest = (selector: string): FakeEl | null => {
        const wanted = selector.toUpperCase();
        let current: FakeEl | null = element;
        while (current) {
            if (current.tagName === wanted) return current;
            current = current.parentElement;
        }
        return null;
    };
    for (const child of children) child.parentElement = element;
    return element;
}

/** Builds the rendered list for a tree, expanding the branches named by `open`. */
function render(nodes: typeof outline, open: Set<string>, depthPath: number[] = []): FakeEl {
    const items = nodes.map((child, index) => {
        const path = [...depthPath, index];
        const title = String(child.title).trim();
        const kids = (child.items ?? []) as typeof outline;
        const parts: FakeEl[] = [el('DIV')]; // div.item, the row itself
        if (kids.length > 0 && open.has(title)) {
            parts.push(el('DIV', [render(kids, open, path)])); // div.children > ul
        }
        return el('LI', parts);
    });
    return el('UL', items);
}

/** The nth rendered row, in document order. */
function rowAt(root: FakeEl, index: number): FakeEl {
    const rows: FakeEl[] = [];
    const walk = (element: FakeEl): void => {
        if (element.tagName === 'LI') rows.push(element);
        for (const child of element.children) walk(child);
    };
    walk(root);
    const row = rows[index];
    if (!row) throw new Error(`no rendered row ${index}`);
    return row;
}

const path = (root: FakeEl, index: number) =>
    outlineIndexPath(rowAt(root, index) as unknown as Element);

// --- placing a row in the tree ------------------------------------------------

describe('placing a rendered row in the outline tree', () => {
    it('places top-level rows when everything is collapsed', () => {
        const root = render(outline, new Set());
        expect(path(root, 0)).toEqual([0]);
        expect(path(root, 1)).toEqual([1]);
        expect(path(root, 2)).toEqual([2]);
    });

    // The wrapper is the trap: climbing by `parentElement` alone stops at the
    // `div.children` and yields a short path that resolves to the wrong node.
    it('climbs through the wrapper the reader puts around nested lists', () => {
        const root = render(outline, new Set(['A Soziale Arbeit studieren']));
        expect(path(root, 1)).toEqual([1]); // A Soziale Arbeit studieren
        expect(path(root, 2)).toEqual([1, 0]); // 1 Studieren
        expect(path(root, 3)).toEqual([1, 1]); // 2 Planung
    });

    it('places rows several levels down', () => {
        const root = render(
            outline,
            new Set(['A Soziale Arbeit studieren', '1 Studieren', '1.3 Verhalten an der Hochschule'])
        );
        expect(path(root, 5)).toEqual([1, 0, 2]); // 1.3
        expect(path(root, 6)).toEqual([1, 0, 2, 0]); // 1.3.1
    });

    // Rendered position changes with every expand; the path does not. This is
    // the property the whole correlation rests on.
    it('gives a row the same path whatever else is expanded', () => {
        const collapsed = render(outline, new Set());
        const expanded = render(outline, new Set(['A Soziale Arbeit studieren']));
        expect(path(collapsed, 2)).toEqual([2]); // B, third rendered row
        expect(path(expanded, 4)).toEqual([2]); // B, now the fifth rendered row
    });

    it('declines a row that is not in a list', () => {
        expect(outlineIndexPath(el('LI') as unknown as Element)).toBeNull();
        expect(outlineIndexPath(null)).toBeNull();
    });
});

describe('resolving a path to its node', () => {
    it('finds the node and names its ancestors', () => {
        const resolved = resolveOutlineNode(outline, [1, 0, 2]);
        expect(String(resolved?.node.title).trim()).toBe('1.3 Verhalten an der Hochschule');
        expect(resolved?.parents).toEqual(['A Soziale Arbeit studieren', '1 Studieren']);
    });

    it('has no ancestors for a top-level node', () => {
        expect(resolveOutlineNode(outline, [0])?.parents).toEqual([]);
    });

    it.each([
        ['a path past the end', [9]],
        ['a path into a leaf', [0, 0]],
        ['an empty outline', []],
    ])('declines %s', (_label, indexPath) => {
        expect(resolveOutlineNode(indexPath.length ? outline : [], indexPath)).toBeNull();
    });

    it('declines an outline that is not a list', () => {
        expect(resolveOutlineNode(null, [0])).toBeNull();
        expect(resolveOutlineNode({ nope: true }, [0])).toBeNull();
    });
});

// --- the section boundary ------------------------------------------------------

describe('where the next section begins', () => {
    it('flattens the tree in document order', () => {
        expect(flattenOutline(outline).map((n) => n.depth)).toEqual([
            0, 0, 1, 2, 2, 2, 3, 1, 0,
        ]);
    });

    it('is the next entry at the same level', () => {
        // 1.1 (page 9) is followed by 1.2 (page 12).
        expect(nextSectionStart(outline, [1, 0, 0], 9)).toBe(12);
    });

    it('is the next entry at a SHALLOWER level when there is no sibling left', () => {
        // 1.3 is the last child of "1 Studieren", so the boundary is "2 Planung".
        expect(nextSectionStart(outline, [1, 0, 2], 20)).toBe(30);
    });

    it('ignores the section\'s own children', () => {
        // 1.3.1 starts on page 21 and is inside 1.3; the boundary is still 30.
        expect(nextSectionStart(outline, [1, 0, 2], 20)).toBe(30);
    });

    it('has no boundary for the last entry of the document', () => {
        expect(nextSectionStart(outline, [2], 40)).toBeUndefined();
    });

    // A boundary that is not after the section is not a boundary. Saying
    // nothing is better than recording a zero-length section as if measured.
    it('says nothing when the next entry shares the page', () => {
        const sharing = [node('One', 5), node('Two', 5)];
        expect(nextSectionStart(sharing, [0], 5)).toBeUndefined();
    });

    it('says nothing when the next entry has no destination', () => {
        const broken = [node('One', 5), node('Two', null), node('Three', 9)];
        expect(nextSectionStart(broken, [0], 5)).toBeUndefined();
    });
});

// --- the payload ----------------------------------------------------------------

describe('describing the dragged section', () => {
    const build = (indexPath: number[]) =>
        buildOutlinePayload({ outline, pageLabels, filePath: 'refs/Book.pdf', path: indexPath });

    it('carries the title, the depth and the ancestors', () => {
        const result = build([1, 0, 2]);
        expect(result).toMatchObject({
            kind: 'pdf-outline',
            version: 1,
            filePath: 'refs/Book.pdf',
            title: '1.3 Verhalten an der Hochschule',
            level: 2,
            parents: ['A Soziale Arbeit studieren', '1 Studieren'],
            pageIndex: 20,
        });
    });

    it('trims the carriage return the reader leaves on every title', () => {
        expect(build([0])?.title).toBe('Deckblatt');
    });

    it('carries the reader\'s own destination untouched', () => {
        expect(build([1, 0, 0])?.location).toEqual({
            position: { pageIndex: 9, rects: [[28, 658.331, 28, 658.331]] },
        });
    });

    it('reads the printed page label, which need not be the page number', () => {
        expect(build([0])?.pageLabel).toBe('Cover');
        expect(build([1, 0, 0])?.pageLabel).toBe('9');
    });

    it('carries the next section boundary when there is one', () => {
        expect(build([1, 0, 0])?.nextPageIndex).toBe(12);
    });

    it('omits the boundary rather than guessing at the last section', () => {
        expect(build([2])?.nextPageIndex).toBeUndefined();
    });

    it('omits a page label the document does not have', () => {
        const result = buildOutlinePayload({
            outline,
            pageLabels: [],
            filePath: 'refs/Book.pdf',
            path: [0],
        });
        expect(result?.pageLabel).toBeUndefined();
    });

    // A section nobody can navigate to would become a tool that does nothing,
    // which is worse than no tool at all.
    it('refuses a section the reader gave no destination', () => {
        const undestined = [node('Preface', null)];
        expect(
            buildOutlinePayload({ outline: undestined, pageLabels, filePath: 'a.pdf', path: [0] })
        ).toBeNull();
    });

    it('refuses a section with no title', () => {
        const untitled = [{ title: '  ', items: [], location: { position: { pageIndex: 1, rects: [] } } }];
        expect(
            buildOutlinePayload({ outline: untitled, pageLabels, filePath: 'a.pdf', path: [0] })
        ).toBeNull();
    });

    it('refuses a path that does not resolve', () => {
        expect(build([9, 9])).toBeNull();
    });
});
