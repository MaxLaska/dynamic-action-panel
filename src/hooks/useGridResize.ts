import { useCallback, useMemo } from 'react';
import { usePluginContext } from '@/contexts/PluginContext';
import { useCategoryVariants } from '@/contexts/CategoryVariantContext';
import {
    commitToolState,
    findStoredCategory,
    toolStateOf,
} from '@/utils/categoryStore';
import { canMutateSettings } from '@/utils/settingsWriteGuard';
import { GridResizeConfirmModal } from '@/components/modal/GridResizeConfirmModal';
import { gridDimensionsOf, isDynamicCategory } from '@/utils/categoryVariants';
import {
    commitStoredGridResize,
    planStoredGridResize,
    type StoredGridResizePlan,
} from '@/domain/categoryOps';
import type { StoredCategory } from '@/types/settings';
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

/**
 * What a resize request actually did.
 *
 * The caller needs this to know whether the new size is already on its way to
 * the settings (`committed`) or whether the user still has to answer a
 * confirmation (`confirming`) — which decides whether a live preview may keep
 * standing or has to fall back to the stored size right away.
 */
export type GridResizeOutcome = 'committed' | 'confirming' | 'none';

export interface GridResizeOptions {
    /**
     * Runs once the committed size has been written and the panel refreshed —
     * or the save failed. The only safe moment to drop a preview that was
     * being held across the commit.
     */
    onSettled?: () => void;
}

/** Which edge a plan actually changed, and by how many stripes it shrank. */
function planShrink(plan: StoredGridResizePlan): { edge: GridResizeEdge; strips: number } {
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
    const { selection } = useCategoryVariants();

    /** The variant whose grid the user is editing, or null for a static grid. */
    const targetVariantId = useCallback(
        (stored: StoredCategory): string | null =>
            isDynamicCategory(stored) ? (selection[stored.id]?.current ?? null) : null,
        [selection]
    );

    /**
     * Resize to an explicit size. Commits at once when nothing is lost;
     * otherwise asks ONCE for the whole gesture, however many stripes it takes.
     */
    const resizeGridTo = useCallback(
        (
            category: CategoryConfig,
            next: GridDimensions,
            options?: GridResizeOptions
        ): GridResizeOutcome => {
            // Asked before the confirmation dialog rather than at the commit:
            // making someone confirm that tools may be destroyed and THEN
            // refusing the write is a cruel sequence. Not silent — this is a
            // deliberate user action and deserves the explanation.
            if (!canMutateSettings(plugin)) {
                options?.onSettled?.();
                return 'none';
            }

            const stored = findStoredCategory(plugin, category.id);
            if (!stored) {
                return 'none';
            }
            const variantId = targetVariantId(stored);

            const plan = planStoredGridResize(
                stored,
                variantId,
                next,
                plugin.settings.tools
            );
            if (!plan) {
                // Already that size, or no addressable grid: nothing to do.
                return 'none';
            }

            const commit = () => {
                // Re-plan against the CURRENT stored data: the confirmation is
                // async, and the grid may have changed while it was open.
                const fresh = findStoredCategory(plugin, category.id);
                const freshPlan = fresh
                    ? planStoredGridResize(fresh, variantId, next, plugin.settings.tools)
                    : null;
                if (!freshPlan) {
                    options?.onSettled?.();
                    return;
                }
                // Cut tools are garbage-collected in the same commit (unless
                // referenced elsewhere or protected via `library`). A failed
                // save must release a held preview too, or it would keep
                // showing a size the data never got.
                void commitToolState(
                    plugin,
                    commitStoredGridResize(toolStateOf(plugin), freshPlan)
                ).finally(() => options?.onSettled?.());
            };

            if (plan.removedToolIds.length === 0) {
                // Nothing is lost — asking would be noise.
                commit();
                return 'committed';
            }

            const { edge, strips } = planShrink(plan);
            new GridResizeConfirmModal(app, {
                edge,
                strips,
                buttonNames: plan.removedNames,
                onConfirm: commit,
            }).open();
            return 'confirming';
        },
        [app, plugin, targetVariantId]
    );

    /** Dimensions of the grid the user is editing in this category. */
    const dimensionsOf = useCallback(
        (category: CategoryConfig): GridDimensions => {
            const stored = findStoredCategory(plugin, category.id);
            if (!stored) {
                return gridDimensionsOf(category, null);
            }
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
