// tests/templateLibrary.test.ts
// The managed template library: the fixed folder that exported templates land
// in and that the normal import reads from.
//
// The property this file exists to defend: A TEMPLATE NEVER LANDS IN THE VAULT
// ROOT AGAIN. That is not one check but several, because the folder prefix has
// to survive every branch of the naming logic — the free name, each rung of the
// collision ladder, and the timestamp fallback after 999 collisions. A prefix
// that is dropped in one rarely-taken branch would be invisible until the day
// it fires, and it would litter the user's vault root exactly as before.
//
// The second property: THE LIBRARY IS THE FOLDER. Nothing is indexed, cached or
// remembered, so a file copied in from a backup drive is importable with no
// further step, and a file deleted behind Obsidian's back is simply gone. The
// listing tests pin that it reads the folder and only the folder.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    FileSystemAdapter,
    Platform,
    TFile,
    noticeLog,
    openedSuggestModals,
} from './mocks/obsidian';
import {
    TEMPLATE_LIBRARY_FOLDER,
    ensureTemplateLibraryFolder,
    freeTemplateLibraryPath,
    isTemplateFile,
    listTemplateFiles,
    templateDisplayName,
    templateLibraryPath,
} from '@/export/templateLibrary';
import {
    exportCategoryTemplate,
    importTemplateFromLibrary,
    openTemplateLibraryFolder,
} from '@/export/templateIo';
import { parseTemplateDocument } from '@/export/templateParse';
import type { ToolState } from '@/domain/categoryOps';
import { p, registryOf, stateOf, storedGrid, tool } from './helpers/stored';

// --- Harness ---------------------------------------------------------------

interface VaultOptions {
    /** Folder paths that already exist. */
    folders?: string[];
    /** File paths that already exist. */
    files?: string[];
    /** `createFolder` rejects for these paths. */
    createFolderFails?: string[];
    /** When set, `createFolder` rejects but the folder appears anyway (a race). */
    createFolderRaces?: string[];
    /** `create` rejects with this message. */
    createFails?: string;
    /** Use a real `FileSystemAdapter`, i.e. a desktop vault. */
    desktopAdapter?: boolean;
    /** `read` rejects with this message. */
    readFails?: string;
    /** Extra non-file children the folder reports, e.g. a subfolder. */
    folderChildren?: { name: string; path: string }[];
}

interface Harness {
    app: unknown;
    /** Every `vault.create` call, in order. */
    created: { path: string; content: string }[];
    /** Every `vault.createFolder` call, in order. */
    createdFolders: string[];
}

function harness(options: VaultOptions = {}): Harness {
    const folders = new Set(options.folders ?? []);
    const files = new Set(options.files ?? []);
    const created: { path: string; content: string }[] = [];
    const createdFolders: string[] = [];

    const fileIn = (path: string): TFile => {
        const file = new TFile();
        file.path = path;
        file.name = path.slice(path.lastIndexOf('/') + 1);
        file.stat = { ctime: 0, mtime: 0, size: 0 };
        return file;
    };

    const app = {
        vault: {
            adapter: options.desktopAdapter ? new FileSystemAdapter() : {},
            getAbstractFileByPath: (path: string) =>
                files.has(path) || folders.has(path) ? { path } : null,
            getFolderByPath: (path: string) =>
                folders.has(path)
                    ? {
                          path,
                          children: [
                              ...[...files]
                                  .filter(
                                      (file) =>
                                          file.startsWith(`${path}/`) &&
                                          !file.slice(path.length + 1).includes('/')
                                  )
                                  .map(fileIn),
                              // Not TFile instances on purpose: a real folder
                              // reports its subfolders among its children.
                              ...(options.folderChildren ?? []),
                          ],
                      }
                    : null,
            createFolder: async (path: string) => {
                createdFolders.push(path);
                if (options.createFolderRaces?.includes(path)) {
                    folders.add(path);
                    throw new Error('Folder already exists.');
                }
                if (options.createFolderFails?.includes(path)) {
                    throw new Error('refused');
                }
                folders.add(path);
            },
            create: async (path: string, content: string) => {
                if (options.createFails) {
                    throw new Error(options.createFails);
                }
                created.push({ path, content });
                files.add(path);
            },
            read: async (file: { path: string }) => {
                if (options.readFails) {
                    throw new Error(options.readFails);
                }
                const hit = created.find((entry) => entry.path === file.path);
                return hit?.content ?? '';
            },
        },
    };

    return { app, created, createdFolders };
}

