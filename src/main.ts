// main.ts
// Main entry point of the plugin: initialization, activation and teardown.
// Holds ButtonsPanelPlugin, which registers the views, commands and the settings tab.
//
// Contents:
// - ButtonsPanelPlugin: the plugin main class
// - the onload and onunload lifecycle methods
// - plugin initialization, resource registration and event listeners
// - settings loading through the migration pipeline, and settings persistence
//
import { Plugin, WorkspaceLeaf, TFile, Notice, normalizePath } from 'obsidian';
import { ButtonsPanelView } from '@/views/ButtonsPanelView';
import { ButtonsPanelSettingTab } from '@/settings/ButtonsPanelSettingTab';
import {
    ButtonsPanelPluginSettings,
} from '@/types';
import type { ButtonsPanelPlugin as ButtonsPanelPluginType } from '@/types';
import { migrateSettings } from '@/settings/settingsMigrations';
import { OCAPContextService } from '@/context/OCAPContextService';
import { t, tWithParams } from '@/utils/i18n';
import { pickAndImportTemplate } from '@/export/templateIo';

// View type constant
export const BUTTONS_PANEL_VIEW_TYPE = 'buttons-panel-view';

/**
 * Plugin main class, extending Obsidian's Plugin.
 * Handles initialization, view and command registration and the settings.
 */
export default class ButtonsPanelPlugin extends Plugin {
    /** Persisted plugin settings */
    settings!: ButtonsPanelPluginSettings;
    /** Settings tab instance */
    settingTab!: ButtonsPanelSettingTab;
    /** Action dispatcher instance */
	actionDispatcher!: ButtonsPanelPluginType['actionDispatcher'];
    /** OCAP context service (reactive workspace context snapshot store) */
    contextService!: OCAPContextService;
    /** Last active content leaf (never the buttons panel) */
    lastActiveContentLeaf: WorkspaceLeaf | null = null;
    /** Expanded state per category (runtime state, not persisted) */
    categoryOpenState: Record<string, boolean> = {};
    /** Id of the category active in tabs view (runtime state, not persisted) */
    activeTabCategoryId: string | null = null;

