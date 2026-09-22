// Tests for a document section dragged out of the reader's outline: reading
// the payload, the link that navigates back, the tool it becomes, and the fact
// that it disturbs none of the drops that already worked.
//
// The reader-side half — correlating a rendered row with its node in the
// outline tree — is tested in companionOutlineDrag.test.ts, and the end-to-end
// behaviour against a live ZotFlow reader is covered by the companion's smoke
// script. These three layers cover different failures and none of them is
// redundant.

import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';

import {
    buildSectionSubpath,
    parseReaderOutlinePayload,
    READER_OBJECT_MIME,
    sectionDestination,
    type OutlineSectionRef,
} from '@/utils/readerOutlineDrop';
import { buildOutlineButtonDraft } from '@/utils/outlineButton';
import {
    canAcceptVaultFileDrag,
    resolveDroppedOutlineSection,
    resolveSlotDropDraft,
} from '@/utils/obsidianFileDrag';
import { parseAnnotationSubpath } from '@/utils/zotflowAnnotationDrop';

// --- fixtures ----------------------------------------------------------------

/** A payload exactly as the companion plugin writes it. */
function payload(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        kind: 'pdf-outline',
        version: 1,
        filePath: 'other/Bieker, Westerholt (2021) - Soziale Arbeit studieren/PaperA.pdf',
        title: '1.3 Verhalten an der Hochschule',
        level: 2,
        parents: ['A Soziale Arbeit studieren', '1 Studieren'],
        pageIndex: 105,
        pageLabel: '106',
        nextPageIndex: 110,
        location: { position: { pageIndex: 105, rects: [[28, 658.331, 28, 658.331]] } },
        ...overrides,
    });
}

function transfer(data: Record<string, string>): DataTransfer {
    return {
        types: Object.keys(data),
        getData: (mime: string) => data[mime] ?? '',
    } as unknown as DataTransfer;
}

/** An app whose drag manager holds nothing and whose vault resolves nothing. */
const emptyApp = {
    dragManager: { draggable: null },
    vault: { getAbstractFileByPath: () => null },
    metadataCache: { getFirstLinkpathDest: () => null },
    workspace: { getLeavesOfType: () => [] },
} as unknown as App;

// --- reading the payload ------------------------------------------------------

describe('reading a dragged outline section', () => {
    it('reads every field the companion sends', () => {
        const ref = parseReaderOutlinePayload(payload());
        expect(ref).not.toBeNull();
        expect(ref?.filePath).toContain('PaperA.pdf');
        expect(ref?.section).toEqual({
            title: '1.3 Verhalten an der Hochschule',
            level: 2,
            parents: ['A Soziale Arbeit studieren', '1 Studieren'],
            pageIndex: 105,
            // The reader's own destination point, re-expressed as a PDF
            // destination — top-left of the rect, zoom left alone.
            dest: [105, { name: 'XYZ' }, 28, 658.331, null],
            pageLabel: '106',
            nextPageIndex: 110,
        });
        expect(ref?.location.position.pageIndex).toBe(105);
        expect(ref?.location.position.rects).toEqual([[28, 658.331, 28, 658.331]]);
    });

    it('keeps the page label even when it disagrees with the page index', () => {
        // Printed folios routinely differ from physical pages; the label is the
        // document's own and is never recomputed.
        const ref = parseReaderOutlinePayload(payload({ pageIndex: 105, pageLabel: '87' }));
        expect(ref?.section.pageIndex).toBe(105);
        expect(ref?.section.pageLabel).toBe('87');
    });

    it.each([
        ['not JSON at all', 'not json'],
        ['an empty string', ''],
        ['a JSON array', '[]'],
        ['a JSON string', '"pdf-outline"'],
        ['null', 'null'],
    ])('declines %s', (_label, raw) => {
        expect(parseReaderOutlinePayload(raw)).toBeNull();
    });

    it('declines another kind of reader object', () => {
        expect(parseReaderOutlinePayload(payload({ kind: 'pdf-figure' }))).toBeNull();
    });

    it('declines a future payload version rather than guessing at it', () => {
        expect(parseReaderOutlinePayload(payload({ version: 2 }))).toBeNull();
    });

    it.each([
        ['no file path', { filePath: undefined }],
        ['an empty file path', { filePath: '' }],
        ['no title', { title: undefined }],
        ['no location', { location: undefined }],
        ['a location without a position', { location: {} }],
        ['a position without a page index', { location: { position: { rects: [] } } }],
        ['a negative page index', { location: { position: { pageIndex: -1, rects: [] } } }],
        ['a fractional page index', { location: { position: { pageIndex: 2.5, rects: [] } } }],
    ])('declines a payload with %s', (_label, overrides) => {
        expect(parseReaderOutlinePayload(payload(overrides))).toBeNull();
    });

    it('survives a payload with no optional fields at all', () => {
        const ref = parseReaderOutlinePayload(
            JSON.stringify({
                kind: 'pdf-outline',
                version: 1,
                filePath: 'a.pdf',
                title: 'Chapter',
                location: { position: { pageIndex: 0 } },
            })
        );
        expect(ref?.section).toEqual({ title: 'Chapter', level: 0, pageIndex: 0 });
        expect(ref?.location.position.rects).toEqual([]);
    });

    // A boundary that does not lie after the section says nothing, and a
    // recorded nothing is worse than an absence: later work would read it as a
    // measurement.
    it.each([
        ['equal to the start', 105],
        ['before the start', 40],
    ])('drops a next-section boundary %s', (_label, nextPageIndex) => {
        const ref = parseReaderOutlinePayload(payload({ nextPageIndex }));
        expect(ref?.section.nextPageIndex).toBeUndefined();
    });

    it('keeps only well-formed rectangles', () => {
        const ref = parseReaderOutlinePayload(
            payload({
                location: {
                    position: {
                        pageIndex: 3,
                        rects: [[1, 2, 3, 4], 'nope', [1, 'x', 3], [], [5, 6]],
                    },
                },
            })
        );
        expect(ref?.location.position.rects).toEqual([[1, 2, 3, 4], [5, 6]]);
    });

    it('keeps only string ancestors', () => {
        const ref = parseReaderOutlinePayload(payload({ parents: ['A', 7, null, '  ', 'B'] }));
        expect(ref?.section.parents).toEqual(['A', 'B']);
    });

    it('never adopts an unknown property', () => {
        const ref = parseReaderOutlinePayload(payload({ evil: 'payload', __proto__: {} }));
        expect(ref).not.toBeNull();
        expect(Object.keys(ref?.section ?? {})).not.toContain('evil');
        expect((ref as unknown as Record<string, unknown>)['evil']).toBeUndefined();
    });
});

