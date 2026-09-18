import { useCallback } from 'react';
import { usePluginContext } from '@/contexts/PluginContext';
import { commitToolState, toolStateOf } from '@/utils/categoryStore';
import { setCellColorsInState } from '@/domain/categoryOps';
import type { GridCellKey } from '@/types/settings';
import type { GridSelectionContextKey } from '@/utils/gridCellSelection';

/**
 * useCellColorActions
 *
 * Writes a cell color. The only consumer of the cell selection that persists
 * anything.
 *
 * Two properties matter here and both come from doing the work in one pure
 * operation rather than per cell:
 *
 * - **one commit for the whole selection.** Coloring twelve cells is one
 *   `setCellColorsInState` and one `commitToolState`, so it is one save, one
 *   refresh and one undoable-by-recoloring step — not twelve of each;
 * - **the target is resolved against the CURRENT stored state**, never against
 *   the rendered projection the click came from, so a grid that changed
 *   underneath cannot be written from a stale view.
 *
 * The write-guard is respected by construction: `commitToolState` refuses
 * BEFORE mutating when the configuration is read-only (a settings version this
 * build cannot interpret), and returns whether it committed — so nothing here
 * reports a success that did not happen.
 */
export function useCellColorActions() {
    const { plugin } = usePluginContext();

    const applyCellColor = useCallback(
        async (
            context: GridSelectionContextKey,
            cells: readonly GridCellKey[],
            color: string | null
        ): Promise<boolean> => {
            const state = toolStateOf(plugin);
            const next = setCellColorsInState(
                state,
                context.categoryId,
                context.variantId,
                cells,
                color
            );
            // The operation hands back the very same state when it changed
            // nothing — a refused target, an invalid color, or cells that
            // already carry it. Committing that would be a pointless save and a
            // pointless panel refresh.
            if (next === state) {
                return false;
            }
            return commitToolState(plugin, next);
        },
        [plugin]
    );

    return { applyCellColor };
}
