// ButtonsPanelView.tsx
// Defines ButtonsPanelView, the main view of the buttons panel.
// It renders the panel, owns its interaction state and coordinates the individual components.
//
// Contents:
// - ButtonsPanelView: the main view class, extending Obsidian's ItemView
// - constructor and lifecycle methods (onOpen/onClose)
// - view rendering plus the button, panel config and move mode logic
// - the materialization boundary between stored and runtime shapes

import React from 'react';
import { ItemView, WorkspaceLeaf, debounce } from 'obsidian';
import { ButtonsPanelPlugin, CategoryConfig, PanelConfig } from '@/types';
import type { StoredCategory } from '@/types/settings';
import { materializeCategoriesForRuntime } from '@/domain/tools';
import { t } from '@/utils/i18n';
import { NavigationBarRenderer } from '@/views/renderers/NavigationBarRenderer';
import { ReactRoot } from '@/utils/ReactRoot';
import { ButtonsPanelApp } from '@/components/buttons-panel/ButtonsPanelApp';

/**
 * Main view class of the buttons panel.
 * Renders the panel and owns its interaction, display, move and category state.
 * The concrete UI is composed from the individual panel components.
 */
export class ButtonsPanelView extends ItemView {
    /** Categories of this panel (stored shape; the render path materializes views) */
    private categories: StoredCategory[] = [];
    /** Display settings of the panel */
    private panelConfig: PanelConfig;
    /** Search query from the navigation bar (in-memory only, never persisted) */
    private searchQuery: string = '';
    /** Plugin instance */
    private plugin: ButtonsPanelPlugin;
    // React root manager, which replaced the former DOM renderer.
    private reactRoot: ReactRoot | null = null;
    /** Handle of the refresh event listener */
    private handleRefreshEvent: (() => void) | null = null;
    /** Debounced render function, using the Obsidian debounce helper */
    private debouncedRender: () => void;
    /** Renderer of the top navigation bar, mounted as a sibling of the Obsidian view-header */
    private navigationBarRenderer: NavigationBarRenderer | null = null;

    /**
     * Initializes the view and its components
     * @param leaf Obsidian workspace leaf
     * @param plugin Plugin instance
     * @param categories Category configuration
     * @param panelConfig Panel configuration
     */
    constructor(
        leaf: WorkspaceLeaf,
        plugin: ButtonsPanelPlugin,
        categories: StoredCategory[],
        panelConfig: PanelConfig
    ) {
        super(leaf);
        this.plugin = plugin;
        this.categories = categories;
        this.panelConfig = panelConfig;
        // Debounced render, which in React mode mainly triggers a remount.
        this.debouncedRender = debounce(() => {
            this.renderPanel();
        }, 100, true);
        // Navigation bar renderer, mounted above the Obsidian view-header rather than inside view-content.
        this.navigationBarRenderer = new NavigationBarRenderer(this.plugin, this.panelConfig);

        // Style class of the main container.
        this.containerEl.addClass('buttons-panel');
        // Make the container focusable.
        this.containerEl.setAttribute('tabindex', '-1');
    }

    /**
     * Registers the listeners for the custom panel events
     */
    private setupEventListeners(): void {
        // Refresh event: render directly rather than debounced, to avoid async ordering problems.
        this.handleRefreshEvent = () => {
            this.renderPanel();
        };
        // Register the custom DOM events through the view's registerDomEvent.
        this.registerDomEvent(activeDocument, 'buttons-panel-refresh', this.handleRefreshEvent);

        // Search events coming from the navigation bar.
        this.registerDomEvent(
            activeDocument,
            'buttons-panel-search',
            (event: Event) => {
                const customEvent = event as CustomEvent<{ query?: string }>;
                this.searchQuery = customEvent.detail?.query ?? '';
                this.debouncedRender();
            }
        );
    }

    /**
     * Returns the view type string Obsidian identifies this view by
     * @returns The view type string
     */
    getViewType(): string {
        return 'buttons-panel-view';
    }

    /**
     * Returns the view icon shown in the sidebar
     * @returns The icon name
     */
    getIcon(): string {
        // return 'layout-grid';
        return 'mouse';
    }

    /**
     * Returns the display name of the view shown in its header
     * @returns The localized view name
     */
    getDisplayText(): string {
        return t('buttons_panel');
    }

