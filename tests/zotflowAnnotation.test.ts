// Capturing a ZotFlow annotation as a tool.
//
// ZotFlow gives a foreign drop target almost nothing: for a LOCAL file's
// annotation the payload is either an embed of its source note
// ("![[note#^KWBFL8CQ]]") or a single space, and only Zotero LIBRARY attachments
// get a real `application/zotflow-citation` JSON. So the interesting questions
// are all about classification and identity:
//
// - does the embed parser recognise ZotFlow's own shape without claiming
//   ordinary Obsidian block embeds?
// - is the reopen link exactly the one ZotFlow itself writes (page BEFORE
//   annotation, url-encoded JSON, 1-based page, `pageIndex` repeated inside for
//   the fallback)?
// - is the untrusted library JSON validated rather than trusted?
// - and does everything a file drag means today still mean that?
//
// The pure layers are tested directly here; resolving an embed against the vault
// and reading the live reader are exercised through a fake App below.

import { describe, expect, it } from 'vitest';
import {
    buildAnnotationSubpath,
    buildLibraryAnnotationUrl,
    isAnnotationKey,
    parseZotflowCitationPayload,
    parseZotflowEmbedLink,
    ZOTFLOW_CITATION_MIME,
    type LibraryAnnotationRef,
    type LocalAnnotationRef,
} from '@/utils/zotflowAnnotationDrop';
import { buildAnnotationButtonDraft } from '@/utils/annotationButton';
import {
    basenameOf,
    readAnnotationMeta,
    readDraggedLocalAnnotation,
    resolveAnnotatedFile,
} from '@/utils/zotflowReader';
import {
    canAcceptVaultFileDrag,
    parseDraggedLinkText,
    resolveDroppedAnnotation,
    resolveDroppedVaultFiles,
    resolveSlotDropDraft,
} from '@/utils/obsidianFileDrag';
import {
    copyToolInCategory,
    duplicateVariantInState,
    removeToolFromCategory,
} from '@/domain/categoryOps';
import { p, registryOf, stateOf, storedDynamic, storedGrid, storedVariant, tool } from './helpers/stored';

// --- fixtures ----------------------------------------------------------------

const PDF = 'A2_Bib/Salomon (2004) - Die Grundlagen/Salomon-Grundlagen.pdf';
const NOTE = 'A2_Bib/Salomon (2004) - Die Grundlagen/Annotation/@Salomon-Grundlagen.md';
const KEY = '5AV2LDD3';

/** ZotFlow's real payload for an annotation of a file that has a source note. */
const embedPayload = (note = NOTE, key = KEY) => `![[${note}#^${key}]]`;

/** The navigation object ZotFlow parses back out of a subpath. */
function decodeNavigation(subpath: string): unknown {
    const match = /annotation=([^&]+)/.exec(subpath);
    if (!match?.[1]) throw new Error(`no annotation in ${subpath}`);
    return JSON.parse(decodeURIComponent(match[1]));
}

// --- fake DataTransfer / App -------------------------------------------------

function transfer(data: Record<string, string>): DataTransfer {
    return {
        types: Object.keys(data),
        getData: (mime: string) => data[mime] ?? '',
    } as unknown as DataTransfer;
}

/** A DataTransfer that refuses reads, as the browser does outside a drop. */
function lockedTransfer(types: string[]): DataTransfer {
    return {
        types,
        getData: () => {
            throw new Error('protected mode');
        },
    } as unknown as DataTransfer;
}

interface FakeAnnotation {
    id: string;
    type?: string;
    text?: string;
    comment?: string;
    pageLabel?: string;
    position?: { pageIndex?: number };
}

interface ReaderLeafSpec {
    /** Vault path the reader shows; null means it exposes none. */
    file: string | null;
    annotations?: FakeAnnotation[];
    /** What the reader window claims is being dragged. */
    dragging?: unknown;
    /** Simulate a missing/unreachable iframe. */
    noIframe?: boolean;
    /** Simulate a view without ZotFlow's data manager. */
    noDataManager?: boolean;
    /** Expose the path only through getState(), not through `file`. */
    stateOnly?: boolean;
    /** Simulate a cross-origin frame: reading a property throws. */
    hostileWindow?: boolean;
    /** Simulate a data manager whose getAnnotation throws. */
    throwingDataManager?: boolean;
    /** Mark this leaf as the most recently used one. */
    mostRecent?: boolean;
    /** Pretend the surrounding document's focus sits inside this leaf. */
    focused?: boolean;
}

