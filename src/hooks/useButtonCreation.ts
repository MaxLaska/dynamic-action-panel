import { useCallback } from 'react';
import { usePluginContext } from '@/contexts/PluginContext';
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
 * question. `selection` is the NORMALIZED selection the panel renders from
 * (see PanelContent), so the target is always the grid on screen — never the
 * first variant by accident.
 *
 * @returns 按钮创建函数
 */
export function useButtonCreation() {
    const { plugin, app } = usePluginContext();
    const { selection } = useCategoryVariants();

    /**
     * 创建新按钮（显示创建对话框）
     * @param category 按钮所属的分类
     * @param onCreated 创建成功后的回调
     * @param targetSlot grid 分类中新工具的目标槽位（来自被点击的空格子）
     */
    const createButton = useCallback(
        (category: CategoryConfig, onCreated?: () => void, targetSlot: number | null = null) => {
            const stored = findStoredCategory(plugin, category.id) ?? category;
            const variantId = isDynamicCategory(stored)
                ? (selection[stored.id]?.current ?? null)
                : null;

            new ButtonCreateModal(
                app,
                plugin,
                stored,
                // The modal saves through the commit funnel itself.
                () => {
                    if (onCreated) {
                        onCreated();
                    }
                },
                variantId,
                targetSlot
            ).open();
        },
        [plugin, app, selection]
    );

    return {
        createButton,
    };
}
