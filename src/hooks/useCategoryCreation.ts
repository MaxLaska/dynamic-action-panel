import { useCallback } from 'react';
import { usePluginContext } from '@/contexts/PluginContext';
import { CategoryCreateModal } from '@/components/modal/CategoryCreateModal';
import { commitCategories } from '@/utils/categoryStore';
import { freshId } from '@/utils/id';
import type { StoredCategory } from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import {
    DEFAULT_CATEGORY_LAYOUT,
    DEFAULT_GRID_DIMENSIONS,
    type CategoryLayout,
} from '@/utils/categoryGrid';

/**
 * useCategoryCreation Hook
 * 
 * Wraps category creation behind a single entry point.
 * 
 * @returns A function that opens the create-category modal
 */
export function useCategoryCreation() {
    const { plugin, app } = usePluginContext();

    /**
     * Creates a new category by opening the create modal
     * @param onCreated Called after a successful creation
     */
    const createCategory = useCallback(
        (onCreated?: (category: StoredCategory) => void) => {
            new CategoryCreateModal(app, plugin, (
                categoryName: string,
                conditions: ButtonCondition | undefined,
                layout: CategoryLayout
            ) => {
                void (async () => {
                    const newCategory: StoredCategory = {
                        id: freshId('cat'),
                        name: categoryName,
                        order: plugin.settings.categories.length,
                        placements: [],
                    };
                    if (conditions !== undefined) {
                        newCategory.conditions = conditions;
                    }
                    // Only persist a non-default layout, so categories created
                    // as flow stay byte-identical to pre-palette data.
                    if (layout !== DEFAULT_CATEGORY_LAYOUT) {
                        newCategory.layout = layout;
                    }
                    if (layout === 'grid') {
                        // A NEW grid starts small and is grown from its own
                        // edge controls. Writing the size explicitly is what
                        // separates it from legacy data, where an absent size
                        // still means the historical 4x4.
                        newCategory.rows = DEFAULT_GRID_DIMENSIONS.rows;
                        newCategory.columns = DEFAULT_GRID_DIMENSIONS.columns;
                    }
                    await commitCategories(plugin, [
                        ...plugin.settings.categories,
                        newCategory,
                    ]);
                    if (onCreated) {
                        onCreated(newCategory);
                    }
                })();
            }).open();
        },
        [plugin, app]
    );

    return {
        createCategory,
    };
}

