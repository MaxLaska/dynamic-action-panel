import { useCallback, useMemo } from 'react';
import { usePluginContext } from '@/contexts/PluginContext';
import { useRefresh } from './useRefresh';
import { useCategoryVariants } from '@/contexts/CategoryVariantContext';
import { findStoredCategory, replaceStoredCategory } from '@/utils/categoryStore';
import { GridResizeConfirmModal } from '@/components/modal/GridResizeConfirmModal';
import {
    gridDimensionsOf,
    isDynamicCategory,
    planGridResize,
    type GridResizePlan,
} from '@/utils/categoryVariants';
import {
    MAX_GRID_COLUMNS,
    MAX_GRID_ROWS,
    MIN_GRID_COLUMNS,
    MIN_GRID_ROWS,
    applyResizeSteps,
    type GridDimensions,
    type GridResizeDirection,
    type GridResizeEdge,
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

/** Which edge a plan actually changed, and by how many stripes it shrank. */
function planShrink(plan: GridResizePlan): { edge: GridResizeEdge; strips: number } {
    const columnStrips = plan.from.columns - plan.to.columns;
    return columnStrips > 0
        ? { edge: 'column', strips: columnStrips }
        : { edge: 'row', strips: plan.from.rows - plan.to.rows };
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
 * Both entry points — the stepper buttons and the drag handle — end up in the
 * SAME `resizeGridTo`: there is exactly one resize semantics, and the pure
 * `planGridResize` owns all of it. The handle is an interaction layer, not a
 * second implementation.
 */
export function useGridResize() {
    const { plugin, app } = usePluginContext();
    const { refresh } = useRefresh();
    const { selection } = useCategoryVariants();

    /** The variant whose grid the user is editing, or null for a static grid. */
    const targetVariantId = useCallback(
        (stored: CategoryConfig): string | null =>
            isDynamicCategory(stored) ? (selection[stored.id]?.current ?? null) : null,
        [selection]
    );

    /**
     * Resize to an explicit size. Commits at once when nothing is lost;
     * otherwise asks ONCE for the whole gesture, however many stripes it takes.
     */
    const resizeGridTo = useCallback(
        (category: CategoryConfig, next: GridDimensions) => {
            const stored = findStoredCategory(plugin, category.id) ?? category;
            const variantId = targetVariantId(stored);

            const plan = planGridResize(stored, variantId, next);
            if (!plan) {
                // Already that size, or no addressable grid: nothing to do.
                return;
            }

            const commit = () => {
                // Re-plan against the CURRENT stored data: the confirmation is
                // async, and the grid may have changed while it was open.
                const fresh = findStoredCategory(plugin, category.id);
                const freshPlan = fresh ? planGridResize(fresh, variantId, next) : null;
                if (!freshPlan) return;
                if (!replaceStoredCategory(plugin, freshPlan.category)) return;
                void plugin.saveSettings().then(() => refresh());
            };

            if (plan.removed.length === 0) {
                // Nothing is lost — asking would be noise.
                commit();
                return;
            }

            const { edge, strips } = planShrink(plan);
            new GridResizeConfirmModal(app, {
                edge,
                strips,
                buttonNames: plan.removed.map((button) => button.name),
                onConfirm: commit,
            }).open();
        },
        [app, plugin, refresh, targetVariantId]
    );

    /** Dimensions of the grid the user is editing in this category. */
    const dimensionsOf = useCallback(
        (category: CategoryConfig): GridDimensions => {
            const stored = findStoredCategory(plugin, category.id) ?? category;
            return gridDimensionsOf(stored, targetVariantId(stored));
        },
        [plugin, targetVariantId]
    );

    /** One stepper click: the outermost row/column added or removed. */
    const resizeGrid = useCallback(
        (category: CategoryConfig, edge: GridResizeEdge, direction: GridResizeDirection) => {
            resizeGridTo(category, applyResizeSteps(dimensionsOf(category), edge, direction));
        },
        [dimensionsOf, resizeGridTo]
    );

    return useMemo(
        () => ({ resizeGrid, resizeGridTo, dimensionsOf }),
        [resizeGrid, resizeGridTo, dimensionsOf]
    );
}
