import { useCallback, useMemo } from 'react';
import { usePluginContext } from '@/contexts/PluginContext';
import { useRefresh } from './useRefresh';
import { useCategoryVariants } from '@/contexts/CategoryVariantContext';
import { findStoredCategory, replaceStoredCategory } from '@/utils/categoryStore';
import { GridResizeConfirmModal } from '@/components/modal/GridResizeConfirmModal';
import {
    gridDimensionsOf,
    isDynamicCategory,
    planGridResizeStep,
    type GridResizeDirection,
    type GridResizeEdge,
} from '@/utils/categoryVariants';
import {
    MAX_GRID_COLUMNS,
    MAX_GRID_ROWS,
    MIN_GRID_COLUMNS,
    MIN_GRID_ROWS,
    type GridDimensions,
} from '@/utils/categoryGrid';
import type { CategoryConfig } from '@/types';

/** What the resize controls of one grid may currently do. */
export interface GridResizeAvailability {
    canAddRow: boolean;
    canRemoveRow: boolean;
    canAddColumn: boolean;
    canRemoveColumn: boolean;
}

export function gridResizeAvailability(
    dimensions: GridDimensions
): GridResizeAvailability {
    return {
        canAddRow: dimensions.rows < MAX_GRID_ROWS,
        canRemoveRow: dimensions.rows > MIN_GRID_ROWS,
        canAddColumn: dimensions.columns < MAX_GRID_COLUMNS,
        canRemoveColumn: dimensions.columns > MIN_GRID_COLUMNS,
    };
}

/**
 * useGridResize
 *
 * Growing and shrinking the ONE grid the user is editing, straight from the
 * controls at its edge — the same principle as creating a tool in the cell you
 * point at: the gesture already says which grid and which edge.
 *
 * The target is resolved exactly like the `+` and the file drop do it: the
 * STORED category (a rendered one may be a projection copy) and the variant
 * the selector currently shows. Resizing one variant therefore can never
 * touch another variant, the fallback, or another category.
 *
 * All arithmetic lives in the pure `planGridResizeStep`; this hook only asks
 * for a confirmation when the plan would cut tools away, and persists.
 */
export function useGridResize() {
    const { plugin, app } = usePluginContext();
    const { refresh } = useRefresh();
    const { selection } = useCategoryVariants();

    const resizeGrid = useCallback(
        (category: CategoryConfig, edge: GridResizeEdge, direction: GridResizeDirection) => {
            const stored = findStoredCategory(plugin, category.id) ?? category;
            const variantId = isDynamicCategory(stored)
                ? (selection[stored.id]?.current ?? null)
                : null;

            const plan = planGridResizeStep(stored, variantId, edge, direction);
            if (!plan) {
                // At a bound, or nothing to change: the control is disabled in
                // that state anyway, so this is simply a no-op.
                return;
            }

            const commit = () => {
                // Re-plan against the CURRENT stored data: the confirmation is
                // async, and the grid may have changed while it was open.
                const fresh = findStoredCategory(plugin, category.id);
                const freshPlan = fresh
                    ? planGridResizeStep(fresh, variantId, edge, direction)
                    : null;
                if (!freshPlan) return;
                if (!replaceStoredCategory(plugin, freshPlan.category)) return;
                void plugin.saveSettings().then(() => refresh());
            };

            if (plan.removed.length === 0) {
                // Nothing is lost — asking would be noise.
                commit();
                return;
            }

            new GridResizeConfirmModal(app, {
                edge,
                buttonNames: plan.removed.map((button) => button.name),
                onConfirm: commit,
            }).open();
        },
        [app, plugin, refresh, selection]
    );

    /** Dimensions of the grid the user is editing in this category. */
    const dimensionsOf = useCallback(
        (category: CategoryConfig): GridDimensions => {
            const stored = findStoredCategory(plugin, category.id) ?? category;
            const variantId = isDynamicCategory(stored)
                ? (selection[stored.id]?.current ?? null)
                : null;
            return gridDimensionsOf(stored, variantId);
        },
        [plugin, selection]
    );

    return useMemo(() => ({ resizeGrid, dimensionsOf }), [resizeGrid, dimensionsOf]);
}
