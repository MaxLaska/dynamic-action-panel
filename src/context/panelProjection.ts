// panelProjection.ts
// The single decision point for what the panel renders.
//
// Two very different questions are answered here, and only here:
// - locked (consumption) mode: which categories and which buttons the user can
//   actually use right now. Flow categories filter their buttons by the
//   per-button conditions; dynamic grid categories resolve their variant
//   (first matching trigger, else fallback, else hidden); static grid
//   categories always show their one grid.
// - sort/edit (management) mode: everything stays rendered and manageable.
//   Categories pass through with their identity intact; the projection only
//   reports what should be MARKED, plus the resolved grid of the variant the
//   user currently has selected.
//
// Keeping both in one pure function is what makes list/tabs/folder mode and the
// DnD provider agree on the same picture.

import type { CategoryConfig, InteractionMode } from '@/types/settings';
import type { WorkspaceContextSnapshot } from '@/context/workspaceContext';
import {
    isButtonVisibleInContext,
    isCategoryVisibleInContext,
} from '@/context/conditions';
import { isGridCategory } from '@/utils/categoryGrid';
import {
    effectiveGridButtons,
    resolveGridViewForContext,
    resolveGridViewForVariant,
    type ResolvedGridView,
} from '@/utils/categoryVariants';

/** Shared empty set for projections that hide nothing / mark nothing. */
export const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();

const EMPTY_GRID_VIEWS: ReadonlyMap<string, ResolvedGridView> = new Map();

/** Variant each dynamic category is being edited on (management modes). */
export type VariantSelectionMap = Readonly<Record<string, string>>;

export interface PanelContextProjection {
    /** Categories the active view mode should render. */
    categories: CategoryConfig[];
    /** Buttons to mark as context-hidden (management modes only). */
    hiddenButtonIds: ReadonlySet<string>;
    /** Categories to mark as context-hidden (management modes only). */
    hiddenCategoryIds: ReadonlySet<string>;
    /**
     * Resolved grid per grid category id: the runtime resolution in locked
     * mode, the selected variant's view in the management modes.
     */
    gridViews: ReadonlyMap<string, ResolvedGridView>;
}

export interface PanelProjectionOptions {
    /**
     * Management modes: the variant each dynamic category is currently being
     * edited on. Absent entries fall back to the first variant.
     */
    selectedVariants?: VariantSelectionMap;
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
 * - a static grid category shows its one grid (per-button conditions are NOT
 *   consulted in a grid, see DECISIONS.md);
 * - a dynamic grid category resolves to the first matching variant, else the
 *   fallback, else it disappears;
 * - a category also disappears when its own visibility condition does not
 *   hold, or when it has nothing left to offer.
 */
export function filterCategoriesByContext(
    categories: CategoryConfig[],
    context: WorkspaceContextSnapshot,
    gridViews?: Map<string, ResolvedGridView>
): CategoryConfig[] {
    let anyChanged = false;
    const result: CategoryConfig[] = [];

    for (const category of categories) {
        if (isGridCategory(category)) {
            const view = resolveGridViewForContext(category, context);
            gridViews?.set(category.id, view);
            if (!isCategoryVisibleInContext(category, context)) {
                anyChanged = true;
                continue;
            }
            const buttons = effectiveGridButtons(view);
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
 * the management-mode markers. Grid categories are skipped: a grid ignores
 * per-button conditions, and the variant selector already states which grid is
 * on screen.
 */
export function collectContextHiddenButtonIds(
    categories: CategoryConfig[],
    context: WorkspaceContextSnapshot
): Set<string> {
    const hidden = new Set<string>();
    for (const category of categories) {
        if (isGridCategory(category)) continue;
        for (const button of category.buttons) {
            if (!isButtonVisibleInContext(button, context)) {
                hidden.add(button.id);
            }
        }
    }
    return hidden;
}

/**
 * Ids of all categories whose own visibility condition does not hold.
 * Mirrors the button marker semantics: the marker reflects the element's own
 * condition only.
 */
export function collectContextHiddenCategoryIds(
    categories: CategoryConfig[],
    context: WorkspaceContextSnapshot
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
    context: WorkspaceContextSnapshot,
    interactionMode: InteractionMode,
    options?: PanelProjectionOptions
): PanelContextProjection {
    if (interactionMode === 'locked') {
        const gridViews = new Map<string, ResolvedGridView>();
        const filtered = filterCategoriesByContext(categories, context, gridViews);
        return {
            categories: filtered,
            hiddenButtonIds: EMPTY_ID_SET,
            hiddenCategoryIds: EMPTY_ID_SET,
            gridViews: gridViews.size === 0 ? EMPTY_GRID_VIEWS : gridViews,
        };
    }

    const selectedVariants = options?.selectedVariants;
    const gridViews = new Map<string, ResolvedGridView>();
    for (const category of categories) {
        if (!isGridCategory(category)) continue;
        gridViews.set(
            category.id,
            resolveGridViewForVariant(category, selectedVariants?.[category.id] ?? null)
        );
    }

    return {
        categories,
        hiddenButtonIds: collectContextHiddenButtonIds(categories, context),
        hiddenCategoryIds: collectContextHiddenCategoryIds(categories, context),
        gridViews: gridViews.size === 0 ? EMPTY_GRID_VIEWS : gridViews,
    };
}