function fakeApp(options: {
    files?: Record<string, { path: string; basename: string; extension: string }>;
    /** note path -> frontmatter object */
    frontmatter?: Record<string, Record<string, unknown>>;
    readers?: ReaderLeafSpec[];
    dragManagerFiles?: { path: string; basename: string; extension: string }[];
} = {}) {
    const files = options.files ?? {};
    const frontmatter = options.frontmatter ?? {};

    const leaves = (options.readers ?? []).map((spec) => {
        const annotations = spec.annotations ?? [];
        /** A cross-origin WindowProxy: an object that throws on property access. */
        const hostile = new Proxy(
            {},
            {
                get() {
                    throw new Error('SecurityError: blocked a frame from accessing');
                },
            }
        );
        // The iframe element focus lands on when a drag starts inside the reader.
        const iframeEl = {
            contentWindow: spec.hostileWindow ? hostile : { _draggingAnnotationIDs: spec.dragging },
        };
        const view: Record<string, unknown> = {
            getState: () => (spec.file !== null ? { file: spec.file } : {}),
            containerEl: {
                querySelector: (selector: string) => {
                    if (selector !== 'iframe' || spec.noIframe) return null;
                    return iframeEl;
                },
                ownerDocument: { activeElement: spec.focused ? iframeEl : null },
                contains: (node: unknown) => node === iframeEl,
            },
        };
        if (spec.file !== null && !spec.stateOnly) {
            view['file'] = { path: spec.file };
        }
        if (!spec.noDataManager) {
            view['dataManager'] = {
                getAnnotation: (id: string) => {
                    if (spec.throwingDataManager) throw new Error('reader is busy');
                    return annotations.find((a) => a.id === id) ?? null;
                },
            };
        }
        return { view, __mostRecent: spec.mostRecent === true };
    });

    return {
        vault: {
            getAbstractFileByPath: (path: string) => files[path] ?? null,
        },
        metadataCache: {
            getFirstLinkpathDest: (linkpath: string) => {
                if (files[linkpath]) return files[linkpath];
                const withMd = `${linkpath}.md`;
                return files[withMd] ?? null;
            },
            getFileCache: (file: { path: string }) => {
                const fm = frontmatter[file.path];
                return fm ? { frontmatter: fm } : {};
            },
        },
        workspace: {
            getLeavesOfType: (type: string) =>
                type === 'zotflow-local-zotero-reader-view' ? leaves : [],
            getMostRecentLeaf: () => leaves.find((l) => l.__mostRecent) ?? null,
        },
        ...(options.dragManagerFiles
            ? { dragManager: { draggable: { files: options.dragManagerFiles } } }
            : {}),
    } as never;
}

const vaultFile = (path: string) => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    return {
        path,
        basename: dot > 0 ? name.slice(0, dot) : name,
        extension: dot > 0 ? name.slice(dot + 1) : '',
    };
};

/** A vault where NOTE is a real ZotFlow source note pointing at PDF. */
function annotatedVault(readers: ReaderLeafSpec[] = []) {
    return fakeApp({
        files: { [PDF]: vaultFile(PDF), [NOTE]: vaultFile(NOTE) },
        frontmatter: { [NOTE]: { 'zotflow-local-attachment': `"[[${PDF}]]"`.slice(1, -1) } },
        readers,
    });
}

// --- 1. the embed parser -----------------------------------------------------

describe('reading ZotFlow’s source-note embed', () => {
    it('recognises its own shape, including spaces and folders in the path', () => {
        expect(parseZotflowEmbedLink(embedPayload())).toEqual({
            notePath: NOTE,
            annotationId: KEY,
        });
        expect(parseZotflowEmbedLink('![[Annotation/@x.md#^KWBFL8CQ]]')).toEqual({
            notePath: 'Annotation/@x.md',
            annotationId: 'KWBFL8CQ',
        });
        expect(parseZotflowEmbedLink('![[a (2021) b/@c d.md#^NJJQHI2C]]')?.annotationId).toBe(
            'NJJQHI2C'
        );
    });

    it('takes the first of several annotations, as one cell is one tool', () => {
        const payload = `${embedPayload(NOTE, KEY)}\n\n${embedPayload(NOTE, 'KWBFL8CQ')}`;
        expect(parseZotflowEmbedLink(payload)?.annotationId).toBe(KEY);
    });

    it('claims nothing that is not an annotation embed', () => {
        for (const text of [
            '',
            ' ',
            '   \n  ',
            'just some prose',
            '[[Note]]',
            '![[Note]]',
            '![[Note.pdf]]',
            '![[Note#Heading]]',
            // An ordinary Obsidian block id: lower case, and not 8 chars of the
            // Zotero alphabet.
            '![[Note#^abc123]]',
            '![[Note#^5av2ldd3]]',
            // Zotero keys never contain 0, 1 or O.
            '![[Note#^5AV2LDD0]]',
            '![[Note#^5AV2LDDO]]',
            '![[Note#^5AV2LDD]]',
            '![[Note#^5AV2LDD33]]',
            'obsidian://open?vault=v&file=Note.pdf',
            '[label](Note.pdf)',
            `[x](obsidian://zotflow?type=open-attachment&libraryID=1&key=${KEY})`,
        ]) {
            expect(parseZotflowEmbedLink(text), text).toBeNull();
        }
    });

    it('agrees with the key shape helper', () => {
        expect(isAnnotationKey(KEY)).toBe(true);
        expect(isAnnotationKey('5AV2LDD0')).toBe(false);
        expect(isAnnotationKey('5av2ldd3')).toBe(false);
        expect(isAnnotationKey('')).toBe(false);
    });
});

// --- 2. the reopen link ------------------------------------------------------

describe('building the subpath that reopens an annotation', () => {
    it('writes page before annotation, 1-based, with the index repeated inside', () => {
        const subpath = buildAnnotationSubpath(KEY, 43);

        expect(subpath).toBe(
            `#page=44#annotation=${encodeURIComponent(
                JSON.stringify({ annotationID: KEY, pageIndex: 43 })
            )}`
        );
        // The order is load-bearing: ZotFlow greedily takes everything after
        // `annotation=` and JSON-parses it, so a trailing `#page=` would break.
        expect(subpath.indexOf('#page=')).toBeLessThan(subpath.indexOf('#annotation='));
        expect(decodeNavigation(subpath)).toEqual({ annotationID: KEY, pageIndex: 43 });
    });

    it('survives ZotFlow’s own extraction regex', () => {
        // Exactly what LocalReaderView.parseNavigationInfo does.
        const subpath = buildAnnotationSubpath(KEY, 0);
        expect(decodeNavigation(subpath)).toEqual({ annotationID: KEY, pageIndex: 0 });
        expect(subpath.startsWith('#page=1#')).toBe(true);
    });

    it('omits the page entirely when it is unknown', () => {
        const subpath = buildAnnotationSubpath(KEY);
        expect(subpath.includes('#page=')).toBe(false);
        expect(decodeNavigation(subpath)).toEqual({ annotationID: KEY });
    });

    it('ignores a nonsensical page instead of writing it', () => {
        for (const bad of [-1, 1.5, Number.NaN]) {
            const subpath = buildAnnotationSubpath(KEY, bad);
            expect(subpath.includes('#page='), String(bad)).toBe(false);
            expect(decodeNavigation(subpath)).toEqual({ annotationID: KEY });
        }
    });

    it('builds ZotFlow’s protocol URI for a library annotation', () => {
        const url = buildLibraryAnnotationUrl({
            kind: 'library',
            libraryID: 19314631,
            annotationId: KEY,
        });
        expect(url).toBe(
            `obsidian://zotflow?type=open-annotation&libraryID=19314631&key=${KEY}`
        );
    });
});