/** A plugin whose settings the export reads and must not change. */
function pluginOf(state: ToolState) {
    return {
        settings: { tools: state.tools, categories: state.categories, pathConfig: {} },
        manifest: { version: '1.0.0' },
        saveSettings: async () => {},
    };
}

const researchState = (): ToolState =>
    stateOf(
        registryOf(tool('t1', { name: 'Open note' })),
        storedGrid([p('t1', 0)], { id: 'c1', name: 'Research' })
    );

beforeEach(() => {
    noticeLog.length = 0;
    openedSuggestModals.length = 0;
    Platform.isDesktopApp = true;
    openedUrls.length = 0;
});

/** Every `window.open` the code under test performed. */
const openedUrls: { url: string; target: string }[] = [];
(globalThis as { window?: unknown }).window = {
    open: (url: string, target: string) => {
        openedUrls.push({ url, target });
        // Obsidian's window-open handler denies after dispatching to the
        // shell, so null is what the real call returns — on success too.
        return null;
    },
};

// `commitToolState` ends every write with a DOM event on Obsidian's
// `activeDocument`, which the node test environment does not have. The import
// round trip below goes through that commit, so the event needs somewhere to
// land; nothing asserts on it.
(globalThis as { activeDocument?: unknown }).activeDocument = {
    dispatchEvent: () => true,
};

// --- The folder ------------------------------------------------------------

describe('the library folder is created on demand and never twice', () => {
    it('creates both levels, outermost first, when nothing exists', async () => {
        const h = harness();
        expect(await ensureTemplateLibraryFolder(h.app as never)).toBeNull();
        expect(h.createdFolders).toEqual([
            'Dynamic Action Panel',
            'Dynamic Action Panel/Templates',
        ]);
    });

    it('creates nothing when the folder is already there', async () => {
        const h = harness({
            folders: ['Dynamic Action Panel', TEMPLATE_LIBRARY_FOLDER],
        });
        expect(await ensureTemplateLibraryFolder(h.app as never)).toBeNull();
        expect(h.createdFolders).toEqual([]);
    });

    it('creates only the missing level when the parent exists', async () => {
        const h = harness({ folders: ['Dynamic Action Panel'] });
        expect(await ensureTemplateLibraryFolder(h.app as never)).toBeNull();
        expect(h.createdFolders).toEqual(['Dynamic Action Panel/Templates']);
    });

    it('accepts losing the race: create threw, but the folder is there now', async () => {
        // Obsidian Sync or a second call can create the folder between the
        // existence check and the call. What matters is the outcome.
        const h = harness({ createFolderRaces: [TEMPLATE_LIBRARY_FOLDER] });
        expect(await ensureTemplateLibraryFolder(h.app as never)).toBeNull();
    });

    it('reports failure when the folder still does not exist afterwards', async () => {
        const h = harness({ createFolderFails: [TEMPLATE_LIBRARY_FOLDER] });
        expect(await ensureTemplateLibraryFolder(h.app as never)).toBe('refused');
    });
});

// --- Export destination ----------------------------------------------------

