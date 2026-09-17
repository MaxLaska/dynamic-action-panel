import { useCallback } from 'react';
import { usePluginContext } from '@/contexts/PluginContext';
import { useRefresh } from './useRefresh';
import { CategoryDeleteModal } from '@/components/modal/CategoryDeleteModal';
import { commitToolState, toolStateOf } from '@/utils/categoryStore';
import { duplicateCategoryInState } from '@/domain/categoryOps';
import { freshId } from '@/utils/id';
import type { CategoryConfig } from '@/types';

/**
 * useCategoryOperations Hook
 * 
 * Category operations such as copy and remove, behind a single interface.
 * 
 * @returns The category operation functions
 */
export function useCategoryOperations() {
    const { plugin, app } = usePluginContext();
    const { refresh } = useRefresh();

    /**
     * Copies a category
     * @param category Category to copy
     * @param categories All categories, used to compute the order of the copy
     */
    const copyCategory = useCallback(
        async (category: CategoryConfig, categories: CategoryConfig[]) => {
            // Copies every variant AND its tool definitions (fresh ids — the
            // copy is fully independent of its source, see F2).
            const result = duplicateCategoryInState(
                toolStateOf(plugin),
                category.id,
                categories.length,
                freshId
            );
            if (result) {
                await commitToolState(plugin, result.state);
            }
        },
        [plugin]
    );

    /**
     * Removes a category after a confirmation dialog
     * @param category Category to remove
     * @param onDelete Called after a successful removal
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

