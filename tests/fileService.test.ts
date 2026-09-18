// The one path that opens a file, and the position inside it.
//
// `file` actions grew an optional `subpath` (a normal Obsidian link subpath:
// "#heading", "#^block", "#page=3"). Two rules carry the whole feature:
//
// - a file that is NOT open yet is opened with the subpath as part of the link
//   text, because that is exactly what following a link in a note does, and
//   every view already handles it;
// - a file that IS open is never reopened, only moved. A view that refuses a
//   second leaf for the same file (Obsidian's PDF and ZotFlow's reader do)
//   would otherwise throw the navigation away with the duplicate leaf, and the
//   click would look like it did nothing.
//
// A view is allowed to reject a subpath it cannot parse (ZotFlow's reader
// throws on unparsable annotation JSON), so applying it must never turn into a
// failed click: the file stays open and the position is simply not reached.
//
// Behaviour without a subpath must be byte-identical to before — that is what
// keeps every existing file tool working.

import { beforeEach, describe, expect, it } from 'vitest';
import { noticeLog } from './mocks/obsidian';
import { FileService } from '@/services/FileService';
import type { ButtonAction } from '@/types/action';
import { t, tWithParams } from '@/utils/i18n';

// --- harness -----------------------------------------------------------------

interface FakeLeaf {
    view: { file?: { path: string } | null };
    ephemeral: unknown[];
    setEphemeralState: (state: unknown) => void;
    /** A background tab: no real view yet, only persisted state. */
    isDeferred: boolean;
    loaded: number;
    loadIfDeferred?: () => Promise<void>;
    getViewState?: () => { type: string; state?: Record<string, unknown> };
}

interface Harness {
    app: unknown;
    leaves: FakeLeaf[];
    activated: FakeLeaf[];
    opened: { linktext: string; sourcePath: string; newLeaf: unknown }[];
    addLeaf: (path: string | null, onEphemeral?: (state: unknown) => void) => FakeLeaf;
    /** A deferred (background) tab of a given view type showing a file. */
    addDeferredLeaf: (path: string, viewType: string) => FakeLeaf;
}

function harness(
    options: {
        files?: string[];
        /** undefined = no registry at all; a map = extension -> view type. */
        viewTypes?: Record<string, string> | undefined;
        registryThrows?: boolean;
        /** Make `openLinkText` throw for any link text carrying a subpath. */
        openThrowsOnSubpath?: boolean;
    } = {}
): Harness {
    const files = new Set(options.files ?? []);
    const leaves: FakeLeaf[] = [];
    const activated: FakeLeaf[] = [];
    const opened: { linktext: string; sourcePath: string; newLeaf: unknown }[] = [];

    const addLeaf = (path: string | null, onEphemeral?: (state: unknown) => void): FakeLeaf => {
        const leaf: FakeLeaf = {
            view: path === null ? { file: null } : { file: { path } },
            ephemeral: [],
            isDeferred: false,
            loaded: 0,
            setEphemeralState: (state: unknown) => {
                leaf.ephemeral.push(state);
                onEphemeral?.(state);
            },
        };
        leaves.push(leaf);
        return leaf;
    };

    const addDeferredLeaf = (path: string, viewType: string): FakeLeaf => {
        // A deferred leaf's view is a placeholder: no `file` at all.
        const leaf: FakeLeaf = {
            view: {},
            ephemeral: [],
            isDeferred: true,
            loaded: 0,
            setEphemeralState: (state: unknown) => {
                leaf.ephemeral.push(state);
            },
            loadIfDeferred: async () => {
                leaf.loaded += 1;
                leaf.isDeferred = false;
                leaf.view = { file: { path } };
            },
            getViewState: () => ({ type: viewType, state: { file: path } }),
        };
        leaves.push(leaf);
        return leaf;
    };

    const app = {
        vault: {
            getFileByPath: (path: string) => {
                if (!files.has(path)) return null;
                const lastDot = path.lastIndexOf('.');
                return {
                    path,
                    extension: lastDot === -1 ? '' : path.slice(lastDot + 1),
                };
            },
        },
        workspace: {
            iterateAllLeaves: (cb: (leaf: FakeLeaf) => void) => leaves.forEach(cb),
            setActiveLeaf: (leaf: FakeLeaf) => {
                activated.push(leaf);
            },
            openLinkText: async (linktext: string, sourcePath: string, newLeaf: unknown) => {
                opened.push({ linktext, sourcePath, newLeaf });
                if (options.openThrowsOnSubpath && linktext.includes('#')) {
                    // What a view does when it cannot parse the subpath.
                    throw new Error("Unexpected token 'o', \"oops\" is not valid JSON");
                }
            },
        },
        ...(options.viewTypes !== undefined
            ? {
                  viewRegistry: {
                      getTypeByExtension: (ext: string) => {
                          if (options.registryThrows) throw new Error('boom');
                          return options.viewTypes?.[ext];
                      },
                  },
              }
            : {}),
    };

    return { app, leaves, activated, opened, addLeaf, addDeferredLeaf };
}