describe('export writes into the library and nowhere else', () => {
    it('writes into the library folder, not the vault root', async () => {
        const h = harness();
        const state = researchState();
        await exportCategoryTemplate(h.app as never, pluginOf(state) as never, 'c1');

        expect(h.created).toHaveLength(1);
        expect(h.created[0]!.path).toBe(
            'Dynamic Action Panel/Templates/Research.ocap.json'
        );
        // The regression this whole file exists for.
        expect(h.created[0]!.path).not.toBe('Research.ocap.json');
        expect(h.created[0]!.path.includes('/')).toBe(true);
    });

    it('creates the folder before writing into it', async () => {
        const h = harness();
        const state = researchState();
        await exportCategoryTemplate(h.app as never, pluginOf(state) as never, 'c1');
        expect(h.createdFolders).toEqual([
            'Dynamic Action Panel',
            'Dynamic Action Panel/Templates',
        ]);
    });

    it('writes a document that parses back as an ocap template', async () => {
        const h = harness();
        const state = researchState();
        await exportCategoryTemplate(h.app as never, pluginOf(state) as never, 'c1');

        const parsed = parseTemplateDocument(h.created[0]!.content);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.document.format).toBe('ocap-template');
        expect(parsed.document.formatVersion).toBe(1);
        expect(parsed.document.categories[0]!.name).toBe('Research');
    });

    it('names the file and the folder separately in the notice', async () => {
        const h = harness();
        const state = researchState();
        await exportCategoryTemplate(h.app as never, pluginOf(state) as never, 'c1');
        expect(noticeLog[0]).toBe(
            'Exported Research.ocap.json to Dynamic Action Panel/Templates (1 tool).'
        );
    });

    it('refuses to export when the folder cannot be created, and writes nothing', async () => {
        const h = harness({ createFolderFails: [TEMPLATE_LIBRARY_FOLDER] });
        const state = researchState();
        await exportCategoryTemplate(h.app as never, pluginOf(state) as never, 'c1');

        expect(h.created).toEqual([]);
        // The reason travels with the message: the realistic cause is a folder
        // that exists under a different casing, and "it failed" would leave the
        // user with no way to discover that.
        expect(noticeLog[0]).toBe(
            'Failed to create folder: Dynamic Action Panel/Templates (refused)'
        );
    });

    it('reports a write failure without falling back to the root', async () => {
        const h = harness({ createFails: 'disk full' });
        const state = researchState();
        await exportCategoryTemplate(h.app as never, pluginOf(state) as never, 'c1');

        expect(h.created).toEqual([]);
        expect(noticeLog[0]).toBe('Export failed: disk full');
    });

    it('says the category to EXPORT was not found, not the one to rename', async () => {
        // The old message was `category_not_found` — "Category to rename not
        // found" — which is simply a different operation.
        const h = harness();
        const state = researchState();
        await exportCategoryTemplate(h.app as never, pluginOf(state) as never, 'nope');

        expect(h.created).toEqual([]);
        expect(noticeLog[0]).toBe('Category to export not found');
        expect(noticeLog[0]).not.toContain('rename');
    });

    it('leaves the settings byte-identical', async () => {
        const h = harness();
        const state = researchState();
        const before = JSON.stringify(state);
        await exportCategoryTemplate(h.app as never, pluginOf(state) as never, 'c1');
        expect(JSON.stringify(state)).toBe(before);
    });
});

// --- The collision ladder --------------------------------------------------

describe('the collision ladder numbers inside the folder', () => {
    it('uses the plain name when it is free', () => {
        const h = harness({ folders: [TEMPLATE_LIBRARY_FOLDER] });
        expect(freeTemplateLibraryPath(h.app as never, 'Research.ocap.json')).toBe(
            'Dynamic Action Panel/Templates/Research.ocap.json'
        );
    });

    it('climbs Research -> Research 1 -> Research 2, all inside the folder', () => {
        const taken = ['Research.ocap.json'];
        for (const expected of ['Research 1.ocap.json', 'Research 2.ocap.json']) {
            const h = harness({
                folders: [TEMPLATE_LIBRARY_FOLDER],
                files: taken.map((name) => templateLibraryPath(name)),
            });
            const next = freeTemplateLibraryPath(h.app as never, 'Research.ocap.json');
            expect(next).toBe(templateLibraryPath(expected));
            taken.push(expected);
        }
    });

    it('keeps the folder on every rung, never returning a bare name', () => {
        // The silent-root vector: a rung that drops the prefix writes into the
        // vault root, and only after the first name is already taken.
        const files: string[] = [];
        for (let n = 0; n < 12; n += 1) {
            const h = harness({ folders: [TEMPLATE_LIBRARY_FOLDER], files: [...files] });
            const next = freeTemplateLibraryPath(h.app as never, 'Research.ocap.json');
            expect(next.startsWith(`${TEMPLATE_LIBRARY_FOLDER}/`)).toBe(true);
            files.push(next);
        }
        expect(files).toHaveLength(12);
        expect(new Set(files).size).toBe(12);
    });

    it('keeps the folder on the timestamp fallback after 999 collisions', () => {
        // The last branch, and the one nobody ever reaches by hand.
        const files = [templateLibraryPath('Research.ocap.json')];
        for (let n = 1; n < 1000; n += 1) {
            files.push(templateLibraryPath(`Research ${n}.ocap.json`));
        }
        const h = harness({ folders: [TEMPLATE_LIBRARY_FOLDER], files });
        const next = freeTemplateLibraryPath(h.app as never, 'Research.ocap.json');

        expect(next.startsWith(`${TEMPLATE_LIBRARY_FOLDER}/Research `)).toBe(true);
        expect(next.endsWith('.ocap.json')).toBe(true);
        expect(files).not.toContain(next);
    });

    it('numbers a name that does not carry the extension without losing the folder', () => {
        const h = harness({
            folders: [TEMPLATE_LIBRARY_FOLDER],
            files: [templateLibraryPath('Notes')],
        });
        expect(freeTemplateLibraryPath(h.app as never, 'Notes')).toBe(
            templateLibraryPath('Notes 1.ocap.json')
        );
    });
});