    /**
     * Called when the view opens; renders the buttons panel
     * @returns Promise<void>
     */
    async onOpen(): Promise<void> {
        // Reload the settings from disk on every open, so configuration synced by
        // Obsidian Sync or changed on another device takes effect.
        try {
            await this.plugin.loadSettings();
            this.categories = this.plugin.settings.categories;
            this.panelConfig = this.plugin.settings.panelConfig;
        } catch (error) {
            console.warn('Error while loading the latest buttons panel settings; falling back to the in-memory configuration:', error);
        }

        // Sync the panelConfig reference of the NavigationBarRenderer, otherwise a
        // stale reference after loadSettings would make the first menu click a no-op.
        this.navigationBarRenderer?.updatePanelConfig(this.panelConfig);

        // Mount React, which owns only the panel content inside view-content.
        this.reactRoot = new ReactRoot();
        const container = this.contentEl;
        container.empty();
        // Add a dedicated style class to the Obsidian view-content so its padding can be controlled separately.
        container.addClass('buttons-panel');
        this.reactRoot.mount(container, this.createAppElement());

        // Render the top action bar above the Obsidian view-header (view switch, style switch, edit mode, settings).
        this.navigationBarRenderer?.createNavigationBar(this.containerEl);

        // Keep the refresh event listener; it can be bridged into React later.
        this.setupEventListeners();
    }

    /**
     * Called when the view closes; releases its resources
     * @returns Promise<void>
     */
    async onClose(): Promise<void> {
        // Unmount the React app and clear the container.
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = null;
        } else {
            this.containerEl.empty();
        }
        // The event listeners are cleaned up by the plugin's own registration system.
    }

    /**
     * Replaces the category data and re-renders
     * @param categories New category configuration
     */
    updateCategories(categories: StoredCategory[]): void {
        try {
            // Guard against a non-array argument.
            this.categories = Array.isArray(categories) ? categories : [];
            this.debouncedRender();
        } catch (error) {
            console.error('Error while updating the category data:', error);
            // If the update failed, try a full remount.
            if (this.reactRoot && this.contentEl) {
                try {
                    this.reactRoot.unmount();
                    this.reactRoot = new ReactRoot();
                    this.reactRoot.mount(this.contentEl, this.createAppElement());
                } catch (remountError) {
                    console.error('Error while remounting:', remountError);
                }
            }
        }
    }

    /**
     * Syncs the in-memory category and panel configuration from the plugin settings
     */
    private syncDataFromPlugin(): void {
        this.categories = this.plugin.settings.categories;
        this.panelConfig = this.plugin.settings.panelConfig;
    }

    /**
     * Category list used for rendering — THE materialization boundary of the v5
     * model: the React tree consumes CategoryConfig view copies (buttons
     * joined from placements + the tool registry), while every write path
     * resolves the stored category by id through findStoredCategory. An
     * unchanged stored category with an unchanged registry keeps its view
     * identity (memoized in src/domain/tools.ts), so memoized subtrees stay
     * stable across unrelated commits.
     */
    private getCategoriesForRender(): CategoryConfig[] {
        this.syncDataFromPlugin();
        return materializeCategoriesForRuntime(
            this.plugin.settings.categories,
            this.plugin.settings.tools
        );
    }

    private createAppElement(): React.ReactElement {
        return (
            <ButtonsPanelApp
                plugin={this.plugin}
                app={this.app}
                categories={this.getCategoriesForRender()}
                panelConfig={this.panelConfig}
                searchQuery={this.searchQuery}
            />
        );
    }

    /**
     * Replaces the panel settings and re-renders
     * @param config New panel configuration
     */
    updatePanelConfig(config: PanelConfig): void {
        try {
            this.panelConfig = config;
            // Update the top action bar config as well and re-render, keeping it in sync with the content area.
            if (this.navigationBarRenderer) {
                this.navigationBarRenderer.updatePanelConfig(this.panelConfig);
                this.navigationBarRenderer.createNavigationBar(this.containerEl);
            }
            this.debouncedRender();
        } catch (error) {
            console.warn('Error while updating the panel settings:', error);
        }
    }

    /**
     * Renders the panel through the React root component
     */
    public renderPanel(): void {
        // In React mode renderPanel mainly triggers an update of the root component.
        if (!this.reactRoot) {
            // Without a reactRoot, try to initialize it again.
            if (this.contentEl) {
                try {
                    this.reactRoot = new ReactRoot();
                    this.reactRoot.mount(this.contentEl, this.createAppElement());
                } catch (error) {
                    console.error('Error while reinitializing the ReactRoot:', error);
                }
            }
            return;
        }

        try {
            this.reactRoot.update(this.createAppElement());
        } catch (error) {
            console.error('Error while updating the React component:', error);
            // If the update failed, try a full remount.
            if (this.contentEl) {
                try {
                    this.reactRoot.unmount();
                    this.reactRoot = new ReactRoot();
                    this.reactRoot.mount(this.contentEl, this.createAppElement());
                } catch (remountError) {
                    console.error('Error while remounting:', remountError);
                }
            }
        }
    }

}