// --- 3. the untrusted library payload ----------------------------------------

describe('validating the library citation payload', () => {
    const payload = (overrides: Record<string, unknown> = {}) =>
        JSON.stringify({
            type: 'zotflow-citation',
            libraryID: 1,
            key: 'PARENTKY',
            annotations: [
                {
                    id: KEY,
                    type: 'highlight',
                    text: 'a quote',
                    comment: 'a note',
                    color: '#ffd400',
                    pageLabel: '111',
                    position: { pageIndex: 110, rects: [] },
                },
            ],
            ...overrides,
        });

    it('accepts a real payload and keeps only known fields', () => {
        const ref = parseZotflowCitationPayload(payload());

        expect(ref).toEqual({
            kind: 'library',
            libraryID: 1,
            annotationId: KEY,
            pageIndex: 110,
            pageLabel: '111',
            text: 'a quote',
            comment: 'a note',
            annotationType: 'highlight',
        });
        // Nothing from the document leaks through: `color` and `rects` are not
        // adopted just because they were present.
        expect(Object.keys(ref!).sort()).not.toContain('color');
    });

    it('takes the first annotation of a multi-selection drag', () => {
        const ref = parseZotflowCitationPayload(
            payload({ annotations: [{ id: KEY }, { id: 'KWBFL8CQ' }] })
        );
        expect(ref?.annotationId).toBe(KEY);
    });

    it('is not an annotation when the drag is a tree-view item', () => {
        // Same MIME type, no annotations — that is a citation drag, not this.
        expect(
            parseZotflowCitationPayload(
                JSON.stringify({ type: 'zotflow-citation', libraryID: 1, key: 'ITEMKEY1' })
            )
        ).toBeNull();
        expect(parseZotflowCitationPayload(payload({ annotations: [] }))).toBeNull();
    });

    it('refuses anything that is not the expected shape', () => {
        for (const raw of [
            '',
            '{ not json',
            'null',
            '[]',
            '"a string"',
            JSON.stringify({ type: 'something-else', libraryID: 1, annotations: [{ id: KEY }] }),
            JSON.stringify({ type: 'zotflow-citation', annotations: [{ id: KEY }] }),
            JSON.stringify({ type: 'zotflow-citation', libraryID: '1', annotations: [{ id: KEY }] }),
            JSON.stringify({ type: 'zotflow-citation', libraryID: 1, annotations: [{ id: 'nope' }] }),
            JSON.stringify({ type: 'zotflow-citation', libraryID: 1, annotations: ['x'] }),
            JSON.stringify({ type: 'zotflow-citation', libraryID: 1, annotations: [null] }),
        ]) {
            expect(parseZotflowCitationPayload(raw), raw.slice(0, 40)).toBeNull();
        }
    });

    it('does not let a payload poison a prototype', () => {
        // Written as raw JSON on purpose: `{__proto__: …}` in an object literal
        // sets the prototype, so JSON.stringify would drop it and the test would
        // prove nothing. This string really does carry a `__proto__` KEY.
        const raw =
            `{"type":"zotflow-citation","libraryID":1,"annotations":` +
            `[{"id":"${KEY}","__proto__":{"polluted":true},"constructor":{"x":1}}]}`;
        expect(raw).toContain('"__proto__"');

        const ref = parseZotflowCitationPayload(raw);

        expect(ref?.annotationId).toBe(KEY);
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
        expect(Object.getPrototypeOf(ref!)).toBe(Object.prototype);
        // Only fields the parser knows are present.
        expect(Object.keys(ref!).sort()).toEqual(['annotationId', 'kind', 'libraryID']);
    });

    it('accepts libraryID 0 but not a non-finite one', () => {
        const payload = (libraryID: unknown) =>
            `{"type":"zotflow-citation","libraryID":${JSON.stringify(libraryID)},"annotations":[{"id":"${KEY}"}]}`;
        expect(parseZotflowCitationPayload(payload(0))?.libraryID).toBe(0);
        expect(parseZotflowCitationPayload(payload(null))).toBeNull();
    });
});

// --- 4. the tool it becomes --------------------------------------------------

