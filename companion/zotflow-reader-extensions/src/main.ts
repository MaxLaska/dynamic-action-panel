// main.ts
// ZotFlow Reader Extensions — a small companion layer for the reader ZotFlow
// embeds.
//
// What this plugin is NOT: it is not a fork of ZotFlow, not a fork of the
// Zotero reader, and not a patch of either one's shipped bundle. It reaches
// into the reader's iframe from outside, does one thing, and can be removed
// without leaving a trace. ZotFlow stays updatable.
//
// v1 does exactly one thing: the reader's existing sidebar can live on the left
// (the reader's own behaviour, untouched) or on the right, and the existing
// toggle button always lives on the same side as the sidebar.
//
// The empirical basis for every choice here, including the two traps that a
// reasonable guess gets wrong, is in
// docs/ocap/audits/2026-09-22-zotflow-reader-sidebar-side.md.

import { Menu, Plugin, type WorkspaceLeaf } from 'obsidian';
import { READER_VIEW_TYPE, missingParts } from './readerContract';
import {
    DEFAULT_SETTINGS,
    normalizeSettings,
    type ReaderExtensionSettings,
    type SidebarSide,
} from './sidebarSide';
import { applySide, bindReader, removePatch, type ReaderBinding } from './sidebarPatch';
import {
    bindOutlineDrag,
    markOutlineRowsDraggable,
    type OutlineBinding,
} from './outlineDrag';

/**
 * How long to keep looking for a reader iframe that has not loaded yet.
 *
 * The reader is a blob iframe built asynchronously, so a leaf can exist for a
 * moment before its document has a toolbar. Obsidian's layout events do not fire
 * again when that finishes, which is the one place where waiting is unavoidable.
 * It is bounded, per iframe, and stops the instant the reader appears — this is
 * not a polling loop that runs while the plugin is idle.
 */
const READY_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1600, 3000];

export default class ZotflowReaderExtensionsPlugin extends Plugin {
    settings: ReaderExtensionSettings = { ...DEFAULT_SETTINGS };

    /** One binding per live reader document; the key is the document itself. */
    private bindings = new Map<Document, ReaderBinding>();

    /** The outline drag binding of each live reader document. */
    private outlineBindings = new Map<Document, OutlineBinding>();

    /** Vault path of the document each reader shows, recorded when it is patched. */
    private readerFiles = new Map<Document, string>();

    /** Pending readiness retries, so unload can cancel them. */
    private timers = new Set<number>();

    /** Documents already reported as structurally unfamiliar, to log once. */
    private warned = new WeakSet<Document>();

    /** Documents whose outline already failed to describe a row, to log once. */
    private warnedOutline = new WeakSet<Document>();