function service(h: Harness): FileService {
    return new FileService(h.app as never);
}

function fileAction(filePath: string, subpath?: string): ButtonAction {
    return {
        type: 'file',
        parameters: { filePath, ...(subpath !== undefined ? { subpath } : {}) },
    };
}

const PDF = 'A2_Bib/Source/Paper.pdf';
const SUBPATH = '#page=44#annotation=%7B%22annotationID%22%3A%22KWBFL8CQ%22%7D';

beforeEach(() => {
    noticeLog.length = 0;
});

// --- no subpath: unchanged behaviour -----------------------------------------

describe('FileService without a subpath', () => {
    it('opens a closed file in a new leaf, by its plain path', async () => {
        const h = harness({ files: [PDF], viewTypes: { pdf: 'pdf' } });
        await service(h).openFile(fileAction(PDF));

        expect(h.opened).toEqual([{ linktext: PDF, sourcePath: '', newLeaf: true }]);
        expect(noticeLog).toEqual([]);
    });

    it('activates an existing leaf and never touches its ephemeral state', async () => {
        const h = harness({ files: [PDF], viewTypes: { pdf: 'pdf' } });
        const leaf = h.addLeaf(PDF);
        await service(h).openFile(fileAction(PDF));

        expect(h.activated).toEqual([leaf]);
        expect(leaf.ephemeral).toEqual([]);
        expect(h.opened).toEqual([]);
    });

    it('notices a missing file and opens nothing', async () => {
        const h = harness({ files: [], viewTypes: { pdf: 'pdf' } });
        await service(h).openFile(fileAction(PDF));

        expect(h.opened).toEqual([]);
        expect(noticeLog).toEqual([`${t('file_not_found')}: ${PDF}`]);
    });

    it('rejects a non-file action', async () => {
        const h = harness({ files: [PDF] });
        await expect(
            service(h).openFile({ type: 'url', parameters: { url: 'https://example.com' } })
        ).rejects.toThrow(/Invalid action type/);
    });
});

// --- with a subpath ----------------------------------------------------------