// --- Listing ---------------------------------------------------------------

describe('the library lists the folder, and only the folder', () => {
    it('lists the templates that are in it', () => {
        const h = harness({
            folders: [TEMPLATE_LIBRARY_FOLDER],
            files: [
                templateLibraryPath('Research.ocap.json'),
                templateLibraryPath('Writing.ocap.json'),
            ],
        });
        expect(listTemplateFiles(h.app as never).map((f) => f.name)).toEqual([
            'Research.ocap.json',
            'Writing.ocap.json',
        ]);
    });

    it('ignores files that are not templates', () => {
        const h = harness({
            folders: [TEMPLATE_LIBRARY_FOLDER],
            files: [
                templateLibraryPath('Research.ocap.json'),
                templateLibraryPath('Readme.md'),
                templateLibraryPath('settings.json'),
                templateLibraryPath('notes.ocap.json.bak'),
            ],
        });
        expect(listTemplateFiles(h.app as never).map((f) => f.name)).toEqual([
            'Research.ocap.json',
        ]);
    });

    it('ignores a template that sits somewhere else in the vault', () => {
        // A stray export next to a note is not part of the handover zone.
        const h = harness({
            folders: [TEMPLATE_LIBRARY_FOLDER],
            files: [
                'Research.ocap.json',
                'Inbox/Other.ocap.json',
                templateLibraryPath('Mine.ocap.json'),
            ],
        });
        expect(listTemplateFiles(h.app as never).map((f) => f.name)).toEqual([
            'Mine.ocap.json',
        ]);
    });

    it('ignores a template in a subfolder of the library', () => {
        const h = harness({
            folders: [TEMPLATE_LIBRARY_FOLDER],
            files: [
                templateLibraryPath('Mine.ocap.json'),
                templateLibraryPath('Archive/Old.ocap.json'),
            ],
        });
        expect(listTemplateFiles(h.app as never).map((f) => f.name)).toEqual([
            'Mine.ocap.json',
        ]);
    });

    it('sorts numerically so Research 2 precedes Research 10', () => {
        const h = harness({
            folders: [TEMPLATE_LIBRARY_FOLDER],
            files: [
                templateLibraryPath('Research 10.ocap.json'),
                templateLibraryPath('Research 2.ocap.json'),
                templateLibraryPath('Research.ocap.json'),
            ],
        });
        expect(listTemplateFiles(h.app as never).map((f) => f.name)).toEqual([
            'Research.ocap.json',
            'Research 2.ocap.json',
            'Research 10.ocap.json',
        ]);
    });

    it('ignores a child that is a folder, not a file', () => {
        // A folder can be named anything, including `Archive.ocap.json`.
        // Offering it would make the import read a directory.
        const h = harness({
            folders: [TEMPLATE_LIBRARY_FOLDER],
            files: [templateLibraryPath('Mine.ocap.json')],
            folderChildren: [
                {
                    name: 'Archive.ocap.json',
                    path: templateLibraryPath('Archive.ocap.json'),
                },
            ],
        });
        expect(listTemplateFiles(h.app as never).map((f) => f.name)).toEqual([
            'Mine.ocap.json',
        ]);
    });

    it('finds a template whose extension arrived in the wrong case', () => {
        // A zip round trip or a case-normalizing copy can hand back
        // `.OCAP.JSON`; the user sees the file and expects it in the list.
        const h = harness({
            folders: [TEMPLATE_LIBRARY_FOLDER],
            files: [templateLibraryPath('Shouty.OCAP.JSON')],
        });
        const listed = listTemplateFiles(h.app as never);
        expect(listed.map((f) => f.name)).toEqual(['Shouty.OCAP.JSON']);
        expect(templateDisplayName(listed[0]!)).toBe('Shouty');
    });

    it('returns nothing for an empty folder, without throwing', () => {
        const h = harness({ folders: [TEMPLATE_LIBRARY_FOLDER] });
        expect(listTemplateFiles(h.app as never)).toEqual([]);
    });

    it('returns nothing when the folder does not exist yet', () => {
        const h = harness();
        expect(listTemplateFiles(h.app as never)).toEqual([]);
    });

    it('finds a file that was copied in from outside, with no refresh step', () => {
        // The backup workflow: the file simply appears in the folder.
        const h = harness({
            folders: [TEMPLATE_LIBRARY_FOLDER],
            files: [templateLibraryPath('From backup.ocap.json')],
        });
        expect(listTemplateFiles(h.app as never).map((f) => f.name)).toEqual([
            'From backup.ocap.json',
        ]);
    });
});