    async onload(): Promise<void> {
        this.settings = normalizeSettings(await this.loadData());

        // Both events matter and neither is redundant: `layout-change` covers a
        // PDF opened into a new tab or split, `active-leaf-change` covers a tab
        // brought forward whose iframe was rebuilt while it was hidden.
        this.registerEvent(this.app.workspace.on('layout-change', () => this.sync()));
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.sync()));

        this.app.workspace.onLayoutReady(() => this.sync());
    }

    onunload(): void {
        for (const timer of this.timers) window.clearTimeout(timer);
        this.timers.clear();
        for (const binding of this.outlineBindings.values()) binding.disconnect();
        this.outlineBindings.clear();
        for (const [doc, binding] of this.bindings) {
            binding.disconnect();
            // Leaving our class behind would strand the sidebar on the right
            // with nothing left to move it back.
            removePatch(doc);
        }
        this.bindings.clear();
    }

    /** The side every open reader should currently be showing. */
    private currentSide = (): SidebarSide => this.settings.sidebarSide;

    async setSide(side: SidebarSide): Promise<void> {
        if (this.settings.sidebarSide === side) return;
        this.settings.sidebarSide = side;
        await this.saveData(this.settings);
        // Every reader already open follows immediately, not on next focus.
        this.sync();
    }

    /**
     * Brings every open reader into line with the current preference.
     *
     * Safe to call at any time and as often as anything likes: applying a side
     * that is already applied touches nothing, and binding a document that is
     * already bound is refused by the map.
     */
    private sync(): void {
        this.pruneDeadBindings();
        for (const leaf of this.app.workspace.getLeavesOfType(READER_VIEW_TYPE)) {
            this.syncLeaf(leaf, 0);
        }
    }

    /** Drops bindings whose reader iframe has gone away with its tab. */
    private pruneDeadBindings(): void {
        for (const [doc, binding] of this.bindings) {
            if (!doc.defaultView) {
                binding.disconnect();
                this.bindings.delete(doc);
                this.outlineBindings.get(doc)?.disconnect();
                this.outlineBindings.delete(doc);
                this.readerFiles.delete(doc);
            }
        }
    }

    private syncLeaf(leaf: WorkspaceLeaf, attempt: number): void {
        const iframe = leaf.view.containerEl.querySelector('iframe');
        const doc = iframe instanceof HTMLIFrameElement ? iframe.contentDocument : null;

        if (doc && applySide(doc, this.currentSide())) {
            // Which document this reader shows is known out here, never inside
            // the frame: the reader knows its pages, the workspace knows its
            // file. Recorded per document so a drag can name the file without
            // searching the workspace at drag time.
            const file = (leaf.view as { file?: { path?: unknown } }).file;
            if (file && typeof file.path === 'string') this.readerFiles.set(doc, file.path);
            this.ensureBound(doc);
            markOutlineRowsDraggable(doc);
            return;
        }

        // Not ready, or not the structure we know. Those look identical from
        // here, so the difference is drawn by time: a reader that never turns up
        // within the retry budget is reported once and then left alone.
        const delay = READY_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
            if (doc) this.warnStructureLost(doc);
            return;
        }
        const timer = window.setTimeout(() => {
            this.timers.delete(timer);
            this.syncLeaf(leaf, attempt + 1);
        }, delay);
        this.timers.add(timer);
    }

    /** Registers the listeners a reader document needs, exactly once. */
    private ensureBound(doc: Document): void {
        if (this.bindings.has(doc)) return;
        this.bindings.set(
            doc,
            bindReader(doc, {
                currentSide: this.currentSide,
                onToggleContextMenu: (event) => this.showSideMenu(doc, event),
                onStructureLost: () => this.warnStructureLost(doc),
                // The outline is re-rendered on every expand, collapse and tab
                // switch, so freshly rendered rows are marked from the same
                // observer instead of a second one — and never by polling.
                onReaderMutated: () => markOutlineRowsDraggable(doc),
            })
        );
        this.outlineBindings.set(
            doc,
            bindOutlineDrag(doc, {
                filePath: () => this.readerFiles.get(doc) ?? null,
                onPayloadFailed: (reason) => this.warnOutlineDrag(doc, reason),
            })
        );
    }

    /**
     * Says once, per reader document, that a section could not be described.
     *
     * Silent failure is the right behaviour for the user — the drag simply
     * carries nothing and the panel ignores it — but a reader whose outline has
     * moved out from under this plugin should say so somewhere.
     */
    private warnOutlineDrag(doc: Document, reason: string): void {
        if (this.warnedOutline.has(doc)) return;
        this.warnedOutline.add(doc);
        console.warn(
            `[ZotFlow Reader Extensions] An outline entry could not be described, ` +
                `so nothing was put on the drag: ${reason}`
        );
    }

    /**
     * Says once, per reader document, that the reader is not what we expect.
     *
     * This is the fail-soft path. ZotFlow keeps working; the sidebar simply
     * stays where the reader puts it. A log line that names the missing pieces
     * turns a future ZotFlow update from a mystery into a one-line diagnosis.
     */
    private warnStructureLost(doc: Document): void {
        if (this.warned.has(doc)) return;
        this.warned.add(doc);
        console.warn(
            '[ZotFlow Reader Extensions] The reader DOM is not the structure this ' +
                'plugin knows, so the sidebar side was left alone. Missing: ' +
                missingParts(doc).join(', ')
        );
    }

    /**
     * Opens the side menu at the toggle that was right-clicked.
     *
     * The click happens inside the reader iframe, so its coordinates are local
     * to that frame and have to be offset by the iframe's own position before an
     * Obsidian menu — which lives in the outer document — can use them.
     */
    private showSideMenu(doc: Document, event: MouseEvent): void {
        const frame = doc.defaultView?.frameElement;
        const rect = frame?.getBoundingClientRect();
        const x = (rect?.left ?? 0) + event.clientX;
        const y = (rect?.top ?? 0) + event.clientY;

        const menu = new Menu();
        const choices: Array<[SidebarSide, string]> = [
            ['left', 'Sidebar: left'],
            ['right', 'Sidebar: right'],
        ];
        for (const [side, title] of choices) {
            menu.addItem((item) =>
                item
                    .setTitle(title)
                    .setChecked(this.settings.sidebarSide === side)
                    .onClick(() => {
                        void this.setSide(side);
                    })
            );
        }
        menu.showAtPosition({ x, y });
    }
}
