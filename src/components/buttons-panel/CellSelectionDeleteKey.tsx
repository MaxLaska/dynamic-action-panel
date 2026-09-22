import React from 'react';
import { useButtonDragOptional } from '@/contexts/ButtonDragContext';
import { useGridCellSelection } from '@/contexts/GridCellSelectionContext';
import { useButtonOperations } from '@/hooks/useButtonOperations';
import { getSelectionDescriptor } from '@/utils/contextTarget';
import { shouldOpenDeleteConfirmation } from '@/utils/deleteKey';
import type { GridCellKey } from '@/types/settings';
import type { CategoryConfig } from '@/types';

interface CellSelectionDeleteKeyProps {
    /** The grid the selection belongs to. */
    category: CategoryConfig;
    /** Its selected cells, empty ones included. */
    selectedCells: ReadonlySet<GridCellKey>;
    /** What a cell holds, as only the rendered grid can say. */
    toolIdOfCell: (cell: GridCellKey) => string | null;
    /** The grid's own element, used to find the leaf the key may come from. */
    scopeRef: React.RefObject<HTMLElement | null>;
}

/**
 * The Delete key deletes the selection — through the same door as the menu.
 *
 * It is NOT a shortcut for destroying things: it opens exactly the confirmation
 * that right-click → Delete opens, with the same targets, the same list and the
 * same Cancel. One tool selected asks the single question, several ask the
 * multiple one, and nothing selected asks nothing.
 *
 * It lives beside the grid rather than in the panel root, for the same reason
 * the menu reads the grid: only the rendered grid knows what a cell actually
 * holds. It mounts only while THIS grid holds a non-empty selection, and the
 * panel has one selection at a time, so exactly one of these listeners exists
 * at any moment — and none at all when nothing is selected.
 *
 * Deliberately a sibling of CellSelectionEscape rather than an extension of it:
 * the two keys share a scope rule but not a meaning, and one listener answering
 * to both would have to explain itself twice.
 *
 * The listener never stops the event. If something closer to the user wanted
 * this Delete — a text field, a dialog, another leaf — it has already had it,
 * and `shouldOpenDeleteConfirmation` is the list of ways this hands it back.
 */
export const CellSelectionDeleteKey: React.FC<CellSelectionDeleteKeyProps> = ({
    category,
    selectedCells,
    toolIdOfCell,
    scopeRef,
}) => {
    const { clearCellSelection, cellGestureActive } = useGridCellSelection();
    const buttonDrag = useButtonDragOptional();
    const { deleteTools } = useButtonOperations();

    // Read fresh at keypress rather than captured when the listener was
    // attached: a drop or another delete can change what the cells hold while
    // the same selection stands.
    const latest = React.useRef({ selectedCells, toolIdOfCell, category });
    latest.current = { selectedCells, toolIdOfCell, category };

    const dragging = (buttonDrag?.isDragging ?? false) || cellGestureActive;
    const hasSelection = selectedCells.size > 0;

    React.useEffect(() => {
        if (!hasSelection) {
            return;
        }
        const scope = scopeRef.current;
        const doc = scope?.ownerDocument ?? document;
        // The same reach as Escape: anywhere in the panel's own leaf, or
        // nowhere in particular. Focus falls back to <body> whenever the
        // element holding it is unmounted, which this panel does routinely.
        const leaf = scope?.closest('.workspace-leaf') ?? scope;

        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            const unfocused = target === doc.body || target === doc.documentElement;
            const inScope =
                unfocused || (target instanceof Node && (leaf?.contains(target) ?? false));
            const { selectedCells: cells, toolIdOfCell: holds, category: grid } = latest.current;
            const { toolIds } = getSelectionDescriptor(cells, holds);

            if (
                !shouldOpenDeleteConfirmation({
                    event,
                    target,
                    targetCount: toolIds.length,
                    dragging,
                    // Any dialog at all, this plugin's or Obsidian's own: a
                    // second confirmation stacked on the first is never what
                    // the key meant.
                    modalOpen: doc.querySelector('.modal-container') !== null,
                    inScope,
                })
            ) {
                return;
            }
            // The one delete path, the same the menu uses — confirmation
            // included, and the selection dropped only once the write landed.
            deleteTools(toolIds, grid, clearCellSelection);
        };

        doc.addEventListener('keydown', onKeyDown);
        return () => {
            doc.removeEventListener('keydown', onKeyDown);
        };
    }, [hasSelection, dragging, scopeRef, deleteTools, clearCellSelection]);

    return null;
};
