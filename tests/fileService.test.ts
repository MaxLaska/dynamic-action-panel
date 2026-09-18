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
}

interface Harness {
    app: unknown;
    leaves: FakeLeaf[];
    activated: FakeLeaf[];
    opened: { linktext: string; sourcePath: string; newLeaf: unknown }[];
    addLeaf: (path: string | null, onEphemeral?: (state: unknown) => void) => FakeLeaf;
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
            setEphemeralState: (state: unknown) => {
                leaf.ephemeral.push(state);
                onEphemeral?.(state);
            },
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

    return { app, leaves, activated, opened, addLeaf };
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
