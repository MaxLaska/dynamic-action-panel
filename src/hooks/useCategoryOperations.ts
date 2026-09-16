import { useCallback } from 'react';
import { usePluginContext } from '@/contexts/PluginContext';
import { useRefresh } from './useRefresh';
import { CategoryDeleteModal } from '@/components/modal/CategoryDeleteModal';
import { duplicateCategoryConfig } from '@/utils/categoryStore';
import type { CategoryConfig } from '@/types';

/**
 * useCategoryOperations Hook
 * 
 * 封装分类操作（复制、删除等）的业务逻辑，提供统一的操作接口。
 * 
 * @returns 分类操作函数对象
 */
export function useCategoryOperations() {
    const { plugin, app } = usePluginContext();
    const { refresh } = useRefresh();

    /**
     * 复制分类
     * @param category 要复制的分类
     * @param categories 所有分类数组（用于计算 order）
     */
    const copyCategory = useCallback(
        async (category: CategoryConfig, categories: CategoryConfig[]) => {
            // Copies every palette layer, not just `buttons` — see
            // duplicateCategoryConfig.
            const newCategory = duplicateCategoryConfig(category, categories.length);
            plugin.settings.categories.push(newCategory);
            await plugin.saveSettings();
            refresh();
        },
        [plugin, refresh]
    );

    /**
     * 删除分类（显示确认对话框）
     * @param category 要删除的分类
     * @param onDelete 删除成功后的回调
     */
    const deleteCategory = useCallback(
        (category: CategoryConfig, onDelete?: () => void) => {
            new CategoryDeleteModal(app, plugin, category, () => {
                if (onDelete) {
                    onDelete();
                }
                refresh();
            }).open();
        },
        [plugin, app, refresh]
    );

    return {
        copyCategory,
        deleteCategory,
    };
}

