import { useCallback } from 'react';
import { usePluginContext } from '@/contexts/PluginContext';
import { CategoryCreateModal } from '@/components/modal/CategoryCreateModal';
import { commitCategories } from '@/utils/categoryStore';
import { freshId } from '@/utils/id';
import type { CategoryConfig } from '@/types';
import type { ButtonCondition } from '@/types/conditions';
import {
    DEFAULT_CATEGORY_LAYOUT,
    DEFAULT_GRID_DIMENSIONS,
    type CategoryLayout,
} from '@/utils/categoryGrid';

/**
 * useCategoryCreation Hook
 * 
 * 封装分类创建的业务逻辑，提供统一的创建接口。
 * 
 * @returns 分类创建函数
 */
export function useCategoryCreation() {
    const { plugin, app } = usePluginContext();

    /**
     * 创建新分类（显示创建对话框）
     * @param onCreated 创建成功后的回调
     */
    const createCategory = useCallback(
        (onCreated?: (category: CategoryConfig) => void) => {
            new CategoryCreateModal(app, plugin, (
                categoryName: string,
                conditions: ButtonCondition | undefined,
                layout: CategoryLayout
            ) => {
                void (async () => {
                    const newCategory: CategoryConfig = {
                        id: freshId('cat'),
                        name: categoryName,
                        order: plugin.settings.categories.length,
                        buttons: [],
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