describe('names shown to the user', () => {
    it('drops the extension for display', () => {
        expect(templateDisplayName({ name: 'Research 2.ocap.json' })).toBe('Research 2');
    });

    it('leaves a name that does not carry the extension alone', () => {
        expect(templateDisplayName({ name: 'Research' })).toBe('Research');
    });

    it('recognizes a template by its full name, not by its extension', () => {
        // `TFile.extension` is `json` for `Research.ocap.json` — matching on it
        // would sweep in every JSON file in the folder.
        expect(isTemplateFile({ name: 'Research.ocap.json' })).toBe(true);
        expect(isTemplateFile({ name: 'Research.json' })).toBe(false);
        expect(isTemplateFile({})).toBe(false);
    });

    it('puts a template under the library folder', () => {
        expect(templateLibraryPath('A.ocap.json')).toBe(
            'Dynamic Action Panel/Templates/A.ocap.json'
        );
    });
});

// --- The picker -----------------------------------------------------------

/**
 * Drives the picker the way a user would: open it, then choose an entry. There
 * is no jsdom, so the modal is taken from the mock's record of opened modals
 * and its real `getItems` / `onChooseItem` are called — the production path
 * runs, only the rendering does not.
 */
async function pickFromLibrary(h: Harness, plugin: unknown, displayName: string) {
    await importTemplateFromLibrary(h.app as never, plugin as never);
    const modal = openedSuggestModals.at(-1);
    if (!modal) return { modal: null, items: [] as string[] };
    const items = (modal.getItems() as TFile[]).map((file) =>
        modal.getItemText(file as never)
    );
    const chosen = (modal.getItems() as TFile[]).find(
        (file) => modal.getItemText(file as never) === displayName
    );
    if (chosen) {
        modal.onChooseItem(chosen);
        // `onChooseItem` starts the read and the import without awaiting them,
        // because Obsidian's own signature returns void. Draining the
        // microtask queue is enough here: every fake in the harness resolves
        // immediately, so no timer is involved.
        for (let turn = 0; turn < 20; turn += 1) {
            await Promise.resolve();
        }
    }
    return { modal, items };
}

describe('the picker imports what the user chose', () => {
    it('offers the library contents under their display names', async () => {
        const h = harness({
            folders: ['Dynamic Action Panel', TEMPLATE_LIBRARY_FOLDER],
            files: [
                templateLibraryPath('Research.ocap.json'),
                templateLibraryPath('Writing.ocap.json'),
            ],
        });
        const { items } = await pickFromLibrary(h, pluginOf(researchState()), 'none');
        expect(items).toEqual(['Research', 'Writing']);
    });

    it('creates the folder so an empty library can explain itself', async () => {
        const h = harness();
        await pickFromLibrary(h, pluginOf(researchState()), 'none');
        expect(h.createdFolders).toEqual([
            'Dynamic Action Panel',
            'Dynamic Action Panel/Templates',
        ]);
        expect(openedSuggestModals).toHaveLength(1);
    });

    it('does not open a picker when the folder cannot be created', async () => {
        const h = harness({ createFolderFails: [TEMPLATE_LIBRARY_FOLDER] });
        await pickFromLibrary(h, pluginOf(researchState()), 'none');
        expect(openedSuggestModals).toEqual([]);
        expect(noticeLog[0]).toContain('Failed to create folder');
        // The reason is carried through rather than swallowed.
        expect(noticeLog[0]).toContain('refused');
    });

    it('commits nothing when the picker is dismissed', async () => {
        const h = harness({
            folders: ['Dynamic Action Panel', TEMPLATE_LIBRARY_FOLDER],
            files: [templateLibraryPath('Research.ocap.json')],
        });
        const plugin = pluginOf(researchState());
        const before = JSON.stringify(plugin.settings.categories);

        // Open, choose nothing — which is what Escape does.
        await importTemplateFromLibrary(h.app as never, plugin as never);
        expect(openedSuggestModals).toHaveLength(1);

        expect(JSON.stringify(plugin.settings.categories)).toBe(before);
        expect(noticeLog).toEqual([]);
    });

    it('reports a read failure instead of importing nothing silently', async () => {
        const h = harness({
            folders: ['Dynamic Action Panel', TEMPLATE_LIBRARY_FOLDER],
            files: [templateLibraryPath('Research.ocap.json')],
            readFails: 'permission denied',
        });
        const plugin = pluginOf(researchState());
        await pickFromLibrary(h, plugin, 'Research');
        expect(noticeLog.at(-1)).toBe('Import failed: permission denied');
        expect(plugin.settings.categories).toHaveLength(1);
    });

    it('reports a corrupt file through the normal import validation', async () => {
        const h = harness({
            folders: ['Dynamic Action Panel', TEMPLATE_LIBRARY_FOLDER],
        });
        const plugin = pluginOf(researchState());
        // Put a file in the folder whose content is not a template.
        await (
            h.app as { vault: { create: (p: string, c: string) => Promise<void> } }
        ).vault.create(templateLibraryPath('Broken.ocap.json'), 'not json at all');
        noticeLog.length = 0;

        await pickFromLibrary(h, plugin, 'Broken');
        expect(noticeLog.at(-1)).toBe('Import failed: the file is not valid JSON');
        expect(plugin.settings.categories).toHaveLength(1);
    });
});