describe('the tool a captured annotation becomes', () => {
    const local = (overrides: Partial<LocalAnnotationRef> = {}): LocalAnnotationRef => ({
        kind: 'local',
        filePath: PDF,
        fileBasename: 'Salomon-Grundlagen',
        annotationId: KEY,
        ...overrides,
    });

    it('is an ordinary file tool pointing at the PDF and the annotation', () => {
        const draft = buildAnnotationButtonDraft(
            local({ pageIndex: 110, pageLabel: '111', text: 'Tripelmandat', annotationType: 'highlight' })
        );

        expect(draft.action).toEqual({
            type: 'file',
            parameters: {
                filePath: PDF,
                subpath: buildAnnotationSubpath(KEY, 110),
            },
        });
        expect(draft.iconId).toBe('highlighter');
        // The label is what the highlight SAYS…
        expect(draft.name).toBe('Tripelmandat');
        // …and the source and page are the hover text, where there is room.
        expect(draft.tooltip).toBe('Salomon 2004 · S. 111');
    });

    it('never shows the physical page as if it were the printed one', () => {
        // pageLabel is regularly not pageIndex + 1, so a missing label means the
        // page is simply left out instead of being invented.
        const draft = buildAnnotationButtonDraft(local({ pageIndex: 42, text: 'x' }));
        expect(draft.name).toBe('x');
        expect(draft.tooltip).toBe('Salomon 2004');
        expect(draft.tooltip).not.toContain('43');
    });

    it('uses the comment when there is no highlighted text', () => {
        const draft = buildAnnotationButtonDraft(local({ pageLabel: '9', comment: 'my thought' }));
        expect(draft.name).toBe('my thought');
        expect(draft.tooltip).toBe('Salomon 2004 · S. 9');
    });

    it('names itself after the file when there is nothing to quote', () => {
        // An image or ink region: no text, no comment.
        expect(buildAnnotationButtonDraft(local()).name).toBe('Salomon-Grundlagen');
        // No page on the FACE, even when one is known: a name is the user's and is
        // never rewritten, while the page can be corrected in the reader later —
        // a page here would end up contradicting the hover text, which follows it.
        const withPage = buildAnnotationButtonDraft(local({ pageLabel: '7' }));
        expect(withPage.name).toBe('Salomon-Grundlagen');
        expect(withPage.tooltip).toBe('Salomon 2004 · S. 7');
    });

    it('condenses a long quote to one short line', () => {
        const long =
            'Eine der wichtigsten Lernaufgaben im Studium der Sozialen Arbeit besteht darin, ' +
            'wissenschaftliche Erkenntnisse auf die Praxis zu beziehen';
        const name = buildAnnotationButtonDraft(local({ pageLabel: '43', text: long })).name;

        expect(name.startsWith('Eine der wichtigsten')).toBe(true);
        expect(name.endsWith('…')).toBe(true);
        expect(name.length).toBeLessThanOrEqual(62);
        expect(name.includes('\n')).toBe(false);
    });

    it('collapses newlines inside the quote', () => {
        expect(
            buildAnnotationButtonDraft(local({ pageLabel: '1', text: 'a\n\nb   c' })).name
        ).toBe('a b c');
    });

    it('picks an icon per annotation kind', () => {
        const icon = (annotationType?: string) =>
            buildAnnotationButtonDraft(local({ annotationType })).iconId;

        expect(icon('highlight')).toBe('highlighter');
        expect(icon('underline')).toBe('underline');
        expect(icon('note')).toBe('sticky-note');
        expect(icon('image')).toBe('image');
        expect(icon('ink')).toBe('pen-tool');
        expect(icon('something-new')).toBe('highlighter');
        expect(icon(undefined)).toBe('highlighter');
    });

    it('omits the page from the link when the reader could not be asked', () => {
        const draft = buildAnnotationButtonDraft(local());
        expect(draft.action).toEqual({
            type: 'file',
            parameters: { filePath: PDF, subpath: buildAnnotationSubpath(KEY) },
        });
    });

    it('is a url tool for a library annotation, with no new action type', () => {
        const ref: LibraryAnnotationRef = {
            kind: 'library',
            libraryID: 7,
            annotationId: KEY,
            pageLabel: '5',
            text: 'quote',
        };
        expect(buildAnnotationButtonDraft(ref)).toEqual({
            name: 'quote',
            iconId: 'highlighter',
            action: {
                type: 'url',
                parameters: {
                    url: `obsidian://zotflow?type=open-annotation&libraryID=7&key=${KEY}`,
                },
            },
            // No vault file, so no folder names a source — the page alone.
            tooltip: 'S. 5',
        });
    });
});

// --- 5. resolving the embed against the vault --------------------------------

describe('resolving a source note to the file it annotates', () => {
    it('follows the frontmatter wikilink', () => {
        expect(resolveAnnotatedFile(annotatedVault(), NOTE)?.path).toBe(PDF);
    });

    it('accepts the value with or without an alias, and as a list', () => {
        const variants: unknown[] = [
            `[[${PDF}]]`,
            `[[${PDF}|Salomon]]`,
            `![[${PDF}]]`,
            PDF,
            [`[[${PDF}]]`],
            [[`[[${PDF}]]`]],
        ];
        for (const value of variants) {
            const app = fakeApp({
                files: { [PDF]: vaultFile(PDF), [NOTE]: vaultFile(NOTE) },
                frontmatter: { [NOTE]: { 'zotflow-local-attachment': value } },
            });
            expect(resolveAnnotatedFile(app, NOTE)?.path, JSON.stringify(value)).toBe(PDF);
        }
    });

    it('refuses a note that is not a ZotFlow source note', () => {
        const app = fakeApp({
            files: { [PDF]: vaultFile(PDF), [NOTE]: vaultFile(NOTE) },
            frontmatter: { [NOTE]: { tags: ['reading'] } },
        });
        expect(resolveAnnotatedFile(app, NOTE)).toBeNull();
    });

    it('refuses a missing note, a missing target and a junk value', () => {
        expect(resolveAnnotatedFile(annotatedVault(), 'nope.md')).toBeNull();
        for (const value of [null, 42, {}, '', '[[]]', []]) {
            const app = fakeApp({
                files: { [NOTE]: vaultFile(NOTE) },
                frontmatter: { [NOTE]: { 'zotflow-local-attachment': value } },
            });
            expect(resolveAnnotatedFile(app, NOTE), JSON.stringify(value)).toBeNull();
        }
    });

    it('computes a basename the way the label needs it', () => {
        expect(basenameOf(PDF)).toBe('Salomon-Grundlagen');
        expect(basenameOf('x.pdf')).toBe('x');
        expect(basenameOf('a/b/c')).toBe('c');
        expect(basenameOf('.hidden')).toBe('.hidden');
    });
});

