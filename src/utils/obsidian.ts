import type { App } from 'obsidian';
import { WorkspaceLeaf } from 'obsidian';
import type { ButtonsPanelPlugin } from '@/types/plugin';

// obsidian.ts
// Obsidian workspace helpers (only the ones still in use).

/**
 * Returns the last active content leaf, excluding a given viewType (the buttons
 * panel) and accepting only markdown leaves.
 * Used to move focus back to the editor before running command or script actions,
 * so they do not execute against the panel leaf.
 *
 * @param app Obsidian app instance
 * @param excludeViewType viewType to exclude (e.g. 'buttons-panel-view')
 * @param lastActiveLeaf Currently tracked leaf (optional, preferred when valid)
 */
export function getLastActiveContentLeaf(
    app: App,
    excludeViewType: string,
    lastActiveLeaf?: WorkspaceLeaf | null
): WorkspaceLeaf | null {
    // Prefer the passed lastActiveLeaf (must be markdown and not the excluded viewType).
    if (
        lastActiveLeaf &&
        lastActiveLeaf.view &&
        typeof lastActiveLeaf.view.getViewType === 'function' &&
        lastActiveLeaf.view.getViewType() !== excludeViewType &&
        lastActiveLeaf.view.getViewType() === 'markdown'
    ) {
        return lastActiveLeaf;
    }

    // Fallback: scan all workspace leaves for the first markdown leaf that is not excludeViewType.
    const workspaceAny = app.workspace as unknown as {
        getLeavesOfType?: (type: string) => WorkspaceLeaf[];
        getLeavesOfTypeEmpty?: (type: string) => WorkspaceLeaf[];
        getLeavesOfTypeAll?: (type: string) => WorkspaceLeaf[];
    };

    const allLeaves = workspaceAny.getLeavesOfType?.('') ?? [];
    if (Array.isArray(allLeaves)) {
        for (const leaf of allLeaves) {
            if (
                leaf &&
                leaf.view &&
                typeof leaf.view.getViewType === 'function' &&
                leaf.view.getViewType() !== excludeViewType &&
                leaf.view.getViewType() === 'markdown'
            ) {
                return leaf;
            }
        }
    }

    return null;
}

/**
 * Convenience wrapper that resolves the last active content leaf while excluding
 * the buttons panel, reading the tracked leaf from the plugin instance.
 *
 * @param app Obsidian app instance
 * @param plugin Plugin instance (optional)
 * @returns WorkspaceLeaf | null
 */
export function getSafeLastContentLeaf(
    app: App,
    plugin?: ButtonsPanelPlugin
): WorkspaceLeaf | null {
    const safeLastLeaf =
        plugin?.lastActiveContentLeaf instanceof WorkspaceLeaf
            ? plugin.lastActiveContentLeaf
            : null;
    return getLastActiveContentLeaf(app, 'buttons-panel-view', safeLastLeaf);
}