// --- Opening the folder ----------------------------------------------------

describe('opening the library folder', () => {
    it('hands the folder to the OS as a file URL', async () => {
        const h = harness({ desktopAdapter: true });
        await openTemplateLibraryFolder(h.app as never);

        expect(openedUrls).toHaveLength(1);
        expect(openedUrls[0]!.target).toBe('_external');
        expect(openedUrls[0]!.url).toBe(
            'file:///vault/Dynamic%20Action%20Panel/Templates'
        );
        expect(noticeLog).toEqual([]);
    });

    it('creates the folder first, so it never opens nothing', async () => {
        const h = harness({ desktopAdapter: true });
        await openTemplateLibraryFolder(h.app as never);
        expect(h.createdFolders).toEqual([
            'Dynamic Action Panel',
            'Dynamic Action Panel/Templates',
        ]);
    });

    it('names the folder on mobile instead of opening it', async () => {
        Platform.isDesktopApp = false;
        const h = harness();
        await openTemplateLibraryFolder(h.app as never);

        expect(openedUrls).toEqual([]);
        expect(noticeLog[0]).toBe(
            'Opening a folder needs the desktop app. The templates are in Dynamic Action Panel/Templates.'
        );
        // The folder is still created, so the path the notice names is real.
        expect(h.createdFolders).toContain(TEMPLATE_LIBRARY_FOLDER);
    });

    it('refuses with a reason when the folder cannot be created', async () => {
        const h = harness({
            desktopAdapter: true,
            createFolderFails: [TEMPLATE_LIBRARY_FOLDER],
        });
        await openTemplateLibraryFolder(h.app as never);

        expect(openedUrls).toEqual([]);
        expect(noticeLog[0]).toContain('Failed to create folder');
        expect(noticeLog[0]).toContain('refused');
    });

    it('says so when the vault has no filesystem behind it', async () => {
        // Desktop flag, but an adapter that cannot produce a path.
        const h = harness();
        await openTemplateLibraryFolder(h.app as never);

        expect(openedUrls).toEqual([]);
        expect(noticeLog[0]).toBe('Could not open the template folder');
    });
});

// --- Round trip ------------------------------------------------------------

describe('a category exported into the library imports back out of it', () => {
    it('comes back with fresh ids and the same structure', async () => {
        const h = harness();
        const state = researchState();
        const plugin = pluginOf(state);

        await exportCategoryTemplate(h.app as never, plugin as never, 'c1');
        const written = h.created[0]!;
        expect(written.path).toBe(templateLibraryPath('Research.ocap.json'));
        noticeLog.length = 0;

        // Through the real picker, not around it.
        const { items } = await pickFromLibrary(h, plugin, 'Research');
        expect(items).toEqual(['Research']);

        const categories = plugin.settings.categories;
        expect(categories).toHaveLength(2);
        const imported = categories[1]!;
        // Same shape...
        expect(imported.name).toBe('Research (imported)');
        expect(imported.placements).toHaveLength(1);
        // ...different identity, in every dimension.
        expect(imported.id).not.toBe('c1');
        const importedToolId = imported.placements[0]!.toolId;
        expect(importedToolId).not.toBe('t1');
        expect(plugin.settings.tools[importedToolId]!.name).toBe('Open note');
        expect(plugin.settings.tools['t1']).toBeDefined();
    });
});
