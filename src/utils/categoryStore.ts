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
import { getContextProfiles } from '@/utils/paletteLayers';

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

let copyCounter = 0;

function freshId(): string {
    copyCounter += 1;
    return `${Date.now().toString(36)}-${copyCounter}-${Math.random().toString(36).slice(2, 9)}`;
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
 * Every layer of a palette is copied — base buttons AND the buttons of every
 * context profile — with fresh ids, so the copy is fully independent of its
 * source. Copying only `buttons` would silently lose every contextual tool.
 */
export function duplicateCategoryConfig(
    category: CategoryConfig,
    order: number
): CategoryConfig {
    const profiles = getContextProfiles(category);
    const copy: CategoryConfig = {
        ...category,
        id: freshId(),
        name: category.name,
        order,
        buttons: copyButtons(category.buttons),
    };
    if (profiles.length === 0) {
        delete copy.contextProfiles;
        return copy;
    }
    return {
        ...copy,
        contextProfiles: profiles.map((profile) => ({
            ...profile,
            id: freshId(),
            buttons: copyButtons(profile.buttons),
        })),
    };
}