    /**
     * Called when the plugin loads; registers the view, the commands and the settings tab.
     */
    async onload() {
        await this.loadSettings();
        this.actionDispatcher = new (await import('./services/ActionDispatcher')).ActionDispatcher(
            this.app,
            this
        );

        // OCAP context service: subscribes to workspace/metadata events and
        // provides the reactive context snapshot used for button conditions.
        this.contextService = new OCAPContextService(this.app, [BUTTONS_PANEL_VIEW_TYPE]);
        this.contextService.start();

        // Register the buttons panel view.
        this.registerView(
            BUTTONS_PANEL_VIEW_TYPE,
            (leaf: WorkspaceLeaf) =>
                new ButtonsPanelView(leaf, this, this.settings.categories, this.settings.panelConfig)
        );

        // Command: open the buttons panel.
        this.addCommand({
            id: 'open-panel',
            name: t('open_panel'),
            callback: () => {
                void this.activateView();
            },
        });

        // Command: open the buttons panel settings.
        this.addCommand({
            id: 'open-options',
            name: t('open_options'),
            callback: () => {
                void this.activateSettingsView();
            },
        });

        // Import a portable panel template. A command, because an EMPTY panel
        // has no category context menu to offer it from.
        this.addCommand({
            id: 'import-template',
            name: t('category_import_template'),
            callback: () => {
                pickAndImportTemplate(this.app, this);
            },
        });

        // Ribbon icon that opens the buttons panel.
        this.addRibbonIcon('mouse', t('open_panel'), () => {
            void this.activateView();
        });

        // Register the settings tab in the Obsidian settings.
        this.settingTab = new ButtonsPanelSettingTab(this.app, this);
        this.addSettingTab(this.settingTab);

        this.app.workspace.onLayoutReady(() => {
            void registerScriptCommands(this);
            // The workspace layout (and thus the active content leaf) is only
            // reliable now; rebuild the initial context snapshot.
            this.contextService.refresh();
        });

        // Track leaf changes to remember the last active content leaf (never the buttons panel).
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
                if (
                    leaf &&
                    leaf.view &&
                    !(leaf.view instanceof ButtonsPanelView) // exclude the buttons panel
                ) {
                    this.lastActiveContentLeaf = leaf;
                }
            })
        );
    }

    /**
     * Called when the plugin unloads.
     */
    onunload() {
        this.contextService?.stop();
    }

    /**
     * Loads the plugin settings: migrates and normalizes the persisted data through the
     * settingsVersion pipeline (src/settings/settingsMigrations.ts) and persists the result once.
     */
    async loadSettings() {
        const rawData: unknown = await this.loadData();
        const result = migrateSettings(rawData);
        this.settings = result.settings;

        if (result.status === 'future') {
            console.warn(
                `[OCAP] Stored settings use a newer schema version (${result.fromVersion}) ` +
                    'than this plugin build supports; loading best-effort without rewriting them.'
            );
        } else if (result.changed) {
            // Persist the migrated data once so the migration does not rerun
            // on every load. Intentionally saveData (not saveSettings) to
            // avoid re-render side effects during load.
            await this.saveData(this.settings);
        }
    }

    /**
     * Persists the plugin settings.
     *
     * Persisting must not silently mutate the domain objects: the historical
     * in-place `order` sort that lived here is gone. Ordering is now
     * guaranteed at the two right places instead — loading normalizes any
     * legacy out-of-order arrays in memory (see normalizeSettings in
     * settingsMigrations.ts), and every write path keeps `order` consistent
     * with the array order it writes.
     */
    async saveSettings() {
        try {
            await this.saveData(this.settings);
            this.updatePanels();
        } catch (error) {
            console.error('Error while saving the settings:', error);
        }
    }

    /**
     * Pushes the current settings into every open buttons panel view.
     */
    updatePanels() {
        this.app.workspace.getLeavesOfType(BUTTONS_PANEL_VIEW_TYPE).forEach((leaf) => {
            if (leaf.view instanceof ButtonsPanelView) {
                leaf.view.updateCategories(this.settings.categories);
                leaf.view.updatePanelConfig(this.settings.panelConfig);
            }
        });
    }

    /**
     * Activates the buttons panel view in the right sidebar, creating it when needed.
     * An existing view is revealed instead of opening a second one.
     */
    private async activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(BUTTONS_PANEL_VIEW_TYPE);

        if (leaves.length > 0) {
            // The panel already exists, so just reveal it.
            leaf = leaves[0]!;
        } else {
            // Otherwise create it in the right sidebar.
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({
                    type: BUTTONS_PANEL_VIEW_TYPE,
                    active: true,
                });
            }
        }

        if (leaf) {
            // Deliberately ignore the promise so the caller is not blocked.
            void workspace.revealLeaf(leaf);
        }
    }

    /**
     * Opens the Obsidian settings and navigates to this plugin's tab
     */
    private async activateSettingsView() {
        const appAny = this.app as unknown as {
            setting?: {
                open: () => void;
                // API available since Obsidian 1.4; typed loosely because it is not in the public typings.
                openTabById?: (id: string) => void;
            };
        };

        const setting = appAny.setting;
        if (!setting) return;

        // Open the settings dialog.
        setting.open();

        // Try to navigate straight to this plugin's tab.
        if (typeof setting.openTabById === 'function') {
            setting.openTabById(this.manifest.id);
        }
    }
}

// Registers the script commands during plugin initialization.
async function registerScriptCommands(plugin: ButtonsPanelPluginType) {
    let scriptFolder = plugin.settings.pathConfig?.scriptFolderPath;
    if (!scriptFolder) {
        return;
    }
    // Normalize the path.
    scriptFolder = normalizePath(scriptFolder);
    const allFiles = plugin.app.vault.getFiles();

    const files = allFiles.filter((f: TFile) => {
        return f.path.startsWith(scriptFolder + '/') && f.extension === 'js';
    });
    for (const file of files) {
        plugin.addCommand({
            id: `run-script:${file.name}`,
            name: tWithParams('script_command', { scriptName: file.name }),
            callback: async () => {
                try {
                    const dispatcher = plugin.actionDispatcher as {
                        scriptService?: { runScript: (action: unknown) => Promise<void> };
                    } | undefined;
                    await dispatcher?.scriptService?.runScript({
                        type: 'script',
                        parameters: { scriptName: file.name },
                    });
                } catch (e) {
                    const errorMessage = e instanceof Error ? e.message : String(e);
                    new Notice(t('script_run_failed') + `：${errorMessage}`);
                }
            },
        });
    }
}
