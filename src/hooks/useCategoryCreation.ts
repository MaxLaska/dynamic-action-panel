import { useCallback } from 'react';
import { usePluginContext } from '@/contexts/PluginContext';
import { useRefresh } from './useRefresh';
import { CategoryCreateModal } from '@/components/modal/CategoryCreateModal';
import type { CategoryConfig } from '@/types';
import type { ButtonCondition } from '@/types/conditions';
import {
    DEFAULT_CATEGORY_LAYOUT,
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
    const { refresh } = useRefresh();

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
                        id: Date.now().toString(),
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
                    plugin.settings.categories.push(newCategory);
                    await plugin.saveSettings();
                    refresh();
                    if (onCreated) {
                        onCreated(newCategory);
                    }
                })();
            }).open();
        },
        [plugin, app, refresh]
    );

    return {
        createCategory,
    };
}

