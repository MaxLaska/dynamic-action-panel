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
 * Button operations such as copy and remove, behind a single interface.
 *
 * OCAP v5: a copy creates a NEW tool definition plus a new placement in the
 * grid/variant (or flow list) the source occupies — never implicit sharing.
 * A delete removes the placement and garbage-collects the definition when
 * nothing references it anymore and it is not a library tool (exactly the
 * pre-v5 behavior for every tool that was not explicitly kept).
 *
 * @returns The button operation functions
 */
export function useButtonOperations() {
    const { plugin, app } = usePluginContext();

    /**
     * Copies a button
     * @param button Button to copy (view shape; its id is the tool id)
     * @param category Category the button belongs to
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
     * Removes a button after a confirmation dialog
     * @param button Button to remove
     * @param category Category the button belongs to
     * @param onDelete Called after a successful removal
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
