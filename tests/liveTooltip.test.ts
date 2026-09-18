// The one part of a bookmark's hover text that is not a snapshot: the page.
//
// ZotFlow lets the user correct the printed page of an existing highlight
// ("Edit Page Number"), and that is routine rather than exotic — PDFs usually
// carry an offset between the physical page and the printed folio. The popup
// sends `[{ id, pageLabel }]`, so ONLY `pageLabel` changes: the annotation id
// and `position.pageIndex` stay exactly as they were. A bookmark must therefore
// keep navigating by the same id while showing the corrected page.
//
// The source half stays as captured on purpose (a book's authors do not change),
// and the captured page stays as the fallback for when nothing can be looked up.
// Nothing here writes, watches or synchronizes anything.

import { beforeEach, describe, expect, it } from 'vitest';
import { noticeLog } from './mocks/obsidian';
import { resolveLiveTooltip } from '@/utils/liveTooltip';
import { annotationTooltip, withCurrentPage } from '@/utils/sourceLabel';
import {
    buildAnnotationSubpath,
    parseAnnotationSubpath,
} from '@/utils/zotflowAnnotationDrop';
import type { ButtonConfig } from '@/types/settings';

// --- fixtures ----------------------------------------------------------------

const PDF = 'A2_Bib/Bieker, Westerholt (2021) - Soziale Arbeit studieren/PaperA.pdf';
const KEY = 'KWBFL8CQ';
const SOURCE = 'Bieker, Westerholt 2021';
/** The page at capture time, and the physical page it sits on. */
const CAPTURED_PAGE = '43';
const PAGE_INDEX = 43;

/** The tool a drop produced: quote as the label, source + page as hover text. */
function bookmark(overrides: Partial<ButtonConfig> = {}): ButtonConfig {
    return {
        id: 'tool-1',
        name: 'Eine der wichtigsten Lernaufgaben',
        order: 0,
        tooltip: annotationTooltip(SOURCE, CAPTURED_PAGE),
        actions: [
            {
                type: 'file',
                parameters: {
                    filePath: PDF,
                    subpath: buildAnnotationSubpath(KEY, PAGE_INDEX),
                },
            },
        ],
        ...overrides,
    };
}

interface Annotation {
    id: string;
    pageLabel?: string;
    position?: { pageIndex?: number };
}

interface AppOptions {
    /** Sidecar path -> annotations it holds. */
    sidecars?: Record<string, Annotation[]>;
    /** ZotFlow's configured sidecar folder; undefined = ZotFlow absent. */
    sidecarFolder?: string;
    /** An open reader: file path -> annotations it holds in memory. */
    readers?: Record<string, Annotation[]>;
    /** Make the sidecar unreadable. */
    readThrows?: boolean;
    /** Put junk in the sidecar instead of JSON. */
    corrupt?: boolean;
}

function fakeApp(options: AppOptions = {}) {
    const sidecars = options.sidecars ?? {};
    const reads: string[] = [];
    const app = {
        vault: {
            getFileByPath: (path: string) =>
                Object.prototype.hasOwnProperty.call(sidecars, path) ? { path } : null,
            cachedRead: async (file: { path: string }) => {
                reads.push(file.path);
                if (options.readThrows) throw new Error('unreadable');
                if (options.corrupt) return '{ not json';
                return JSON.stringify({ version: 1, annotations: sidecars[file.path] ?? [] });
            },
        },
        workspace: {
            getLeavesOfType: (type: string) => {
                if (type !== 'zotflow-local-zotero-reader-view') return [];
                return Object.entries(options.readers ?? {}).map(([path, annotations]) => ({
                    view: {
                        file: { path },
                        getState: () => ({ file: path }),
                        dataManager: {
                            getAnnotation: (id: string) =>
                                annotations.find((a) => a.id === id) ?? null,
                        },
                    },
                }));
            },
            getMostRecentLeaf: () => null,
        },
        ...(options.sidecarFolder !== undefined
            ? {
                  plugins: {
                      plugins: {
                          zotflow: { settings: { localSidecarFolder: options.sidecarFolder } },
                      },
                  },
              }
            : {}),
    };
    return { app: app as never, reads };
}

/** Where ZotFlow's installed (patched) build puts the sidecar. */
const SIDECAR = 'A2_Bib/Bieker, Westerholt (2021) - Soziale Arbeit studieren/Annotation/PaperA.zf.json';
/** Where a stock build would put it. */
const SIDECAR_STOCK = 'Annotation/A2_Bib/Bieker, Westerholt (2021) - Soziale Arbeit studieren/PaperA.zf.json';

beforeEach(() => {
    noticeLog.length = 0;
});

// --- the reported workflow ---------------------------------------------------

