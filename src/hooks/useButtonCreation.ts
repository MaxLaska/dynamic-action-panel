import { useCallback } from 'react';
import { usePluginContext } from '@/contexts/PluginContext';
import { useRefresh } from './useRefresh';
import { ButtonCreateModal } from '@/components/modal/ButtonCreateModal';
import { useCategoryVariants } from '@/contexts/CategoryVariantContext';
import { findStoredCategory } from '@/utils/categoryStore';
import { isDynamicCategory } from '@/utils/categoryVariants';
import type { CategoryConfig } from '@/types';

/**
 * useButtonCreation Hook
 *
 * 封装按钮创建的业务逻辑，提供统一的创建接口。
 *
 * OCAP: in a dynamic grid category a new tool is created in the variant the
 * user is currently editing. That is why there is no "contextual" checkbox in
 * the button modal: the variant selector above the grid already answers the
 * question.
 *
 * @returns 按钮创建函数
 */
export function useButtonCreation() {
    const { plugin, app } = usePluginContext();
    const { refresh } = useRefresh();
    const { selection } = useCategoryVariants();

    /**
     * 创建新按钮（显示创建对话框）
     * @param category 按钮所属的分类
     * @param onCreated 创建成功后的回调
     */
    const createButton = useCallback(
        (category: CategoryConfig, onCreated?: () => void) => {
            const stored = findStoredCategory(plugin, category.id) ?? category;
            const variantId = isDynamicCategory(stored)
                ? (selection[stored.id]?.current ?? null)
                : null;

            new ButtonCreateModal(
                app,
                plugin,
                stored,
                () => {
                    void plugin.saveSettings();
                    refresh();
                    if (onCreated) {
                        onCreated();
                    }
                },
                variantId
            ).open();
        },
        [plugin, app, refresh, selection]
    );

    return {
        createButton,
    };
}
