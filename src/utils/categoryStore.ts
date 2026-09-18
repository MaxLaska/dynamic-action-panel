// categoryStore.ts
// Small bridge between the rendering tree and the persisted settings — and,
// since Phase 0, THE commit funnel every write path ends in.
//
// A category object handed to a renderer is never the stored one since v5:
// the runtime consumes materialized view copies (see src/domain/tools.ts).
// Every write path (modals, menus, hooks) therefore has to look the stored
// category up by id before mutating, otherwise the edit lands in a throwaway
// object.
//
// All three commit funnels ask `canMutateSettings` BEFORE touching anything.
// Refusing the mutation rather than only the save is deliberate: a settings
// object edited in memory but never written would show the user a panel their
// configuration does not have, right up until the next reload silently undid
// it. Each returns whether it committed, so a caller cannot report success for
// something that did not happen.

import type { StoredCategory } from '@/types/settings';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import type { ToolState } from '@/domain/categoryOps';
import { canMutateSettings } from '@/utils/settingsWriteGuard';

/** The persisted category with this id, or null when it no longer exists. */
export function findStoredCategory(
    plugin: ButtonsPanelPlugin,
    categoryId: string
): StoredCategory | null {
    return plugin.settings.categories.find((category) => category.id === categoryId) ?? null;
}

/**
 * Replace a stored category with a new object (identity convention from
 * DECISIONS.md: changed content means a changed identity). Returns false when
 * the category has disappeared in the meantime.
 */
export function replaceStoredCategory(
    plugin: ButtonsPanelPlugin,
    next: StoredCategory
): boolean {
    const categories = plugin.settings.categories;
    const index = categories.findIndex((category) => category.id === next.id);
    if (index === -1) {
        return false;
    }
    categories[index] = next;
    return true;
}

/** Fires the panel re-render every commit ends with. */
export function dispatchPanelRefresh(): void {
    activeDocument.dispatchEvent(new CustomEvent('buttons-panel-refresh'));
}

/**
 * THE commit funnel for category edits: replace the stored category, persist,
 * re-render. Every write path used to repeat this find→replace→save→refresh
 * sequence with small variations; new domain operations hang off this one
 * point instead. Returns false (and does nothing) when the category has
 * disappeared in the meantime.
 */
export async function commitStoredCategory(
    plugin: ButtonsPanelPlugin,
    next: StoredCategory
): Promise<boolean> {
    if (!canMutateSettings(plugin)) {
        return false;
    }
    if (!replaceStoredCategory(plugin, next)) {
        return false;
    }
    await plugin.saveSettings();
    dispatchPanelRefresh();
    return true;
}

/**
 * Commit funnel for whole-array changes (reorder, add, delete of categories).
 * The new array replaces the old one — never mutate the existing objects.
 */
export async function commitCategories(
    plugin: ButtonsPanelPlugin,
    next: StoredCategory[]
): Promise<boolean> {
    if (!canMutateSettings(plugin)) {
        return false;
    }
    plugin.settings.categories = next;
    await plugin.saveSettings();
    dispatchPanelRefresh();
    return true;
}

/** The current registry+categories slice the domain operations transform. */
export function toolStateOf(plugin: ButtonsPanelPlugin): ToolState {
    return {
        tools: plugin.settings.tools,
        categories: plugin.settings.categories,
    };
}

/**
 * Commit funnel for domain operations (src/domain/categoryOps.ts): apply the
 * transformed registry+categories slice, persist, re-render. Operations that
 * did not change a slice hand back the same object, so unchanged identities
 * survive the commit.
 */
export async function commitToolState(
    plugin: ButtonsPanelPlugin,
    state: ToolState
): Promise<boolean> {
    if (!canMutateSettings(plugin)) {
        return false;
    }
    plugin.settings.tools = state.tools;
    plugin.settings.categories = state.categories;
    await plugin.saveSettings();
    dispatchPanelRefresh();
    return true;
}