describe('a page corrected in ZotFlow after the bookmark was made', () => {
    it('shows the corrected page, from the open reader', async () => {
        // Exactly the reported case: the user fixes the page in the reader, so
        // the reader is open and already holds the new value.
        const { app, reads } = fakeApp({
            sidecarFolder: 'Annotation',
            readers: { [PDF]: [{ id: KEY, pageLabel: '45', position: { pageIndex: PAGE_INDEX } }] },
        });

        await expect(resolveLiveTooltip(app, bookmark())).resolves.toBe(
            'Bieker, Westerholt 2021 · S. 45'
        );
        // The open reader answered, so nothing was read from disk.
        expect(reads).toEqual([]);
    });

    it('shows the corrected page with the reader closed, from the sidecar', async () => {
        const { app, reads } = fakeApp({
            sidecarFolder: 'Annotation',
            sidecars: {
                [SIDECAR]: [{ id: KEY, pageLabel: '45', position: { pageIndex: PAGE_INDEX } }],
            },
        });

        await expect(resolveLiveTooltip(app, bookmark())).resolves.toBe(
            'Bieker, Westerholt 2021 · S. 45'
        );
        expect(reads).toEqual([SIDECAR]);
    });

    it('leaves the navigation untouched — same id, same physical page', () => {
        // The bookmark is still for the same annotation; only what it SHOWS moved.
        const action = bookmark().actions[0]!;
        expect(action.type).toBe('file');
        if (action.type !== 'file') return;
        expect(parseAnnotationSubpath(action.parameters.subpath)).toEqual({
            annotationId: KEY,
            pageIndex: PAGE_INDEX,
        });
        // Not the printed page: the physical one, which is what a plain viewer counts.
        expect(action.parameters.subpath).toContain(`#page=${PAGE_INDEX + 1}#`);
    });

    it('keeps the source exactly as captured, however the page moves', async () => {
        const { app } = fakeApp({
            sidecarFolder: 'Annotation',
            sidecars: { [SIDECAR]: [{ id: KEY, pageLabel: 'Cover' }] },
        });
        // A book's authors do not change because a page number was corrected.
        await expect(resolveLiveTooltip(app, bookmark())).resolves.toBe(
            'Bieker, Westerholt 2021 · S. Cover'
        );
    });

    it('says nothing when the page has not changed', async () => {
        const { app } = fakeApp({
            sidecarFolder: 'Annotation',
            sidecars: { [SIDECAR]: [{ id: KEY, pageLabel: CAPTURED_PAGE }] },
        });
        // Null means "keep what is bound", so no needless rebinding.
        await expect(resolveLiveTooltip(app, bookmark())).resolves.toBeNull();
    });

    it('finds the sidecar whichever way this ZotFlow build lays it out', async () => {
        const { app, reads } = fakeApp({
            sidecarFolder: 'Annotation',
            sidecars: { [SIDECAR_STOCK]: [{ id: KEY, pageLabel: '45' }] },
        });

        await expect(resolveLiveTooltip(app, bookmark())).resolves.toBe(
            'Bieker, Westerholt 2021 · S. 45'
        );
        expect(reads).toEqual([SIDECAR_STOCK]);
    });

    it('prefers the open reader over the sidecar', async () => {
        // The reader holds the newest value; the file may lag behind a save.
        const { app, reads } = fakeApp({
            sidecarFolder: 'Annotation',
            readers: { [PDF]: [{ id: KEY, pageLabel: '46' }] },
            sidecars: { [SIDECAR]: [{ id: KEY, pageLabel: '45' }] },
        });

        await expect(resolveLiveTooltip(app, bookmark())).resolves.toBe(
            'Bieker, Westerholt 2021 · S. 46'
        );
        expect(reads).toEqual([]);
    });
});

// --- falling back ------------------------------------------------------------

