import { useCallback } from 'react';
import { Notice } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { ButtonDeleteModal } from '@/components/modal/ButtonDeleteModal';
import { commitToolState, toolStateOf } from '@/utils/categoryStore';
import {
    copyToolInCategory,
    removeToolsFromCategory,
} from '@/domain/categoryOps';
import { deleteTargetsOf } from '@/utils/deleteTargets';
import { freshId } from '@/utils/id';
import { t } from '@/utils/i18n';
import type { ButtonConfig, CategoryConfig } from '@/types';

/**
 * useButtonOperations Hook
 *
 * Button operations such as copy and remove, behind a single interface.
 *
 * Settings v5: a copy creates a NEW tool definition plus a new placement in the
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
     * Asks, then removes the named tools from this category in ONE operation.
     *
     * THE delete. One tool and a whole selection come through here alike —
     * there is no second function for the single case, so the two cannot drift
     * apart — and the confirmation phrases itself from the number of targets.
     *
     * One confirmation, one state transition, one write. The batch is not a
     * loop over the single case:
     * `removeToolsFromCategory` strips every placement first and collects the
     * definitions afterwards, so garbage collection judges "is this still
     * referenced" against the finished state rather than a half-updated one.
     *
     * Nothing happens until the user confirms, and `onDeleted` runs only after
     * the write actually landed — so a caller can clear the selection knowing
     * the tools are really gone, and a cancelled dialog leaves it standing.
     *
     * @param toolIds Tools to remove; ids that name nothing are ignored
     * @param category Category the tools belong to
     * @param onDeleted Called after the write, never after a cancel
     */
    const deleteTools = useCallback(
        (toolIds: readonly string[], category: CategoryConfig, onDeleted?: () => void) => {
            const targets = deleteTargetsOf(toolStateOf(plugin).tools, toolIds);
            if (targets.length === 0) {
                return;
            }
            new ButtonDeleteModal(app, plugin, targets, category, () => {
                void (async () => {
                    await commitToolState(
                        plugin,
                        removeToolsFromCategory(
                            toolStateOf(plugin),
                            category.id,
                            targets.map((target) => target.toolId)
                        )
                    );
                    if (onDeleted) {
                        onDeleted();
                    }
                })();
            }).open();
        },
        [plugin, app]
    );

    return {
        copyButton,
        deleteTools,
    };
}
