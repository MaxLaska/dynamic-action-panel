import { useCallback } from 'react';
import { Notice } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { useRefresh } from './useRefresh';
import { ButtonDeleteModal } from '@/components/modal/ButtonDeleteModal';
import { findStoredCategory, replaceStoredCategory } from '@/utils/categoryStore';
import {
    addButtonToGrid,
    findButtonVariantId,
    removeButtonFromGridCategory,
} from '@/utils/categoryVariants';
import { isGridCategory } from '@/utils/categoryGrid';
import { t } from '@/utils/i18n';
import type { ButtonConfig, CategoryConfig } from '@/types';

/**
 * useButtonOperations Hook
 *
 * 封装按钮操作（复制、删除等）的业务逻辑，提供统一的操作接口。
 *
 * OCAP: in a grid category every operation works on the variant the tool
 * actually lives in — a copy stays in its own variant, and a delete removes
 * it from there. Other variants are never touched.
 *
 * @returns 按钮操作函数对象
 */
export function useButtonOperations() {
    const { plugin, app } = usePluginContext();
    const { refresh } = useRefresh();

    /**
     * 复制按钮
     * @param button 要复制的按钮
     * @param category 按钮所属的分类
     */
    const copyButton = useCallback(
        async (button: ButtonConfig, category: CategoryConfig) => {
            const stored = findStoredCategory(plugin, category.id);
            if (!stored) return;

            const newButton: ButtonConfig = {
                ...button,
                actions: button.actions?.map((action) => ({ ...action })) ?? [],
                id: Date.now().toString(),
            };

            if (isGridCategory(stored)) {
                const variantId = findButtonVariantId(stored, button.id);
                const next = addButtonToGrid(stored, variantId, newButton);
                if (!next) {
                    new Notice(t('variant_grid_full'));
                    return;
                }
                replaceStoredCategory(plugin, next);
            } else {
                const { slot: _slot, ...rest } = newButton;
                replaceStoredCategory(plugin, {
                    ...stored,
                    buttons: [
                        ...stored.buttons,
                        {
                            ...(rest as ButtonConfig),
                            order: Math.max(...stored.buttons.map((b) => b.order), -1) + 1,
                        },
                    ],
                });
            }

            await plugin.saveSettings();
            refresh();
        },
        [plugin, refresh]
    );

    /**
     * 删除按钮（显示确认对话框）
     * @param button 要删除的按钮
     * @param category 按钮所属的分类
     * @param onDelete 删除成功后的回调
     */
    const deleteButton = useCallback(
        (button: ButtonConfig, category: CategoryConfig, onDelete?: () => void) => {
            new ButtonDeleteModal(app, plugin, button, category, () => {
                void (async () => {
                    const stored = findStoredCategory(plugin, category.id);
                    if (stored) {
                        if (isGridCategory(stored)) {
                            replaceStoredCategory(
                                plugin,
                                removeButtonFromGridCategory(stored, button.id)
                            );
                            await plugin.saveSettings();
                            refresh();
                        } else {
                            const index = stored.buttons.findIndex(
                                (b) => b.id === button.id
                            );
                            if (index !== -1) {
                                const buttons = stored.buttons.filter(
                                    (b) => b.id !== button.id
                                );
                                replaceStoredCategory(plugin, {
                                    ...stored,
                                    // 删除后重排所有按钮的 order 为 0,1,2...
                                    buttons: buttons.map((b, i) => ({ ...b, order: i })),
                                });
                                await plugin.saveSettings();
                                refresh();
                            }
                        }
                    }
                    if (onDelete) {
                        onDelete();
                    }
                })();
            }).open();
        },
        [plugin, app, refresh]
    );

    return {
        copyButton,
        deleteButton,
    };
}