// --- the link back ------------------------------------------------------------

describe('the subpath that navigates to a section', () => {
    const location = { position: { pageIndex: 105, rects: [[28, 658.3, 28, 658.3]] } };

    it('puts the page first, then the reader parameter', () => {
        // ZotFlow extracts `annotation=([^&]+)` and JSON-parses it, so anything
        // appended after that part would be swallowed into the JSON.
        expect(buildSectionSubpath(location)).toMatch(/^#page=106#annotation=/);
    });

    const decodeNavigation = (subpath: string): Record<string, unknown> => {
        const match = /annotation=([^&]+)/.exec(subpath);
        return JSON.parse(decodeURIComponent(match?.[1] ?? '')) as Record<string, unknown>;
    };

    // The destination branch of the reader's navigation consults no options,
    // which is the whole point: ZotFlow hands it a hardcoded `{behavior}` with
    // no `block`, and the position branch then centres the destination instead
    // of putting it at the top the way the reader's own outline does.
    it('leads with a destination, which is the branch that ignores options', () => {
        expect(decodeNavigation(buildSectionSubpath(location)).dest).toEqual([
            105,
            { name: 'XYZ' },
            28,
            658.3,
            null,
        ]);
    });

    it('still carries the position, for anything that does not know dest', () => {
        expect(decodeNavigation(buildSectionSubpath(location)).position).toEqual(
            location.position
        );
    });

    it('takes the top-left of the rectangle, not its bottom', () => {
        // PDF coordinates grow upwards, so the top edge is the larger y.
        const wide = { position: { pageIndex: 2, rects: [[10, 100, 200, 400]] } };
        expect(sectionDestination(wide)).toEqual([2, { name: 'XYZ' }, 10, 400, null]);
    });

    it('leaves the zoom alone', () => {
        // null in a PDF destination means "keep the current zoom" — the
        // reader's own outline does not change it either.
        expect(sectionDestination(location)?.[4]).toBeNull();
    });

    it('has no destination when the position carries no usable rectangle', () => {
        expect(sectionDestination({ position: { pageIndex: 3, rects: [] } })).toBeNull();
        expect(
            sectionDestination({ position: { pageIndex: 3, rects: [[1, 2]] } })
        ).toBeNull();
    });

    // A section with no rectangle still has to navigate, and the position
    // branch is what a reader without the destination branch uses anyway.
    it('falls back to the position alone when there is no destination', () => {
        const pageOnly = { position: { pageIndex: 7, rects: [] } };
        const decoded = decodeNavigation(buildSectionSubpath(pageOnly));
        expect(decoded.dest).toBeUndefined();
        expect(decoded.position).toEqual(pageOnly.position);
    });

    it('uses the 1-based physical page, so a plain PDF view still lands right', () => {
        expect(buildSectionSubpath({ position: { pageIndex: 0, rects: [] } })).toMatch(
            /^#page=1#/
        );
    });

    // The two kinds of bookmark share one channel but must never be confused:
    // an annotation is identified by its id, and a section has none.
    it('is not mistaken for an annotation bookmark', () => {
        expect(parseAnnotationSubpath(buildSectionSubpath(location))).toBeNull();
    });
});

// --- the tool it becomes ------------------------------------------------------

describe('the tool a dropped section becomes', () => {
    const ref = parseReaderOutlinePayload(payload()) as OutlineSectionRef;

    it('is named after the section, numbering and all', () => {
        expect(buildOutlineButtonDraft(ref).name).toBe('1.3 Verhalten an der Hochschule');
    });

    it('is an ordinary file action, so any build can still open it', () => {
        const action = buildOutlineButtonDraft(ref).action;
        expect(action.type).toBe('file');
        expect(action.parameters).toMatchObject({ filePath: ref.filePath });
    });

    it('carries the section description beside the navigation', () => {
        const action = buildOutlineButtonDraft(ref).action;
        expect(action.type === 'file' && action.parameters.section).toEqual(ref.section);
        expect(action.type === 'file' && action.parameters.subpath).toMatch(/^#page=106#/);
    });

    it('says which source and page in the hover text', () => {
        const tooltip = buildOutlineButtonDraft(ref).tooltip ?? '';
        expect(tooltip).toContain('Bieker, Westerholt 2021');
        expect(tooltip).toContain('106');
    });

    it('shows the ancestors but not the section itself, which is on the face', () => {
        const tooltip = buildOutlineButtonDraft(ref).tooltip ?? '';
        expect(tooltip).toContain('A Soziale Arbeit studieren › 1 Studieren');
        expect(tooltip).not.toContain('1.3 Verhalten an der Hochschule');
    });

    it('omits the path for a top-level section', () => {
        const top = parseReaderOutlinePayload(
            payload({ parents: [], level: 0 })
        ) as OutlineSectionRef;
        expect(buildOutlineButtonDraft(top).tooltip).not.toContain('›');
    });

    it('cuts an overlong title instead of letting it run', () => {
        const long = parseReaderOutlinePayload(
            payload({ title: 'Wort '.repeat(40) })
        ) as OutlineSectionRef;
        const name = buildOutlineButtonDraft(long).name;
        expect(name.length).toBeLessThanOrEqual(61);
        expect(name.endsWith('…')).toBe(true);
    });

    it('names an untitled section rather than producing an empty button', () => {
        // The parser refuses a blank title, so this is the defence behind it.
        const blank = { ...ref, section: { ...ref.section, title: '   ' } };
        expect(buildOutlineButtonDraft(blank).name).toBe('Section');
    });
});

// --- the drop channel ---------------------------------------------------------

describe('the drop channel', () => {
    it('lights the slot up for a reader object during dragover', () => {
        // Only the type list is readable before the drop, and a reader object
        // carries nothing else — without naming it here the slot would refuse.
        const dragover = {
            types: [READER_OBJECT_MIME],
            getData: () => {
                throw new Error('protected mode');
            },
        } as unknown as DataTransfer;
        expect(canAcceptVaultFileDrag(emptyApp, dragover)).toBe(true);
    });

    it('still refuses an OS file drag', () => {
        expect(
            canAcceptVaultFileDrag(emptyApp, transfer({ Files: '', 'text/plain': 'x' }))
        ).toBe(false);
    });

    it('reads the section off the drop', () => {
        const section = resolveDroppedOutlineSection(
            transfer({ [READER_OBJECT_MIME]: payload() })
        );
        expect(section?.section.title).toBe('1.3 Verhalten an der Hochschule');
    });

    it('creates a section tool from the drop', () => {
        const draft = resolveSlotDropDraft(
            emptyApp,
            transfer({ [READER_OBJECT_MIME]: payload() })
        );
        expect(draft?.name).toBe('1.3 Verhalten an der Hochschule');
        expect(draft?.noticeKey).toBe('slot_section_created');
        expect(draft?.action.type).toBe('file');
    });

    it('is claimed before the annotation path, so the two cannot collide', () => {
        // A drag carrying both: the reader object is this project's own type and
        // wins, rather than being read as a ZotFlow annotation with no id.
        const draft = resolveSlotDropDraft(
            emptyApp,
            transfer({ [READER_OBJECT_MIME]: payload(), 'text/plain': ' ' })
        );
        expect(draft?.noticeKey).toBe('slot_section_created');
    });

    it('leaves a drag it does not recognise exactly as it was', () => {
        expect(
            resolveSlotDropDraft(emptyApp, transfer({ [READER_OBJECT_MIME]: 'garbage' }))
        ).toBeNull();
    });

    it('does not claim a plain text drag', () => {
        expect(resolveDroppedOutlineSection(transfer({ 'text/plain': 'Chapter 1' }))).toBeNull();
    });

    it('survives a DataTransfer that refuses to be read', () => {
        const locked = {
            types: [READER_OBJECT_MIME],
            getData: () => {
                throw new Error('protected mode');
            },
        } as unknown as DataTransfer;
        expect(resolveDroppedOutlineSection(locked)).toBeNull();
    });

    it('survives no DataTransfer at all', () => {
        expect(resolveDroppedOutlineSection(null)).toBeNull();
    });
});
