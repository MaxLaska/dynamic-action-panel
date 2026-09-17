// categoryStore.ts
// Small bridge between the rendering tree and the persisted settings.
//
// A category object handed to a renderer is not necessarily the stored one:
// locked mode and the panel search hand out projection copies, and a grid
// palette additionally resolves its layers before rendering. Every write path
// (modals, menus, hooks) therefore has to look the stored category up by id
// before mutating, otherwise the edit lands in a throwaway object.

import type { ButtonConfig, CategoryConfig } from '@/types/settings';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import { getCategoryVariants, isDynamicCategory } from '@/utils/categoryVariants';
import { freshId } from '@/utils/id';

/** The persisted category with this id, or null when it no longer exists. */
export function findStoredCategory(
    plugin: ButtonsPanelPlugin,
    categoryId: string
): CategoryConfig | null {
    return plugin.settings.categories.find((category) => category.id === categoryId) ?? null;
}

/**
 * Replace a stored category with a new object (identity convention from
 * DECISIONS.md: changed content means a changed identity). Returns false when
 * the category has disappeared in the meantime.
 */
export function replaceStoredCategory(
    plugin: ButtonsPanelPlugin,
    next: CategoryConfig
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
    next: CategoryConfig
): Promise<boolean> {
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
    next: CategoryConfig[]
): Promise<void> {
    plugin.settings.categories = next;
    await plugin.saveSettings();
    dispatchPanelRefresh();
}

function copyButtons(buttons: readonly ButtonConfig[]): ButtonConfig[] {
    return buttons.map((button) => ({
        ...button,
        id: freshId(),
        actions: button.actions?.map((action) => ({ ...action })) ?? [],
    }));
}

/**
 * Deep copy of a category for the "duplicate category" command.
 * Every variant of a dynamic category is copied — with fresh variant and
 * button ids — so the copy is fully independent of its source. Copying only
 * `buttons` would silently lose every variant's tools.
 */
export function duplicateCategoryConfig(
    category: CategoryConfig,
    order: number
): CategoryConfig {
    const copy: CategoryConfig = {
        ...category,
        id: freshId(),
        name: category.name,
        order,
        buttons: copyButtons(category.buttons),
    };
    if (!isDynamicCategory(category)) {
        delete copy.variants;
        return copy;
    }
    return {
        ...copy,
        variants: getCategoryVariants(category).map((variant) => ({
            ...variant,
            id: freshId(),
            buttons: copyButtons(variant.buttons),
        })),
    };
}
