import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { OCAPContextService } from '@/context/OCAPContextService';
import { EMPTY_OCAP_CONTEXT } from '@/context/OCAPContext';

// ---------------------------------------------------------------------------
// Minimal fake of the Obsidian event/workspace surface used by the service.
// ---------------------------------------------------------------------------

type Handler = (...args: unknown[]) => void;

class FakeEmitter {
    private handlers = new Map<string, Set<Handler>>();
    offrefCalls = 0;

    on(name: string, handler: Handler): { name: string; handler: Handler } {
        if (!this.handlers.has(name)) {
            this.handlers.set(name, new Set());
        }
        this.handlers.get(name)!.add(handler);
        return { name, handler };
    }

    offref(ref: { name: string; handler: Handler }): void {
        this.offrefCalls += 1;
        this.handlers.get(ref.name)?.delete(ref.handler);
    }

    trigger(name: string, ...args: unknown[]): void {
        for (const handler of [...(this.handlers.get(name) ?? [])]) {
            handler(...args);
        }
    }

    handlerCount(): number {
        let count = 0;
        for (const set of this.handlers.values()) {
            count += set.size;
        }
        return count;
    }
}

// The service narrows view files via `instanceof TFile`, so the fakes must
// produce real (mock) TFile instances.
type FakeFile = TFile;

function makeFile(path: string): FakeFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() ?? path;
    file.extension = file.name.includes('.') ? (file.name.split('.').pop() ?? '') : '';
    return file;
}

interface FakeCache {
    frontmatter?: Record<string, unknown>;
    tags?: { tag: string }[];
}

class FakeWorkspace extends FakeEmitter {
    rootSplit = { kind: 'root' };
    mostRecentLeaf: FakeLeaf | null = null;

    getMostRecentLeaf(): FakeLeaf | null {
        return this.mostRecentLeaf;
    }
}

class FakeLeaf {
    view: { getViewType: () => string; file?: FakeFile | null };
    private root: unknown;

    constructor(workspace: FakeWorkspace, viewType: string, file: FakeFile | null) {
        this.view = { getViewType: () => viewType, file };
        this.root = workspace.rootSplit;
    }

    getRoot(): unknown {
        return this.root;
    }

    detach(): void {
        this.root = { kind: 'detached' };
    }
}

function makeFakeApp() {
    const workspace = new FakeWorkspace();
    const metadataCache = new FakeEmitter() as FakeEmitter & {
        getFileCache: (file: FakeFile) => FakeCache | null;
    };
    const caches = new Map<string, FakeCache>();
    metadataCache.getFileCache = (file: FakeFile) => caches.get(file.path) ?? null;
    const vault = new FakeEmitter();

    const app = { workspace, metadataCache, vault } as unknown as App;
    return { app, workspace, metadataCache, vault, caches };
}

const PANEL_VIEW_TYPE = 'buttons-panel-view';

function makeService(app: App): OCAPContextService {
    return new OCAPContextService(app, [PANEL_VIEW_TYPE]);
}

// ---------------------------------------------------------------------------