describe('when the current page cannot be found', () => {
    const keepsStored = async (options: AppOptions) => {
        const { app } = fakeApp(options);
        // null = keep the captured text, which still carries the captured page.
        await expect(resolveLiveTooltip(app, bookmark())).resolves.toBeNull();
        expect(noticeLog).toEqual([]);
    };

    it('keeps the captured page when the annotation was deleted', async () => {
        await keepsStored({ sidecarFolder: 'Annotation', sidecars: { [SIDECAR]: [] } });
        await keepsStored({
            sidecarFolder: 'Annotation',
            sidecars: { [SIDECAR]: [{ id: 'OTHERKEY' }] },
        });
    });

    it('keeps the captured page when the current annotation has no page label', async () => {
        await keepsStored({
            sidecarFolder: 'Annotation',
            sidecars: { [SIDECAR]: [{ id: KEY, position: { pageIndex: PAGE_INDEX } }] },
        });
        await keepsStored({
            sidecarFolder: 'Annotation',
            sidecars: { [SIDECAR]: [{ id: KEY, pageLabel: '   ' }] },
        });
    });

    it('keeps the captured page when ZotFlow is absent', async () => {
        // No plugin, so no sidecar folder setting and no reader.
        await keepsStored({});
    });

    it('keeps the captured page when the sidecar is missing, unreadable or corrupt', async () => {
        await keepsStored({ sidecarFolder: 'Annotation' });
        await keepsStored({
            sidecarFolder: 'Annotation',
            sidecars: { [SIDECAR]: [{ id: KEY, pageLabel: '45' }] },
            readThrows: true,
        });
        await keepsStored({
            sidecarFolder: 'Annotation',
            sidecars: { [SIDECAR]: [{ id: KEY, pageLabel: '45' }] },
            corrupt: true,
        });
    });

    it('never rejects, whatever shape the app or the tool is in', async () => {
        // This runs while the pointer is moving: the only acceptable failure is
        // "I do not know". A rejection here would surface as an unhandled one.
        const hostileApps: unknown[] = [
            {},
            { workspace: {} },
            { workspace: { getLeavesOfType: () => [null] } },
            { workspace: { getLeavesOfType: () => [{}] } },
            { workspace: { getLeavesOfType: () => [{ view: null }] } },
            { workspace: { getLeavesOfType: () => [{ view: undefined }] } },
            { workspace: { getLeavesOfType: () => { throw new Error('boom'); } } },
            { workspace: { getLeavesOfType: () => [] }, vault: {} },
        ];
        for (const app of hostileApps) {
            await expect(resolveLiveTooltip(app as never, bookmark())).resolves.toBeNull();
        }

        // A tool whose action shape is not what the types promise.
        const { app } = fakeApp({ sidecarFolder: 'Annotation' });
        const broken = [
            { ...bookmark(), actions: [{ type: 'file' } as never] },
            {
                ...bookmark(),
                actions: [{ type: 'file', parameters: { filePath: 42, subpath: 1 } } as never],
            },
            { ...bookmark(), actions: undefined as never },
        ];
        for (const button of broken) {
            await expect(resolveLiveTooltip(app, button)).resolves.toBeNull();
        }
        expect(noticeLog).toEqual([]);
    });

    it('never raises a notice, however badly the lookup fails', async () => {
        // Hovering must stay silent: it is not an action the user asked for.
        for (const options of [
            {},
            { sidecarFolder: 'Annotation' },
            { sidecarFolder: 'Annotation', sidecars: { [SIDECAR]: [] } },
            { sidecarFolder: 'Annotation', readThrows: true },
        ]) {
            const { app } = fakeApp(options);
            await expect(resolveLiveTooltip(app, bookmark())).resolves.toBeNull();
        }
        expect(noticeLog).toEqual([]);
    });
});

// --- tools that are not bookmarks -------------------------------------------

describe('tools that have nothing to refresh', () => {
    const untouched = async (button: ButtonConfig) => {
        const { app, reads } = fakeApp({
            sidecarFolder: 'Annotation',
            sidecars: { [SIDECAR]: [{ id: KEY, pageLabel: '45' }] },
        });
        await expect(resolveLiveTooltip(app, button)).resolves.toBeNull();
        // Not a single lookup for an ordinary tool.
        expect(reads).toEqual([]);
    };

    it('a plain file tool', async () => {
        await untouched({
            id: 't',
            name: 'Paper',
            order: 0,
            actions: [{ type: 'file', parameters: { filePath: PDF } }],
        });
    });

    it('a file tool pointing at a heading or a block', async () => {
        await untouched({
            id: 't',
            name: 'Note',
            order: 0,
            tooltip: 'something',
            actions: [{ type: 'file', parameters: { filePath: 'n.md', subpath: '#Heading' } }],
        });
        await untouched({
            id: 't',
            name: 'Note',
            order: 0,
            tooltip: 'something',
            actions: [{ type: 'file', parameters: { filePath: 'n.md', subpath: '#^abc123' } }],
        });
    });

    it('a library annotation, which is a url tool', async () => {
        await untouched({
            id: 't',
            name: 'quote',
            order: 0,
            tooltip: 'S. 5',
            actions: [
                {
                    type: 'url',
                    parameters: { url: 'obsidian://zotflow?type=open-annotation&libraryID=1&key=KWBFL8CQ' },
                },
            ],
        });
    });

    it('a bookmark with no stored hover text', async () => {
        await untouched(bookmark({ tooltip: undefined }));
    });

    it('a tool with no actions at all', async () => {
        await untouched({ id: 't', name: 'x', order: 0, tooltip: 'x', actions: [] });
    });
});