describe('FileService with a subpath', () => {
    it('appends the subpath to the link text when the file is not open', async () => {
        const h = harness({ files: [PDF], viewTypes: { pdf: 'pdf' } });
        await service(h).openFile(fileAction(PDF, SUBPATH));

        expect(h.opened).toEqual([
            { linktext: `${PDF}${SUBPATH}`, sourcePath: '', newLeaf: true },
        ]);
    });

    it('moves an already open leaf instead of reopening the file', async () => {
        const h = harness({ files: [PDF], viewTypes: { pdf: 'pdf' } });
        const leaf = h.addLeaf(PDF);
        await service(h).openFile(fileAction(PDF, SUBPATH));

        expect(h.activated).toEqual([leaf]);
        expect(leaf.ephemeral).toEqual([{ subpath: SUBPATH }]);
        // Reopening is what loses the navigation in views that refuse duplicates.
        expect(h.opened).toEqual([]);
    });

    it('picks the leaf showing this file, not another one', async () => {
        const h = harness({ files: [PDF], viewTypes: { pdf: 'pdf' } });
        const other = h.addLeaf('A2_Bib/Source/Other.pdf');
        const fileLess = h.addLeaf(null);
        const target = h.addLeaf(PDF);
        await service(h).openFile(fileAction(PDF, SUBPATH));

        expect(h.activated).toEqual([target]);
        expect(target.ephemeral).toEqual([{ subpath: SUBPATH }]);
        expect(other.ephemeral).toEqual([]);
        expect(fileLess.ephemeral).toEqual([]);
    });

    it('survives a view that throws on the subpath, keeping the file open', async () => {
        const h = harness({ files: [PDF], viewTypes: { pdf: 'pdf' } });
        const leaf = h.addLeaf(PDF, () => {
            throw new Error('Unexpected token o in JSON');
        });

        await expect(service(h).openFile(fileAction(PDF, '#annotation=not-json'))).resolves
            .toBeUndefined();
        expect(h.activated).toEqual([leaf]);
    });

    it('ignores a blank subpath, behaving exactly like no subpath', async () => {
        const h = harness({ files: [PDF], viewTypes: { pdf: 'pdf' } });
        const leaf = h.addLeaf(PDF);
        await service(h).openFile(fileAction(PDF, '   '));

        expect(leaf.ephemeral).toEqual([]);
        expect(h.opened).toEqual([]);
    });

    it('falls back to opening the plain file when the subpath is rejected', async () => {
        // Reachable from an imported template: any string is a valid subpath as
        // far as the format is concerned, and the view decides whether it parses.
        const h = harness({
            files: [PDF],
            viewTypes: { pdf: 'pdf' },
            openThrowsOnSubpath: true,
        });

        await expect(
            service(h).openFile(fileAction(PDF, '#annotation=oops'))
        ).resolves.toBeUndefined();

        expect(h.opened.map((o) => o.linktext)).toEqual([`${PDF}#annotation=oops`, PDF]);
    });

    it('does not notice a missing file twice or navigate it', async () => {
        const h = harness({ files: [], viewTypes: { pdf: 'pdf' } });
        await service(h).openFile(fileAction(PDF, SUBPATH));

        expect(noticeLog).toEqual([`${t('file_not_found')}: ${PDF}`]);
        expect(h.opened).toEqual([]);
    });
});

// --- background (deferred) tabs -----------------------------------------------
//
// Since Obsidian 1.7 a tab in the background has no real view yet, so it exposes
// no file and only its persisted state knows the path. Treating that as "not
// open" opened a duplicate for every background tab — and a view that refuses a
// duplicate for the same file discards the navigation with it, so the click
// looked dead. A reader left open in the background is the normal state.

describe('FileService and a background tab', () => {
    const READER = 'zotflow-local-zotero-reader-view';

    it('finds the deferred tab, builds it, and navigates it instead of opening another', async () => {
        const h = harness({ files: [PDF], viewTypes: { pdf: READER } });
        const leaf = h.addDeferredLeaf(PDF, READER);

        await service(h).openFile(fileAction(PDF, SUBPATH));

        expect(h.opened).toEqual([]);
        expect(h.activated).toEqual([leaf]);
        // Built before it was asked to navigate, or it would have nowhere to go.
        expect(leaf.loaded).toBe(1);
        expect(leaf.ephemeral).toEqual([{ subpath: SUBPATH }]);
    });

    it('does not build it when there is no position to move to', async () => {
        const h = harness({ files: [PDF], viewTypes: { pdf: READER } });
        const leaf = h.addDeferredLeaf(PDF, READER);

        await service(h).openFile(fileAction(PDF));

        expect(h.activated).toEqual([leaf]);
        expect(leaf.loaded).toBe(0);
        expect(h.opened).toEqual([]);
    });

    it('ignores a sidebar pane that merely describes the same file', async () => {
        // Backlinks, outline and local graph persist a `file` in their state too.
        // Focusing one of those would ignore the position and look like a dead
        // bookmark, so only the view type that OPENS the file counts.
        const h = harness({ files: [PDF], viewTypes: { pdf: READER } });
        const backlinks = h.addDeferredLeaf(PDF, 'backlink');
        const outline = h.addDeferredLeaf(PDF, 'outline');

        await service(h).openFile(fileAction(PDF, SUBPATH));

        expect(h.activated).toEqual([]);
        expect(backlinks.ephemeral).toEqual([]);
        expect(outline.ephemeral).toEqual([]);
        expect(h.opened).toEqual([{ linktext: `${PDF}${SUBPATH}`, sourcePath: '', newLeaf: true }]);
    });

    it('prefers a built view over a deferred one', async () => {
        const h = harness({ files: [PDF], viewTypes: { pdf: READER } });
        h.addDeferredLeaf(PDF, READER);
        const built = h.addLeaf(PDF);

        await service(h).openFile(fileAction(PDF, SUBPATH));

        expect(h.activated).toEqual([built]);
        expect(built.ephemeral).toEqual([{ subpath: SUBPATH }]);
    });

    it('does not consult deferred state when the registry cannot be read', async () => {
        // Without the view type there is no way to tell a reader tab from a
        // sidebar pane, so the conservative answer is "not open".
        const h = harness({ files: [PDF], viewTypes: undefined });
        const leaf = h.addDeferredLeaf(PDF, READER);

        await service(h).openFile(fileAction(PDF, SUBPATH));

        expect(h.activated).toEqual([]);
        expect(leaf.ephemeral).toEqual([]);
        expect(h.opened).toHaveLength(1);
    });

    it('reuses the leaf that was just created when the subpath is rejected', async () => {
        // The view is built before it rejects the position, so the file is
        // already on screen; opening it again would add a second tab.
        const h = harness({
            files: [PDF],
            viewTypes: { pdf: READER },
            openThrowsOnSubpath: true,
        });
        // Simulate the leaf appearing as a result of the first open.
        let created: FakeLeaf | null = null;
        const original = h.app as { workspace: { openLinkText: (...args: unknown[]) => Promise<void> } };
        const wrapped = original.workspace.openLinkText.bind(original.workspace);
        original.workspace.openLinkText = async (...args: unknown[]) => {
            if (!created) {
                created = h.addLeaf(PDF);
            }
            await wrapped(...args);
        };

        await expect(
            service(h).openFile(fileAction(PDF, '#annotation=oops'))
        ).resolves.toBeUndefined();

        expect(h.opened.map((o) => o.linktext)).toEqual([`${PDF}#annotation=oops`]);
        expect(h.activated).toEqual([created]);
    });
});