// --- 6. reading the live reader ----------------------------------------------

describe('reading metadata and the dragged id from the open reader', () => {
    const annotation: FakeAnnotation = {
        id: KEY,
        type: 'underline',
        text: ' spaced quote ',
        pageLabel: '111',
        position: { pageIndex: 110 },
    };

    it('enriches an annotation from the reader that holds its file', () => {
        const app = annotatedVault([{ file: PDF, annotations: [annotation] }]);
        expect(readAnnotationMeta(app, PDF, KEY)).toEqual({
            pageIndex: 110,
            pageLabel: '111',
            text: 'spaced quote',
            annotationType: 'underline',
        });
    });

    it('ignores readers showing a different file', () => {
        const app = annotatedVault([{ file: 'other.pdf', annotations: [annotation] }]);
        expect(readAnnotationMeta(app, PDF, KEY)).toBeNull();
    });

    it('returns null rather than guessing when nothing is reachable', () => {
        expect(readAnnotationMeta(fakeApp(), PDF, KEY)).toBeNull();
        expect(
            readAnnotationMeta(annotatedVault([{ file: PDF, noDataManager: true }]), PDF, KEY)
        ).toBeNull();
        expect(readAnnotationMeta(annotatedVault([{ file: PDF }]), PDF, KEY)).toBeNull();
    });

    it('reads the dragged annotation when the reader owns it', () => {
        const app = annotatedVault([
            { file: PDF, annotations: [annotation], dragging: [KEY] },
        ]);
        expect(readDraggedLocalAnnotation(app)).toEqual({
            kind: 'local',
            filePath: PDF,
            fileBasename: 'Salomon-Grundlagen',
            annotationId: KEY,
            pageIndex: 110,
            pageLabel: '111',
            text: 'spaced quote',
            annotationType: 'underline',
        });
    });

    it('refuses a STALE id the reader no longer owns', () => {
        // ZotFlow never clears this value, so the id alone proves nothing: the
        // leaf must still resolve the annotation.
        const app = annotatedVault([
            { file: PDF, annotations: [annotation], dragging: ['KWBFL8CQ'] },
        ]);
        expect(readDraggedLocalAnnotation(app)).toBeNull();
    });

    it('refuses an id that disagrees with the payload', () => {
        const app = annotatedVault([
            {
                file: PDF,
                annotations: [annotation, { id: 'KWBFL8CQ' }],
                dragging: ['KWBFL8CQ'],
            },
        ]);
        // A leftover id can never substitute a different annotation.
        expect(readDraggedLocalAnnotation(app, KEY)).toBeNull();
        expect(readDraggedLocalAnnotation(app, 'KWBFL8CQ')?.annotationId).toBe('KWBFL8CQ');
    });

    it('never throws on a reader that is shaped differently', () => {
        for (const spec of [
            { file: PDF, dragging: undefined },
            { file: PDF, dragging: 'not-an-array' as unknown },
            { file: PDF, dragging: [42, null, 'bad'] as unknown },
            { file: PDF, dragging: [KEY], noIframe: true },
            { file: PDF, dragging: [KEY], noDataManager: true },
            { file: null, dragging: [KEY] },
            // A cross-origin frame: `contentWindow` is handed over happily and
            // only throws when a property is touched.
            { file: PDF, annotations: [annotation], hostileWindow: true },
            { file: PDF, annotations: [annotation], dragging: [KEY], throwingDataManager: true },
        ]) {
            expect(() =>
                readDraggedLocalAnnotation(annotatedVault([spec as ReaderLeafSpec]))
            ).not.toThrow();
            expect(readDraggedLocalAnnotation(annotatedVault([spec as ReaderLeafSpec]))).toBeNull();
        }
        expect(readDraggedLocalAnnotation(fakeApp())).toBeNull();
        // The metadata read must be just as unshakeable.
        expect(() =>
            readAnnotationMeta(
                annotatedVault([{ file: PDF, annotations: [annotation], throwingDataManager: true }]),
                PDF,
                KEY
            )
        ).not.toThrow();
    });

    it('refuses to guess when two readers both claim a drag', () => {
        // ZotFlow never clears the ids, so every reader the user ever dragged
        // from still looks busy. Taking the first in tree order would capture an
        // annotation from a document the user is not even looking at.
        const other = 'other/Second.pdf';
        const app = fakeApp({
            files: { [PDF]: vaultFile(PDF), [NOTE]: vaultFile(NOTE) },
            frontmatter: { [NOTE]: { 'zotflow-local-attachment': `[[${PDF}]]` } },
            readers: [
                { file: other, annotations: [{ id: 'KWBFL8CQ' }], dragging: ['KWBFL8CQ'] },
                { file: PDF, annotations: [annotation], dragging: [KEY] },
            ],
        });

        expect(readDraggedLocalAnnotation(app)).toBeNull();
    });

    it('uses the reader that holds focus to break the tie', () => {
        // A drag starts with a mousedown inside the reader's iframe, which focuses
        // that iframe in the surrounding document — evidence about THIS drag,
        // unlike the session-level most-recent history, which here points at the
        // wrong reader on purpose.
        const other = 'other/Second.pdf';
        const app = fakeApp({
            files: { [PDF]: vaultFile(PDF) },
            readers: [
                {
                    file: other,
                    annotations: [{ id: 'KWBFL8CQ' }],
                    dragging: ['KWBFL8CQ'],
                    mostRecent: true,
                },
                { file: PDF, annotations: [annotation], dragging: [KEY], focused: true },
            ],
        });

        const ref = readDraggedLocalAnnotation(app);
        expect(ref?.filePath).toBe(PDF);
        expect(ref?.annotationId).toBe(KEY);
    });

    it('refuses when focus points at neither and history points at neither', () => {
        const other = 'other/Second.pdf';
        const app = fakeApp({
            files: { [PDF]: vaultFile(PDF) },
            readers: [
                { file: other, annotations: [{ id: 'KWBFL8CQ' }], dragging: ['KWBFL8CQ'] },
                { file: PDF, annotations: [annotation], dragging: [KEY] },
            ],
        });
        expect(readDraggedLocalAnnotation(app)).toBeNull();
    });

    it('uses the most recently used reader when focus says nothing', () => {
        const other = 'other/Second.pdf';
        const app = fakeApp({
            files: { [PDF]: vaultFile(PDF) },
            readers: [
                { file: other, annotations: [{ id: 'KWBFL8CQ' }], dragging: ['KWBFL8CQ'] },
                { file: PDF, annotations: [annotation], dragging: [KEY], mostRecent: true },
            ],
        });

        const ref = readDraggedLocalAnnotation(app);
        expect(ref?.filePath).toBe(PDF);
        expect(ref?.annotationId).toBe(KEY);
    });

    it('still refuses when one reader offers two dragged ids', () => {
        const app = annotatedVault([
            {
                file: PDF,
                annotations: [annotation, { id: 'KWBFL8CQ' }],
                dragging: [KEY, 'KWBFL8CQ'],
            },
        ]);
        // Ambiguous within a single leaf too: no most-recent hint can resolve it.
        expect(readDraggedLocalAnnotation(app)).toBeNull();
        // Naming one of them is enough to make it unambiguous again.
        expect(readDraggedLocalAnnotation(app, KEY)?.annotationId).toBe(KEY);
    });

    it('accepts a reader that exposes its file only through getState', () => {
        const app = annotatedVault([
            { file: PDF, annotations: [annotation], dragging: [KEY], stateOnly: true },
        ]);
        expect(readDraggedLocalAnnotation(app)?.filePath).toBe(PDF);
    });
});

