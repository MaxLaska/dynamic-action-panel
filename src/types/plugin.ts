// plugin.ts
// Interface extension that describes the structure of the plugin main class.
import type { Plugin, SettingTab, WorkspaceLeaf } from 'obsidian';
import { ButtonsPanelPluginSettings } from '@/types';
import type { WorkspaceContextService } from '@/context/WorkspaceContextService';

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

    /** Workspace context service (reactive workspace context snapshot store) */
    contextService: WorkspaceContextService;

    /** Saves the settings asynchronously */
    saveSettings(): Promise<void>;

    /**
     * Set while the loaded `data.json` uses a schema version newer than this
     * build understands, in which case the settings are read-only and nothing
     * may be written over them. See src/utils/settingsWriteGuard.ts.
     *
     * Deliberately per-instance runtime state, re-derived on every load: the
     * protection belongs to the file that is open, not to the session, so a
     * reload or a downgraded file lifts it without anything to reset by hand.
     */
    futureSettings?: { storedVersion: number | null; supportedVersion: number } | null;

    /** Whether the user has already been told that a change could not be saved. */
    settingsWriteRefusalNotified?: boolean;

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
