// CategoryVariantContext.tsx
// Which variant of each dynamic grid category the panel is currently showing,
// and the resolved 4x4 grid that follows from it.
//
// In locked (consumption) mode the variant is decided by the context: the
// first matching trigger, else the fallback. In the management modes the user
// picks the variant explicitly in the category's variant selector, and that
// choice drives what is rendered, what can be dragged and where a new tool is
// created. The last two picks are remembered per category so the user can flip
// between two variants with one click (A/B comparison) — pure UI state, never
// persisted.
//
// The resolution itself is pure (src/utils/categoryVariants.ts); this context
// only distributes it and owns the selection state.

import React, { createContext, useContext } from 'react';
import type { CategoryConfig } from '@/types/settings';
import type { OCAPContextSnapshot } from '@/context/OCAPContext';
import {
    findVariant,
    getCategoryVariants,
    isDynamicCategory,
    resolveDynamicCategoryVariant,
    resolveGridViewForVariant,
    type ResolvedGridView,
} from '@/utils/categoryVariants';

/** Per-category selection: the variant on screen plus the one before it. */
export interface VariantSelectionEntry {
    current: string;
    /** Previously edited variant of the same category, for quick A/B flips. */
    previous: string | null;
}

export type VariantSelectionState = Readonly<Record<string, VariantSelectionEntry>>;

interface CategoryVariantValue {
    /** Resolved grid per grid category id (empty for flow categories). */
    gridViews: ReadonlyMap<string, ResolvedGridView>;
    /** Normalized selection per dynamic category id. */
    selection: VariantSelectionState;
    selectVariant: (categoryId: string, variantId: string) => void;
    /** True in sort/edit mode, where the variant selector is shown. */
    manageable: boolean;
}

const EMPTY_GRID_VIEWS: ReadonlyMap<string, ResolvedGridView> = new Map();

const DEFAULT_VALUE: CategoryVariantValue = {
    gridViews: EMPTY_GRID_VIEWS,
    selection: {},
    selectVariant: () => {},
    manageable: false,
};

const CategoryVariantContext = createContext<CategoryVariantValue>(DEFAULT_VALUE);

export const CategoryVariantProvider: React.FC<
    React.PropsWithChildren<CategoryVariantValue>
> = ({ gridViews, selection, selectVariant, manageable, children }) => {
    const value = React.useMemo(
        () => ({ gridViews, selection, selectVariant, manageable }),
        [gridViews, selection, selectVariant, manageable]
    );
    return (
        <CategoryVariantContext.Provider value={value}>
            {children}
        </CategoryVariantContext.Provider>
    );
};

export function useCategoryVariants(): CategoryVariantValue {
    return useContext(CategoryVariantContext);
}

/**
 * Resolved grid of one category. Falls back to a locally computed resolution
 * so a renderer mounted outside the provider (drag overlays, previews) still
 * shows a correct grid.
 */
export function useGridViewResolution(category: CategoryConfig): ResolvedGridView {
    const { gridViews } = useCategoryVariants();
    const resolved = gridViews.get(category.id);
    return React.useMemo(
        () => resolved ?? resolveGridViewForVariant(category, null),
        [resolved, category]
    );
}

/**
 * Normalize the variant selection of one dynamic category:
 *
 * - an explicit pick that still exists wins;
 * - without one, the variant the CURRENT CONTEXT resolves to is preselected,
 *   so entering edit mode shows the same grid locked mode showed (no silent
 *   content jump);
 * - otherwise the first variant.
 *
 * A selection pointing at a deleted variant can never survive, so deleting a
 * variant can never leave the UI on a phantom grid.
 */
export function selectedVariantOf(
    category: CategoryConfig,
    selection: VariantSelectionState,
    context: OCAPContextSnapshot
): VariantSelectionEntry | null {
    if (!isDynamicCategory(category)) {
        return null;
    }
    const variants = getCategoryVariants(category);
    if (variants.length === 0) {
        return null;
    }
    const entry = selection[category.id];
    const explicit =
        entry && findVariant(category, entry.current) !== null ? entry.current : null;
    const current =
        explicit ??
        resolveDynamicCategoryVariant(category, context).variant?.id ??
        variants[0]!.id;
    const previous =
        entry &&
        entry.previous !== null &&
        entry.previous !== current &&
        findVariant(category, entry.previous) !== null
            ? entry.previous
            : null;
    return { current, previous };
}