// --- 7. the drop pipeline ----------------------------------------------------

describe('classifying a drop', () => {
    const annotation: FakeAnnotation = {
        id: KEY,
        type: 'highlight',
        text: 'quote',
        pageLabel: '111',
        position: { pageIndex: 110 },
    };

    it('turns a source-note embed into a local annotation', () => {
        const app = annotatedVault([{ file: PDF, annotations: [annotation] }]);
        const ref = resolveDroppedAnnotation(app, transfer({ 'text/plain': embedPayload() }));

        expect(ref).toEqual({
            kind: 'local',
            filePath: PDF,
            fileBasename: 'Salomon-Grundlagen',
            annotationId: KEY,
            pageIndex: 110,
            pageLabel: '111',
            text: 'quote',
            annotationType: 'highlight',
        });
    });

    it('still captures the annotation when no reader can be asked', () => {
        const ref = resolveDroppedAnnotation(
            annotatedVault(),
            transfer({ 'text/plain': embedPayload() })
        );
        // Identity is enough; only the page fallback and the label detail are lost.
        expect(ref).toEqual({
            kind: 'local',
            filePath: PDF,
            fileBasename: 'Salomon-Grundlagen',
            annotationId: KEY,
        });
        const draft = buildAnnotationButtonDraft(ref!);
        expect(draft.name).toBe('Salomon-Grundlagen');
        // The source still comes from the path, which needs no reader at all.
        expect(draft.tooltip).toBe('Salomon 2004');
    });

    it('reads the reader when ZotFlow sends only a space', () => {
        const app = annotatedVault([
            { file: PDF, annotations: [annotation], dragging: [KEY] },
        ]);
        expect(resolveDroppedAnnotation(app, transfer({ 'text/plain': ' ' }))?.annotationId).toBe(
            KEY
        );
    });

    it('claims only ZotFlow’s exact signature, never other blank payloads', () => {
        // The reader's dragging ids are never cleared, so a leftover value is
        // indistinguishable from a fresh one. Everything that is not exactly
        // what ZotFlow writes must therefore be left alone, even though a reader
        // is open and would happily resolve the stale id.
        const app = annotatedVault([
            { file: PDF, annotations: [annotation], dragging: [KEY] },
        ]);

        expect(resolveDroppedAnnotation(app, transfer({ 'text/plain': ' ' }))?.annotationId).toBe(
            KEY
        );
        for (const text of ['', '  ', '   ', '\t', '\n', ' \n ']) {
            expect(resolveDroppedAnnotation(app, transfer({ 'text/plain': text })), JSON.stringify(text)).toBeNull();
        }
        // A lone space is only ZotFlow's if nothing else rides along.
        expect(
            resolveDroppedAnnotation(app, transfer({ 'text/plain': ' ', 'text/html': '<i> </i>' }))
        ).toBeNull();
        expect(resolveDroppedAnnotation(app, transfer({ 'text/plain': ' ', Files: '' }))).toBeNull();
        expect(resolveDroppedAnnotation(app, transfer({}))).toBeNull();
        expect(resolveDroppedAnnotation(app, null)).toBeNull();
    });

    it('turns a library citation payload into a library annotation', () => {
        const ref = resolveDroppedAnnotation(
            fakeApp(),
            transfer({
                [ZOTFLOW_CITATION_MIME]: JSON.stringify({
                    type: 'zotflow-citation',
                    libraryID: 3,
                    key: 'PARENTKY',
                    annotations: [{ id: KEY, position: { pageIndex: 2 } }],
                }),
                'text/plain': embedPayload(),
            })
        );
        expect(ref).toEqual({ kind: 'library', libraryID: 3, annotationId: KEY, pageIndex: 2 });
    });

    it('never claims a drag Obsidian is tracking as vault files', () => {
        // A file-explorer drag carries text/plain too; it keeps its meaning.
        const app = fakeApp({
            files: { [PDF]: vaultFile(PDF), [NOTE]: vaultFile(NOTE) },
            frontmatter: { [NOTE]: { 'zotflow-local-attachment': `[[${PDF}]]` } },
            readers: [{ file: PDF, annotations: [annotation], dragging: [KEY] }],
            dragManagerFiles: [vaultFile(PDF)],
        });

        expect(resolveDroppedAnnotation(app, transfer({ 'text/plain': embedPayload() }))).toBeNull();
        expect(resolveDroppedAnnotation(app, transfer({ 'text/plain': ' ' }))).toBeNull();
        // And the file path still resolves it as before (the drag manager wins).
        expect(resolveDroppedVaultFiles(app, transfer({ 'text/plain': 'x' }))[0]?.path).toBe(PDF);
    });

    it('does not claim prose that merely quotes an annotation embed', () => {
        const app = annotatedVault([{ file: PDF, annotations: [annotation] }]);
        // A multi-line editor selection that happens to contain a source-note
        // embed keeps its old meaning (which is: nothing).
        expect(
            resolveDroppedAnnotation(
                app,
                transfer({ 'text/plain': `see ${embedPayload()} for the argument` })
            )
        ).toBeNull();
        expect(
            resolveDroppedAnnotation(
                app,
                transfer({ 'text/plain': `Some heading\n\n${embedPayload()}` })
            )
        ).toBeNull();
        // ZotFlow's own payload starts with the embed, including a multi-annotation one.
        expect(
            resolveDroppedAnnotation(
                app,
                transfer({ 'text/plain': `${embedPayload()}\n\n${embedPayload(NOTE, 'KWBFL8CQ')}` })
            )?.annotationId
        ).toBe(KEY);
    });

    it('leaves an ordinary block embed to the existing file handling', () => {
        const app = fakeApp({
            files: { 'Notes/Note.md': vaultFile('Notes/Note.md') },
            frontmatter: { 'Notes/Note.md': { tags: ['x'] } },
        });
        const payload = transfer({ 'text/plain': '![[Notes/Note.md#^5AV2LDD3]]' });

        expect(resolveDroppedAnnotation(app, payload)).toBeNull();
        // parseDraggedLinkText still sees a link, exactly as before this feature.
        expect(parseDraggedLinkText('![[Notes/Note.md#^5AV2LDD3]]')).toBe(
            'Notes/Note.md#^5AV2LDD3'
        );
    });

    it('survives a DataTransfer that refuses to be read', () => {
        expect(
            resolveDroppedAnnotation(annotatedVault(), lockedTransfer(['text/plain']))
        ).toBeNull();
    });
});

