import { useCallback } from 'react';
import { Notice } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { ButtonDeleteModal } from '@/components/modal/ButtonDeleteModal';
import { commitToolState, toolStateOf } from '@/utils/categoryStore';
import {
    copyToolInCategory,
    removeToolFromCategory,
} from '@/domain/categoryOps';
import { freshId } from '@/utils/id';
import { t } from '@/utils/i18n';
import type { ButtonConfig, CategoryConfig } from '@/types';

/**
 * useButtonOperations Hook
 *
 * 封装按钮操作（复制、删除等）的业务逻辑，提供统一的操作接口。
 *
 * OCAP v5: a copy creates a NEW tool definition plus a new placement in the
 * grid/variant (or flow list) the source occupies — never implicit sharing.
 * A delete removes the placement and garbage-collects the definition when
 * nothing references it anymore and it is not a library tool (exactly the
 * pre-v5 behavior for every tool that was not explicitly kept).
 *
 * @returns 按钮操作函数对象
 */
export function useButtonOperations() {
    const { plugin, app } = usePluginContext();

    /**
     * 复制按钮
     * @param button 要复制的按钮 (view shape; its id is the tool id)
     * @param category 按钮所属的分类
     */
    const copyButton = useCallback(
        async (button: ButtonConfig, category: CategoryConfig) => {
            const next = copyToolInCategory(
                toolStateOf(plugin),
                category.id,
                button.id,
                freshId()
            );
            if (!next) {
                new Notice(t('variant_grid_full'));
                return;
            }
            await commitToolState(plugin, next);
        },
        [plugin]
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
                    await commitToolState(
                        plugin,
                        removeToolFromCategory(toolStateOf(plugin), category.id, button.id)
                    );
                    if (onDelete) {
                        onDelete();
                    }
                })();
            }).open();
        },
        [plugin, app]
    );

    return {
        copyButton,
        deleteButton,
    };
}