describe('OCAPContextService', () => {
    it('starts with the empty context when no leaf is active', () => {
        const { app } = makeFakeApp();
        const service = makeService(app);
        service.start();
        expect(service.getSnapshot()).toEqual(EMPTY_OCAP_CONTEXT);
        service.stop();
    });

    it('builds the initial snapshot from the most recent content leaf', () => {
        const { app, workspace, caches } = makeFakeApp();
        caches.set('a/b.md', { frontmatter: { status: 'open' }, tags: [{ tag: '#t' }] });
        workspace.mostRecentLeaf = new FakeLeaf(workspace, 'markdown', makeFile('a/b.md'));

        const service = makeService(app);
        service.start();

        const snapshot = service.getSnapshot();
        expect(snapshot.viewType).toBe('markdown');
        expect(snapshot.filePath).toBe('a/b.md');
        expect(snapshot.tags).toEqual(['t']);
        expect(snapshot.properties).toEqual({ status: 'open' });
        service.stop();
    });

    it('updates the snapshot on active-leaf-change and notifies subscribers', () => {
        const { app, workspace } = makeFakeApp();
        const service = makeService(app);
        service.start();

        let notified = 0;
        service.subscribe(() => {
            notified += 1;
        });

        const leaf = new FakeLeaf(workspace, 'markdown', makeFile('x/y.md'));
        workspace.trigger('active-leaf-change', leaf);

        expect(notified).toBe(1);
        expect(service.getSnapshot().filePath).toBe('x/y.md');
        service.stop();
    });

    it('ignores the buttons panel leaf and keeps the previous context', () => {
        const { app, workspace } = makeFakeApp();
        const service = makeService(app);
        service.start();

        const contentLeaf = new FakeLeaf(workspace, 'markdown', makeFile('x/y.md'));
        workspace.trigger('active-leaf-change', contentLeaf);
        const before = service.getSnapshot();

        const panelLeaf = new FakeLeaf(workspace, PANEL_VIEW_TYPE, null);
        workspace.trigger('active-leaf-change', panelLeaf);

        expect(service.getSnapshot()).toBe(before);
        expect(service.getSnapshot().viewType).toBe('markdown');
        service.stop();
    });

    it('ignores leaves outside the root split (sidebars)', () => {
        const { app, workspace } = makeFakeApp();
        const service = makeService(app);
        service.start();

        const contentLeaf = new FakeLeaf(workspace, 'markdown', makeFile('x/y.md'));
        workspace.trigger('active-leaf-change', contentLeaf);

        const sidebarLeaf = new FakeLeaf(workspace, 'file-explorer', null);
        sidebarLeaf.detach();
        workspace.trigger('active-leaf-change', sidebarLeaf);

        expect(service.getSnapshot().viewType).toBe('markdown');
        service.stop();
    });

    it('does not emit a new snapshot when nothing semantically changed', () => {
        const { app, workspace } = makeFakeApp();
        const service = makeService(app);
        service.start();

        const leaf = new FakeLeaf(workspace, 'markdown', makeFile('x/y.md'));
        workspace.trigger('active-leaf-change', leaf);
        const before = service.getSnapshot();

        let notified = 0;
        service.subscribe(() => {
            notified += 1;
        });

        // file-open with unchanged state must be a no-op.
        workspace.trigger('file-open', makeFile('x/y.md'));
        expect(notified).toBe(0);
        expect(service.getSnapshot()).toBe(before);
        service.stop();
    });

    it('reacts to metadata changes of the context file only', () => {
        const { app, workspace, metadataCache, caches } = makeFakeApp();
        const service = makeService(app);
        service.start();

        const file = makeFile('x/y.md');
        const leaf = new FakeLeaf(workspace, 'markdown', file);
        workspace.trigger('active-leaf-change', leaf);

        let notified = 0;
        service.subscribe(() => {
            notified += 1;
        });

        // Unrelated file: no notification.
        metadataCache.trigger('changed', makeFile('other.md'));
        expect(notified).toBe(0);

        // Context file gains a tag: snapshot updates.
        caches.set('x/y.md', { tags: [{ tag: '#new' }] });
        metadataCache.trigger('changed', file);
        expect(notified).toBe(1);
        expect(service.getSnapshot().tags).toEqual(['new']);
        service.stop();
    });

    it('reacts to renames of the context file', () => {
        const { app, workspace, vault } = makeFakeApp();
        const service = makeService(app);
        service.start();

        const file = makeFile('x/y.md');
        const leaf = new FakeLeaf(workspace, 'markdown', file);
        workspace.trigger('active-leaf-change', leaf);

        // Simulate the rename mutating the leaf's file (as Obsidian does).
        const renamed = makeFile('x/z.md');
        leaf.view.file = renamed;
        vault.trigger('rename', renamed, 'x/y.md');

        expect(service.getSnapshot().filePath).toBe('x/z.md');
        expect(service.getSnapshot().fileBaseName).toBe('z');
        service.stop();
    });

    it('falls back to the most recent leaf when the tracked leaf is detached', () => {
        const { app, workspace } = makeFakeApp();
        const service = makeService(app);
        service.start();

        const leaf = new FakeLeaf(workspace, 'markdown', makeFile('x/y.md'));
        workspace.trigger('active-leaf-change', leaf);

        const fallback = new FakeLeaf(workspace, 'pdf', makeFile('p/doc.pdf'));
        workspace.mostRecentLeaf = fallback;
        leaf.detach();
        workspace.trigger('layout-change');

        expect(service.getSnapshot().viewType).toBe('pdf');
        expect(service.getSnapshot().filePath).toBe('p/doc.pdf');
        service.stop();
    });

    it('supports unsubscribe', () => {
        const { app, workspace } = makeFakeApp();
        const service = makeService(app);
        service.start();

        let notified = 0;
        const unsubscribe = service.subscribe(() => {
            notified += 1;
        });
        unsubscribe();

        workspace.trigger(
            'active-leaf-change',
            new FakeLeaf(workspace, 'markdown', makeFile('a.md'))
        );
        expect(notified).toBe(0);
        service.stop();
    });

    it('stop() unregisters every event handler', () => {
        const { app, workspace, metadataCache, vault } = makeFakeApp();
        const service = makeService(app);
        service.start();

        const total =
            workspace.handlerCount() + metadataCache.handlerCount() + vault.handlerCount();
        expect(total).toBeGreaterThan(0);

        service.stop();
        expect(
            workspace.handlerCount() + metadataCache.handlerCount() + vault.handlerCount()
        ).toBe(0);
        expect(
            workspace.offrefCalls + metadataCache.offrefCalls + vault.offrefCalls
        ).toBe(total);
    });
});