// --- missing viewer ----------------------------------------------------------

describe('FileService when no view is registered for the extension', () => {
    it('says so when a position was asked for, instead of appearing to do nothing', async () => {
        const h = harness({ files: [PDF], viewTypes: {} });
        await service(h).openFile(fileAction(PDF, SUBPATH));

        expect(noticeLog).toEqual([tWithParams('no_view_for_extension', { extension: 'pdf' })]);
        // The open is still attempted; the notice explains the likely no-op.
        expect(h.opened).toHaveLength(1);
    });

    it('stays quiet for a plain file tool, whatever its extension', async () => {
        // Obsidian registers no view for `.js` or `.txt`, and this plugin
        // deliberately creates Open file tools for them (a script outside the
        // script folder). Warning there would be noise on a supported case.
        for (const path of ['scripts/out/test.js', 'notes/plain.txt', 'no-extension']) {
            const h = harness({ files: [path], viewTypes: { md: 'markdown', pdf: 'pdf' } });
            await service(h).openFile(fileAction(path));
            expect(noticeLog, path).toEqual([]);
            expect(h.opened, path).toHaveLength(1);
        }
    });

    it('stays quiet when a viewer exists', async () => {
        const h = harness({ files: [PDF], viewTypes: { pdf: 'zotflow-local-zotero-reader-view' } });
        await service(h).openFile(fileAction(PDF, SUBPATH));

        expect(noticeLog).toEqual([]);
    });

    it('stays quiet when the registry is absent or throws', async () => {
        const withoutRegistry = harness({ files: [PDF], viewTypes: undefined });
        await service(withoutRegistry).openFile(fileAction(PDF, SUBPATH));
        expect(noticeLog).toEqual([]);
        expect(withoutRegistry.opened).toHaveLength(1);

        const throwing = harness({ files: [PDF], viewTypes: {}, registryThrows: true });
        await service(throwing).openFile(fileAction(PDF, SUBPATH));
        expect(noticeLog).toEqual([]);
        expect(throwing.opened).toHaveLength(1);
    });

    it('does not consult the registry at all for an already open file', async () => {
        const h = harness({ files: [PDF], viewTypes: {} });
        h.addLeaf(PDF);
        await service(h).openFile(fileAction(PDF, SUBPATH));

        expect(noticeLog).toEqual([]);
    });
});
