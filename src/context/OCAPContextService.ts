// OCAPContextService.ts
// Central reactive context store for the OCAP Context Engine.
//
// Responsibilities:
// - builds an initial OCAPContextSnapshot at plugin start;
// - subscribes to the relevant Obsidian events (workspace, metadataCache,
//   vault) and rebuilds the snapshot when they fire;
// - only replaces the snapshot (and notifies subscribers) when the snapshot
//   actually changed semantically (contextSnapshotsEqual), keeping React
//   re-renders minimal;
// - is deliberately NOT coupled to React: subscribers get a plain callback,
//   the React side connects via useSyncExternalStore (src/hooks/useOCAPContext.ts).
//
// Context source semantics: the context always describes the last active
// CONTENT leaf in the main workspace area. Focusing the buttons panel itself
// (or sidebar views like the file explorer) does NOT change the context —
// otherwise conditioned buttons would disappear the moment the user focuses
// the panel to click them. This mirrors the existing lastActiveContentLeaf
// behavior used for action execution.

import { TFile } from 'obsidian';
import type { App, EventRef, Events, WorkspaceLeaf } from 'obsidian';
import {
    buildContextSnapshot,
    contextSnapshotsEqual,
    EMPTY_OCAP_CONTEXT,
    type ContextFileCache,
    type OCAPContextSnapshot,
} from '@/context/OCAPContext';

/** Read the file backing a (file-based) view, if any. */
function readViewFile(view: unknown): TFile | null {
    if (!view || typeof view !== 'object') {
        return null;
    }
    const file = (view as { file?: unknown }).file;
    return file instanceof TFile ? file : null;
}

export class OCAPContextService {
    private app: App;
    private excludedViewTypes: readonly string[];
    private snapshot: OCAPContextSnapshot = EMPTY_OCAP_CONTEXT;
    private listeners = new Set<() => void>();
    /** Registered Obsidian event refs together with their emitters for cleanup. */
    private eventRefs: { emitter: Events; ref: EventRef }[] = [];
    /** The last active content leaf the context is derived from. */
    private contentLeaf: WorkspaceLeaf | null = null;
    private started = false;

    constructor(app: App, excludedViewTypes: readonly string[] = []) {
        this.app = app;
        this.excludedViewTypes = excludedViewTypes;
    }

    /** Register Obsidian events and build the initial snapshot. */
    start(): void {
        if (this.started) {
            return;
        }
        this.started = true;

        const { workspace, metadataCache, vault } = this.app;

        this.track(
            workspace,
            workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
                if (leaf && this.isContentLeaf(leaf)) {
                    this.contentLeaf = leaf;
                    this.refresh();
                }
                // Non-content leaves (buttons panel, sidebars) keep the
                // previous context on purpose.
            })
        );

        // Covers in-leaf navigation (same leaf shows another file).
        this.track(
            workspace,
            workspace.on('file-open', () => {
                this.refresh();
            })
        );

        // If the tracked content leaf disappeared (closed/detached), fall back
        // to the most recent leaf in the main area.
        this.track(
            workspace,
            workspace.on('layout-change', () => {
                if (this.contentLeaf && !this.isContentLeaf(this.contentLeaf)) {
                    this.contentLeaf = null;
                    this.adoptMostRecentLeaf();
                    this.refresh();
                }
            })
        );

        // Frontmatter/tags of the context file changed.
        this.track(
            metadataCache,
            metadataCache.on('changed', (file: TFile) => {
                if (file.path === this.snapshot.filePath) {
                    this.refresh();
                }
            })
        );

        this.track(
            vault,
            vault.on('rename', (file, oldPath: string) => {
                if (
                    oldPath === this.snapshot.filePath ||
                    file.path === this.snapshot.filePath
                ) {
                    this.refresh();
                }
            })
        );

        this.track(
            vault,
            vault.on('delete', (file) => {
                if (file.path === this.snapshot.filePath) {
                    this.refresh();
                }
            })
        );

        this.adoptMostRecentLeaf();
        this.refresh();
    }

    /** Unregister all events and drop subscribers. Safe to call repeatedly. */
    stop(): void {
        for (const { emitter, ref } of this.eventRefs) {
            emitter.offref(ref);
        }
        this.eventRefs = [];
        this.listeners.clear();
        this.contentLeaf = null;
        this.started = false;
    }

    /** Current immutable snapshot (referentially stable while unchanged). */
    getSnapshot(): OCAPContextSnapshot {
        return this.snapshot;
    }

    /** Subscribe to snapshot changes; returns the unsubscribe function. */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Rebuild the snapshot from the tracked content leaf and notify
     * subscribers if it changed semantically. Public so the plugin can
     * trigger a rebuild once the workspace layout is ready.
     */
    refresh(): void {
        if (!this.contentLeaf) {
            this.adoptMostRecentLeaf();
        }
        const view = this.contentLeaf?.view as
            | { getViewType?: () => string }
            | undefined;
        const viewType =
            view && typeof view.getViewType === 'function' ? view.getViewType() : null;
        const file = readViewFile(view);
        const cache: ContextFileCache | null = file
            ? this.app.metadataCache.getFileCache(file)
            : null;

        const next = buildContextSnapshot({
            viewType,
            filePath: file ? file.path : null,
            cache,
        });

        if (!contextSnapshotsEqual(this.snapshot, next)) {
            this.snapshot = next;
            this.notify();
        }
    }

    private track(emitter: Events, ref: EventRef): void {
        this.eventRefs.push({ emitter, ref });
    }

    private notify(): void {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch (error) {
                console.error('[OCAP] context subscriber failed:', error);
            }
        }
    }

    /** A leaf qualifies as context source if it lives in the main area and is not excluded. */
    private isContentLeaf(leaf: WorkspaceLeaf): boolean {
        const view = leaf.view as { getViewType?: () => string } | undefined;
        if (!view || typeof view.getViewType !== 'function') {
            return false;
        }
        if (this.excludedViewTypes.includes(view.getViewType())) {
            return false;
        }
        try {
            const workspace = this.app.workspace as unknown as { rootSplit?: unknown };
            const getRoot = (leaf as unknown as { getRoot?: () => unknown }).getRoot;
            if (typeof getRoot === 'function' && workspace.rootSplit !== undefined) {
                return getRoot.call(leaf) === workspace.rootSplit;
            }
        } catch {
            // Fall through: if the root cannot be determined, accept the leaf.
        }
        return true;
    }

    private adoptMostRecentLeaf(): void {
        try {
            const workspace = this.app.workspace as unknown as {
                getMostRecentLeaf?: () => WorkspaceLeaf | null;
            };
            const leaf =
                typeof workspace.getMostRecentLeaf === 'function'
                    ? workspace.getMostRecentLeaf()
                    : null;
            if (leaf && this.isContentLeaf(leaf)) {
                this.contentLeaf = leaf;
            }
        } catch {
            this.contentLeaf = null;
        }
    }
}