// --- 7b. the draft a drop produces, including which notice is shown -----------
//
// This is the decision the drop hook makes, lifted out of React so it can be
// checked directly: which tool, which icon, which message.

describe('the draft a drop produces', () => {
    const annotation: FakeAnnotation = {
        id: KEY,
        type: 'highlight',
        text: 'quote',
        pageLabel: '111',
        position: { pageIndex: 110 },
    };

    it('announces an annotation as an annotation', () => {
        const app = annotatedVault([{ file: PDF, annotations: [annotation] }]);
        const draft = resolveSlotDropDraft(app, transfer({ 'text/plain': embedPayload() }));

        expect(draft).toEqual({
            name: 'quote',
            iconId: 'highlighter',
            action: {
                type: 'file',
                parameters: { filePath: PDF, subpath: buildAnnotationSubpath(KEY, 110) },
            },
            tooltip: 'Salomon 2004 · S. 111',
            noticeKey: 'slot_annotation_created',
        });
    });

    it('announces a plain file as a created button', () => {
        const app = fakeApp({ files: { 'notes/a.md': vaultFile('notes/a.md') } });
        const draft = resolveSlotDropDraft(app, transfer({ 'text/plain': 'notes/a.md' }));

        expect(draft).toEqual({
            name: 'a',
            iconId: 'file-text',
            action: { type: 'file', parameters: { filePath: 'notes/a.md' } },
            noticeKey: 'button_create_success',
        });
    });

    it('maps a script inside the script folder to the script action', () => {
        const app = fakeApp({ files: { 'scripts/test.js': vaultFile('scripts/test.js') } });
        const draft = resolveSlotDropDraft(app, transfer({ 'text/plain': 'scripts/test.js' }), {
            scriptFolderPath: 'scripts',
        });

        expect(draft?.action).toEqual({ type: 'script', parameters: { scriptName: 'test.js' } });
        expect(draft?.noticeKey).toBe('button_create_success');
    });

    it('explains a script that Run script cannot address', () => {
        const app = fakeApp({ files: { 'elsewhere/test.js': vaultFile('elsewhere/test.js') } });
        const draft = resolveSlotDropDraft(app, transfer({ 'text/plain': 'elsewhere/test.js' }), {
            scriptFolderPath: 'scripts',
        });

        expect(draft?.action).toEqual({
            type: 'file',
            parameters: { filePath: 'elsewhere/test.js' },
        });
        expect(draft?.noticeKey).toBe('script_outside_script_folder');
    });

    it('produces nothing for a drop it cannot make sense of', () => {
        const app = fakeApp();
        expect(resolveSlotDropDraft(app, transfer({ 'text/plain': 'no/such/file.md' }))).toBeNull();
        expect(resolveSlotDropDraft(app, transfer({ 'text/plain': '' }))).toBeNull();
        expect(resolveSlotDropDraft(app, null)).toBeNull();
    });
});

