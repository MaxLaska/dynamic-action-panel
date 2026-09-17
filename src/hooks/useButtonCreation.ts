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
 * Wraps button creation behind a single entry point.
 *
 * OCAP: in a dynamic grid category a new tool is created in the variant the
 * user is currently editing. That is why there is no "contextual" checkbox in
 * the button modal: the variant selector above the grid already answers the
 * question. `selection` is the NORMALIZED selection the panel renders from
 * (see PanelContent), so the target is always the grid on screen — never the
 * first variant by accident.
 *
 * @returns A function that opens the create-button modal
 */
export function useButtonCreation() {
    const { plugin, app } = usePluginContext();
    const { selection } = useCategoryVariants();

    /**
     * Creates a new button by opening the create modal
     * @param category Category the button belongs to
     * @param onCreated Called after a successful creation
     * @param targetSlot Target slot of the new tool in a grid category (the empty cell that was clicked)
     */
    const createButton = useCallback(
        (category: CategoryConfig, onCreated?: () => void, targetSlot: number | null = null) => {
            const stored = findStoredCategory(plugin, category.id);
            if (!stored) {
                return;
            }
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
