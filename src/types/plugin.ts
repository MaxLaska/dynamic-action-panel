// plugin.ts
// Interface extension that describes the structure of the plugin main class.
import type { Plugin, SettingTab, WorkspaceLeaf } from 'obsidian';
import { ButtonsPanelPluginSettings } from '@/types';
import type { OCAPContextService } from '@/context/OCAPContextService';

/**
 * ButtonsPanelPlugin describes the plugin main class.
 * It exists for type safety at the call sites that only see the plugin instance.
 */
export interface ButtonsPanelPlugin extends Plugin {
    /** Loads the settings asynchronously (reads persisted data and merges the defaults) */
    loadSettings(): Promise<void>;

    /** Plugin settings */
    settings: ButtonsPanelPluginSettings;
    /** Settings tab instance */
	settingTab: SettingTab;

    /** Action dispatcher instance (minimal surface; the concrete shape is up to the implementation) */
    actionDispatcher: unknown;

    /** OCAP context service (reactive workspace context snapshot store) */
    contextService: OCAPContextService;

    /** Saves the settings asynchronously */
    saveSettings(): Promise<void>;

    /** Expanded state per category (runtime state, not persisted) */
    categoryOpenState: Record<string, boolean>;

    /** Id of the category active in tabs view (runtime state, not persisted) */
    activeTabCategoryId?: string | null;

	/**
	 * Tracks the last active content leaf (never the buttons panel) so focus can be
	 * restored before running command or script actions.
	 * Runtime state, not persisted.
	 */
	lastActiveContentLeaf?: WorkspaceLeaf | null;
}