// --- 8. an annotation tool is an ordinary v5 tool -----------------------------
//
// The whole point of reusing the `file` action is that the registry, the
// placements and the lifecycle rules need to know nothing about annotations.
// Pinned here because "no ZotFlow special case in the domain" is the claim.

describe('an annotation tool obeys the v5 registry rules', () => {
    const SUBPATH = buildAnnotationSubpath(KEY, 110);

    const annotationTool = (id: string) =>
        tool(id, {
            name: 'quote',
            tooltip: 'Salomon 2004 · S. 111',
            icon: '<svg />',
            actions: [
                { type: 'file' as const, parameters: { filePath: PDF, subpath: SUBPATH } },
            ],
        });

    const stateWithTool = () =>
        stateOf(registryOf(annotationTool('a')), storedGrid([p('a', 0)], { id: 'cat' }));

    it('is copied as a full, independent definition with the subpath intact', () => {
        const next = copyToolInCategory(stateWithTool(), 'cat', 'a', 'a2')!;

        expect(next.tools['a2']?.actions[0]).toEqual({
            type: 'file',
            parameters: { filePath: PDF, subpath: SUBPATH },
        });
        // Distinct definitions with distinct action objects. The `parameters`
        // object itself is still shared (a pre-existing shallow copy in
        // deepCopyDefinition) — harmless only because no write path mutates a
        // stored action in place; every edit replaces it via toJSON.
        expect(next.tools['a2']).not.toBe(next.tools['a']);
        expect(next.tools['a2']?.actions[0]).not.toBe(next.tools['a']?.actions[0]);
        expect(next.tools['a']?.actions[0]).toEqual({
            type: 'file',
            parameters: { filePath: PDF, subpath: SUBPATH },
        });
        // The presentation snapshot travels with the copy.
        expect(next.tools['a2']?.tooltip).toBe('Salomon 2004 · S. 111');
    });

    it('is duplicated with a variant, under a fresh tool id', () => {
        const state = stateOf(
            registryOf(annotationTool('a')),
            storedDynamic([storedVariant('v1', undefined, [p('a', 0)], true)])
        );
        const next = duplicateVariantInState(
            state,
            'cat',
            'v1',
            { id: 'v2', name: 'V2', trigger: { rule: 'extension', value: 'pdf' } },
            () => 'fresh'
        );

        const variants = next.categories[0]?.variants ?? [];
        expect(variants).toHaveLength(2);
        const copiedId = variants[1]?.placements[0]?.toolId;
        expect(copiedId).not.toBe('a');
        expect(next.tools[copiedId!]?.actions[0]).toEqual({
            type: 'file',
            parameters: { filePath: PDF, subpath: SUBPATH },
        });
    });

    it('is garbage-collected like any other ad-hoc tool', () => {
        const next = removeToolFromCategory(stateWithTool(), 'cat', 'a');

        expect(next.categories[0]?.placements).toEqual([]);
        expect(next.tools['a']).toBeUndefined();
    });
});

// --- 9. regression: what a drag meant before, it still means ------------------

describe('existing drops are unchanged', () => {
    const app = fakeApp({
        files: {
            'other/Becker.pdf': vaultFile('other/Becker.pdf'),
            'notes/a.md': vaultFile('notes/a.md'),
            'scripts/test.js': vaultFile('scripts/test.js'),
        },
    });

    it('a PDF, a note and a script from the file explorer still resolve', () => {
        for (const path of ['other/Becker.pdf', 'notes/a.md', 'scripts/test.js']) {
            const payload = transfer({
                'text/plain': `obsidian://open?vault=v&file=${encodeURIComponent(path)}`,
            });
            expect(resolveDroppedAnnotation(app, payload), path).toBeNull();
            expect(resolveDroppedVaultFiles(app, payload)[0]?.path, path).toBe(path);
        }
    });

    it('a wiki link and a markdown link still resolve', () => {
        for (const text of ['[[notes/a.md]]', '[a](notes/a.md)', 'notes/a.md']) {
            const payload = transfer({ 'text/plain': text });
            expect(resolveDroppedAnnotation(app, payload), text).toBeNull();
            expect(resolveDroppedVaultFiles(app, payload)[0]?.path, text).toBe('notes/a.md');
        }
    });

    it('accepts the same drags as before during dragover, and still no OS files', () => {
        expect(canAcceptVaultFileDrag(app, transfer({ 'text/plain': 'x' }))).toBe(true);
        expect(canAcceptVaultFileDrag(app, transfer({ [ZOTFLOW_CITATION_MIME]: '{}' }))).toBe(true);
        expect(
            canAcceptVaultFileDrag(app, transfer({ 'text/plain': 'x', Files: '' }))
        ).toBe(false);
        expect(canAcceptVaultFileDrag(app, transfer({ 'text/html': '<b/>' }))).toBe(false);
        expect(canAcceptVaultFileDrag(app, null)).toBe(false);
    });
});
