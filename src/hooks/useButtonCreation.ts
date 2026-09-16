import { useCallback } from 'react';
import { usePluginContext } from '@/contexts/PluginContext';
import { useRefresh } from './useRefresh';
import { ButtonCreateModal } from '@/components/modal/ButtonCreateModal';
import { usePaletteLayers, selectedLayerOf } from '@/contexts/PaletteLayerContext';
import { findStoredCategory } from '@/utils/categoryStore';
import { BASE_LAYER_ID, isPaletteCategory } from '@/utils/paletteLayers';
import type { CategoryConfig } from '@/types';

/**
 * useButtonCreation Hook
 *
 * 封装按钮创建的业务逻辑，提供统一的创建接口。
 *
 * OCAP: in a grid palette a new tool is created on the layer the user is
 * currently editing — base/pinned or the selected context profile. That is why
 * there is no "pinned" or "contextual" checkbox in the button modal: the layer
 * selector above the grid already answers the question.
 *
 * @returns 按钮创建函数
 */
export function useButtonCreation() {
    const { plugin, app } = usePluginContext();
    const { refresh } = useRefresh();
    const { selection } = usePaletteLayers();

    /**
     * 创建新按钮（显示创建对话框）
     * @param category 按钮所属的分类
     * @param onCreated 创建成功后的回调
     */
    const createButton = useCallback(
        (category: CategoryConfig, onCreated?: () => void) => {
            const stored = findStoredCategory(plugin, category.id) ?? category;
            const layerId = isPaletteCategory(stored)
                ? selectedLayerOf(stored, selection)
                : BASE_LAYER_ID;

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
                layerId
            ).open();
        },
        [plugin, app, refresh, selection]
    );

    return {
        createButton,
    };
}
