// panelProjection.ts
// The single decision point for what the panel renders.
//
// Two very different questions are answered here, and only here:
// - locked (consumption) mode: which categories and which buttons the user can
//   actually use right now. Flow categories filter their buttons by the
//   per-button conditions; grid palettes resolve their context layers
//   (base/pinned + the first matching context profile).
// - sort/edit (management) mode: everything stays rendered and manageable.
//   Categories pass through with their identity intact; the projection only
//   reports what should be MARKED, plus the resolved palette of the layer the
//   user currently has selected.
//
// Keeping both in one pure function is what makes list/tabs/folder mode and the
// DnD provider agree on the same picture.

import type { CategoryConfig, InteractionMode } from '@/types/settings';
import type { OCAPContextSnapshot } from '@/context/OCAPContext';
import {
    isButtonVisibleInContext,
    isCategoryVisibleInContext,
} from '@/context/conditions';
import {
    BASE_LAYER_ID,
    effectivePaletteButtons,
    isPaletteCategory,
    resolvePaletteForContext,
    resolvePaletteLayer,
    type PaletteLayerSelection,
    type ResolvedPalette,
} from '@/utils/paletteLayers';

/** Shared empty set for projections that hide nothing / mark nothing. */
export const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();

const EMPTY_PALETTES: ReadonlyMap<string, ResolvedPalette> = new Map();

export interface PanelContextProjection {
    /** Categories the active view mode should render. */
    categories: CategoryConfig[];
    /** Buttons to mark as context-hidden (management modes only). */
    hiddenButtonIds: ReadonlySet<string>;
    /** Categories to mark as context-hidden (management modes only). */
    hiddenCategoryIds: ReadonlySet<string>;
    /**
     * Resolved palette per grid category id: the runtime resolution in locked
     * mode, the selected layer's view in the management modes.
     */
    palettes: ReadonlyMap<string, ResolvedPalette>;
}

export interface PanelProjectionOptions {
    /**
     * Management modes: the layer each palette is currently being edited on.
     * Absent entries mean the base/pinned layer.
     */
    selectedLayers?: PaletteLayerSelection;
}

/** True when the resolved buttons are exactly the stored ones, in order. */
function sameButtons(
    category: CategoryConfig,
    buttons: readonly CategoryConfig['buttons'][number][]
): boolean {
    if (buttons.length !== category.buttons.length) {
        return false;
    }
    return buttons.every((button, index) => button === category.buttons[index]);
}

/**
 * Locked-mode projection: categories reduced to what the user can actually use.
 *
 * - a flow category drops the buttons their own conditions hide;
 * - a grid palette is resolved into base/pinned + the first matching context
 *   profile; per-button conditions are NOT consulted there (see DECISIONS.md);
 * - a category disappears when its own palette-visibility condition does not
 *   hold, or when it has nothing left to offer.
 *
 * A palette carrying pinned base tools therefore never disappears just because
 * no context profile matches — that is the whole point of the base layer.
 */
export function filterCategoriesByContext(
    categories: CategoryConfig[],
    context: OCAPContextSnapshot,
    palettes?: Map<string, ResolvedPalette>
): CategoryConfig[] {
    let anyChanged = false;
    const result: CategoryConfig[] = [];

    for (const category of categories) {
        if (isPaletteCategory(category)) {
            const resolved = resolvePaletteForContext(category, context);
            palettes?.set(category.id, resolved);
            if (!isCategoryVisibleInContext(category, context)) {
                anyChanged = true;
                continue;
            }
            const buttons = effectivePaletteButtons(resolved);
            if (buttons.length === 0) {
                anyChanged = true;
                continue;
            }
            if (sameButtons(category, buttons)) {
                result.push(category);
            } else {
                anyChanged = true;
                result.push({ ...category, buttons });
            }
            continue;
        }

        if (!isCategoryVisibleInContext(category, context)) {
            anyChanged = true;
            continue;
        }
        const visibleButtons = category.buttons.filter((button) =>
            isButtonVisibleInContext(button, context)
        );
        if (visibleButtons.length === 0) {
            anyChanged = true;
            continue;
        }
        if (visibleButtons.length === category.buttons.length) {
            result.push(category);
        } else {
            anyChanged = true;
            result.push({ ...category, buttons: visibleButtons });
        }
    }

    return anyChanged ? result : categories;
}

/**
 * Ids of all buttons hidden by their own conditions in the given context, for
 * the management-mode markers. Grid palettes are skipped: their contextuality
 * lives in the layer a button belongs to, not in a per-button condition, and
 * the layer selector already states which layer is on screen.
 */
export function collectContextHiddenButtonIds(
    categories: CategoryConfig[],
    context: OCAPContextSnapshot
): Set<string> {
    const hidden = new Set<string>();
    for (const category of categories) {
        if (isPaletteCategory(category)) continue;
        for (const button of category.buttons) {
            if (!isButtonVisibleInContext(button, context)) {
                hidden.add(button.id);
            }
        }
    }
    return hidden;
}

/**
 * Ids of all categories whose own palette-visibility condition does not hold.
 * Mirrors the button marker semantics: the marker reflects the element's own
 * condition only.
 */
export function collectContextHiddenCategoryIds(
    categories: CategoryConfig[],
    context: OCAPContextSnapshot
): Set<string> {
    const hidden = new Set<string>();
    for (const category of categories) {
        if (!isCategoryVisibleInContext(category, context)) {
            hidden.add(category.id);
        }
    }
    return hidden;
}

export function projectCategoriesForContext(
    categories: CategoryConfig[],
    context: OCAPContextSnapshot,
    interactionMode: InteractionMode,
    options?: PanelProjectionOptions
): PanelContextProjection {
    if (interactionMode === 'locked') {
        const palettes = new Map<string, ResolvedPalette>();
        const filtered = filterCategoriesByContext(categories, context, palettes);
        return {
            categories: filtered,
            hiddenButtonIds: EMPTY_ID_SET,
            hiddenCategoryIds: EMPTY_ID_SET,
            palettes: palettes.size === 0 ? EMPTY_PALETTES : palettes,
        };
    }

    const selectedLayers = options?.selectedLayers;
    const palettes = new Map<string, ResolvedPalette>();
    for (const category of categories) {
        if (!isPaletteCategory(category)) continue;
        palettes.set(
            category.id,
            resolvePaletteLayer(category, selectedLayers?.[category.id] ?? BASE_LAYER_ID)
        );
    }

    return {
        categories,
        hiddenButtonIds: collectContextHiddenButtonIds(categories, context),
        hiddenCategoryIds: collectContextHiddenCategoryIds(categories, context),
        palettes: palettes.size === 0 ? EMPTY_PALETTES : palettes,
    };
}
