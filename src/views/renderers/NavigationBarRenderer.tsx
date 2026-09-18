// NavigationBarRenderer.tsx
// Renders the panel's top navigation bar with React, while the ItemView decides where it is mounted (above view-header).
import React from 'react';
import { ButtonsPanelPlugin } from '@/types/plugin';
import { PanelConfig } from '@/types';
import { ReactRoot } from '@/utils/ReactRoot';
import { NavigationBar } from '@/components/shared/NavigationBar';
import { canMutateSettings } from '@/utils/settingsWriteGuard';

/**
 * NavigationBarRenderer
 * Finds (or creates) the .nav-header container inside the Obsidian view container
 * and renders the NavigationBar component into it through ReactRoot.
 *
 * Note:
 * - NavigationBar itself is pure React UI (see src/components/shared/NavigationBar.tsx)
 * - this renderer only inserts it into the native Obsidian DOM, as a sibling above .view-header
 */
export class NavigationBarRenderer {
    private plugin: ButtonsPanelPlugin;
    private panelConfig: PanelConfig;
    private reactRoot: ReactRoot | null = null;

    constructor(plugin: ButtonsPanelPlugin, panelConfig: PanelConfig) {
        this.plugin = plugin;
        this.panelConfig = panelConfig;
    }

    /**
     * Saves a view preference — which view, which button style, locked or edit.
     *
     * These three are deliberately allowed to change even when the loaded
     * configuration is read-only, because they are how someone LOOKS at a
     * configuration they cannot edit. The change simply is not saved, and
     * saying "changes cannot be saved" here would be the wrong message twice
     * over: the switch did work, and the one-per-session explanation would be
     * spent on the one action the design permits — leaving the next real edit
     * with no explanation at all.
     */
    private persistViewPreference(): void {
        if (!canMutateSettings(this.plugin, { silent: true })) {
            return;
        }
        void this.plugin.saveSettings();
    }

    /**
     * Creates or updates the top navigation bar component inside the Obsidian view.
     * @param containerEl Root container element of the ItemView
     * @param onRenderComplete Optional callback invoked once the render finished
     */
    createNavigationBar(containerEl: HTMLElement, onRenderComplete?: () => void): void {
        // Insert the .nav-header wrapper before .view-header.
        let actionsWrapper: HTMLElement | null = containerEl.querySelector('.nav-header');

        if (!actionsWrapper) {
            actionsWrapper = containerEl.createDiv();
            actionsWrapper.className = 'nav-header';
            const viewHeader = containerEl.querySelector('.view-header');
            if (viewHeader?.parentNode) {
                viewHeader.parentNode.insertBefore(actionsWrapper, viewHeader);
            } else {
                containerEl.prepend(actionsWrapper);
            }
        }

        const element = (
            <NavigationBar
                panelViewType={this.panelConfig.panelViewType ?? 'list'}
                displayStyle={this.panelConfig.displayStyle}
                interactionMode={this.panelConfig.interactionMode ?? 'edit'}
                showTopNavBar={this.panelConfig.showTopNavBar}
                onChangeView={(viewType) => {
                    this.panelConfig.panelViewType = viewType;
                    this.persistViewPreference();
                    activeDocument.dispatchEvent(new CustomEvent('buttons-panel-refresh'));
                }}
                onChangeStyle={(style) => {
                    this.panelConfig.displayStyle = style;
                    this.persistViewPreference();
                    activeDocument.dispatchEvent(new CustomEvent('buttons-panel-refresh'));
                }}
                onChangeInteractionMode={(mode) => {
                    this.panelConfig.interactionMode = mode;
                    this.persistViewPreference();
                    activeDocument.dispatchEvent(new CustomEvent('buttons-panel-refresh'));
                }}
                onOpenSettings={() => {
                    const pluginWithSettings = this.plugin as unknown as {
                        activateSettingsView?: () => void;
                    };
                    pluginWithSettings.activateSettingsView?.();
                }}
                onSearchChange={(query) => {
                    activeDocument.dispatchEvent(
                        new CustomEvent('buttons-panel-search', {
                            detail: { query },
                        })
                    );
                }}
            />
        );

        if (!this.reactRoot) {
            this.reactRoot = new ReactRoot();
            this.reactRoot.mount(actionsWrapper, element);
        } else {
            this.reactRoot.update(element);
        }

        if (onRenderComplete) {
            onRenderComplete();
        }
    }

    /**
     * Updates the panel configuration reference; called by ButtonsPanelView.
     * @param panelConfig New panel configuration
     */
    updatePanelConfig(panelConfig: PanelConfig): void {
        this.panelConfig = panelConfig;
    }

    /**
     * Unmounts the React root. Optional, because unmounting the Obsidian view already covers it.
     */
    destroy(): void {
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = null;
        }
    }
}


