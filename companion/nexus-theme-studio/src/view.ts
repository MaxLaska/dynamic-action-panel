// view.ts
// Nexus Theme Studio as a workspace view.
//
// WHY A VIEW. The studio started as a settings tab, and a settings tab is a
// modal over the workspace — the one arrangement a design tool cannot work in.
// You could not see the dock you were colouring, and the pipette could not
// sample it. A view lives IN the workspace: in the right dock beside the
// reader, in a split beside a note, as a tab of its own, or in a window of its
// own. Obsidian already knows how to do every one of those — drag, split,
// stack, pop out, remember where it was — so the studio does none of it itself.
// No floating frame, no docking logic, no window of its own.
//
// This file is deliberately thin. The panel (studioPanel.ts) is the surface;
// this class only connects it to a leaf's lifecycle and to the Obsidian UI
// services the panel asks for by interface — a menu, a modal, a notice.

import { ItemView, Menu, Notice, type WorkspaceLeaf } from 'obsidian';

import { TransferModal, promptForName } from './modals';
import type { NexusStudioSettings } from './profiles';
import { StudioPanel, type StudioPanelHost } from './studioPanel';

/** The view type. Stable: it is what Obsidian writes into workspace.json. */
export const NEXUS_STUDIO_VIEW_TYPE = 'nexus-theme-studio';

/** The tab title. */
export const NEXUS_STUDIO_TITLE = 'Nexus Theme Studio';

/** The tab icon — a Lucide name Obsidian ships. */
export const NEXUS_STUDIO_ICON = 'palette';

/**
 * What the view needs from the plugin.
 *
 * An interface rather than the plugin class, so this file does not import the
 * plugin and the plugin holds no reference to any view — views are found
 * through the workspace when they need telling something, which is what keeps
 * a closed view from being kept alive by the plugin.
 */
export interface StudioServices {
    readonly settings: NexusStudioSettings;
    themeIsActive(): boolean | null;
    update(next: NexusStudioSettings): Promise<void>;
    updateLive(next: NexusStudioSettings): void;
    updateUi(next: NexusStudioSettings): Promise<void>;
    setPreview(variables: readonly string[]): void;
    setSessionValue(key: string, value: string | null): void;
    sessionValue(key: string): string | undefined;
}

export class NexusStudioView extends ItemView {
    private panel: StudioPanel | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly services: StudioServices
    ) {
        super(leaf);
    }

    getViewType(): string {
        return NEXUS_STUDIO_VIEW_TYPE;
    }

    getDisplayText(): string {
        return NEXUS_STUDIO_TITLE;
    }

    getIcon(): string {
        return NEXUS_STUDIO_ICON;
    }

    protected async onOpen(): Promise<void> {
        // A view can be opened again on the same instance (Obsidian reuses a
        // leaf's view across some layout operations), so a previous panel is
        // taken down before a new one is built — never two on one element.
        this.panel?.dispose();
        this.contentEl.replaceChildren();
        this.panel = new StudioPanel(this.contentEl, this.panelHost());
        this.panel.render();
        return Promise.resolve();
    }

    protected async onClose(): Promise<void> {
        // Closing the tab, detaching the leaf, and the plugin unloading all end
        // here. The panel disposes its rows — cancelling any locator waiting on
        // its 200ms delay — and clears a preview that is already showing, so no
        // surface is left magenta by a hover that has no row left to end it.
        this.panel?.dispose();
        this.panel = null;
        this.services.setPreview([]);
        return Promise.resolve();
    }

    /** Rebuilds the panel from the current settings. */
    refresh(): void {
        this.panel?.render();
    }

    /** Re-reads the current settings into the controls already on screen. */
    sync(): void {
        this.panel?.sync();
    }

    /** Applies the stored fold state to the groups already on screen. */
    syncCollapse(): void {
        this.panel?.syncCollapse();
    }

    /** Re-checks whether Nexus is the selected theme, and says so if not. */
    syncThemeState(): void {
        this.panel?.syncThemeState();
    }

    private panelHost(): StudioPanelHost {
        const services = this.services;
        return {
            settings: () => services.settings,
            themeIsActive: () => services.themeIsActive(),
            update: (next) => services.update(next),
            updateLive: (next) => services.updateLive(next),
            updateUi: (next) => services.updateUi(next),
            setPreview: (variables) => services.setPreview(variables),
            setSessionValue: (key, value) => services.setSessionValue(key, value),
            sessionValue: (key) => services.sessionValue(key),
            promptName: (title, initial) => promptForName(this.app, title, initial),
            openTransfer: (mode, profile, onImport) => {
                new TransferModal(this.app, mode, profile, onImport).open();
            },
            showMenu: (evt, actions) => {
                // A NATIVE menu, drawn by the operating system: the one kind of
                // menu no theme token can reach. The studio's own controls must
                // stay usable whatever the theme being edited does to Obsidian's
                // text and surfaces — see styles.css, "the control plane".
                const menu = new Menu().setUseNativeMenu(true);
                for (const action of actions) {
                    menu.addItem((item) =>
                        item
                            .setTitle(action.title)
                            .setIcon(action.icon)
                            .setDisabled(action.disabled)
                            .onClick(() => action.run())
                    );
                }
                menu.showAtMouseEvent(evt);
            },
            notify: (message) => {
                new Notice(message);
            },
        };
    }
}