// --- the pure pieces ---------------------------------------------------------

describe('reading an annotation back out of a stored subpath', () => {
    it('is the exact inverse of building one', () => {
        expect(parseAnnotationSubpath(buildAnnotationSubpath(KEY, 43))).toEqual({
            annotationId: KEY,
            pageIndex: 43,
        });
        expect(parseAnnotationSubpath(buildAnnotationSubpath(KEY))).toEqual({
            annotationId: KEY,
        });
    });

    it('reads the shape ZotFlow itself writes, without a pageIndex', () => {
        const zotflowsOwn = `#page=109#annotation=${encodeURIComponent(
            JSON.stringify({ annotationID: '5AV2LDD3' })
        )}`;
        expect(parseAnnotationSubpath(zotflowsOwn)).toEqual({ annotationId: '5AV2LDD3' });
    });

    it('claims nothing that is not an annotation subpath', () => {
        for (const subpath of [
            undefined,
            '',
            '#Heading',
            '#^abc123',
            '#page=12',
            '#annotation=not-json',
            // The word inside a heading is not a subpath component.
            `#Heading mit annotation=${encodeURIComponent(JSON.stringify({ annotationID: KEY }))}`,
            `#^blockref annotation=${encodeURIComponent(JSON.stringify({ annotationID: KEY }))}`,
            '#annotation=%ZZ',
            `#annotation=${encodeURIComponent(JSON.stringify({ annotationID: 'lower123' }))}`,
            `#annotation=${encodeURIComponent(JSON.stringify({ other: 'KWBFL8CQ' }))}`,
            `#annotation=${encodeURIComponent(JSON.stringify(['KWBFL8CQ']))}`,
            `#annotation=${encodeURIComponent('null')}`,
        ]) {
            expect(parseAnnotationSubpath(subpath), String(subpath)).toBeNull();
        }
    });
});

describe('replacing the page in a stored hover text', () => {
    it('swaps the page and keeps the source', () => {
        expect(withCurrentPage('Bieker, Westerholt 2021 · S. 43', '45')).toBe(
            'Bieker, Westerholt 2021 · S. 45'
        );
    });

    it('adds a page to a text that had none', () => {
        expect(withCurrentPage('Thole 2012', '19')).toBe('Thole 2012 · S. 19');
    });

    it('drops the page when there is no current one', () => {
        expect(withCurrentPage('Thole 2012 · S. 43', undefined)).toBe('Thole 2012');
        expect(withCurrentPage('Thole 2012 · S. 43', '')).toBe('Thole 2012');
    });

    it('handles a page-only text and an empty one', () => {
        expect(withCurrentPage('S. 5', '7')).toBe('S. 7');
        expect(withCurrentPage(undefined, '7')).toBe('S. 7');
        expect(withCurrentPage(undefined, undefined)).toBeUndefined();
    });

    it('is idempotent and round-trips through the builder', () => {
        const once = withCurrentPage(annotationTooltip(SOURCE, '43'), '45');
        expect(withCurrentPage(once, '45')).toBe(once);
        expect(withCurrentPage(once, '43')).toBe(annotationTooltip(SOURCE, '43'));
    });

    it('does not mistake a mid-text page notation for the suffix', () => {
        // Only a TRAILING page part is the page; "S." inside a title stays.
        expect(withCurrentPage('Reihe S. Bd. 3 · S. 12', '14')).toBe('Reihe S. Bd. 3 · S. 14');
    });

    it('keeps a source that itself begins with the page prefix', () => {
        // "S. Freud" is a plausible author abbreviation, and a folder
        // `S. Freud (1900) - Traumdeutung` yields exactly this source. Letting
        // the whole-text form compete with the suffix erased it entirely.
        expect(withCurrentPage('S. Freud 1900 · S. 43', '45')).toBe('S. Freud 1900 · S. 45');
        expect(withCurrentPage('S. Fischer Reader 2001 · S. 7', '45')).toBe(
            'S. Fischer Reader 2001 · S. 45'
        );
        expect(withCurrentPage('S. Freud 1900', '45')).toBe('S. Freud 1900 · S. 45');
    });

    it('removes the LAST page part, so repeated use cannot stack them', () => {
        expect(withCurrentPage('A · S. 1 · S. 2', '3')).toBe('A · S. 1 · S. 3');
    });

    it('handles a multi-line stored text', () => {
        expect(withCurrentPage('Bieker 2021\nzweite Zeile · S. 43', '45')).toBe(
            'Bieker 2021\nzweite Zeile · S. 45'
        );
    });

    it('keeps a non-numeric page label untouched', () => {
        expect(withCurrentPage('Thole 2012 · S. 19', 'xiv')).toBe('Thole 2012 · S. xiv');
    });
});
