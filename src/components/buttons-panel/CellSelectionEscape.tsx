import React from 'react';
import { useButtonDragOptional } from '@/contexts/ButtonDragContext';
import { useGridCellSelection } from '@/contexts/GridCellSelectionContext';

interface CellSelectionEscapeProps {
    /** The panel subtree an Escape has to come from to mean "clear". */
    panelRef: React.RefObject<HTMLElement | null>;
}

/**
 * Escape clears the cell selection.
 *
 * It lives in its own component, mounted INSIDE the drag provider, because the
 * rule needs `isDragging` — and `PanelContent`, which owns the selection state,
 * sits above that provider.
 *
 * Three properties matter, and each of them was a bug in the first version:
 *
 * - **It never stops the event.** A capture-phase listener on the document that
 *   called `stopPropagation()` for every Escape silently disabled every other
 *   Escape handler in the app for as long as a selection existed: dnd-kit's
 *   drag cancel and the grid-resize cancel both listen on the document in the
 *   BUBBLE phase and would never have been reached, the folder's inline rename
 *   is a React handler on the root container, and Obsidian's own modals and
 *   menus are not document-capture listeners either. Clearing a selection must
 *   not be able to trap a user inside a dialog.
 * - **A drag wins.** While a tool is being dragged, Escape means "cancel this
 *   drag" — the same precedence the folder overlay already applies.
 * - **Only from inside the panel.** An Escape aimed at a modal, a suggester or
 *   the editor is none of our business.
 *
 * Precedence over the folder overlay (which closes on Escape) does NOT depend
 * on this listener winning a race: the overlay checks `useHasCellSelection()`
 * itself, which is order-independent — both handlers sit on the same node in
 * the same phase, where `stopPropagation` would do nothing between them anyway.
 */
export const CellSelectionEscape: React.FC<CellSelectionEscapeProps> = ({ panelRef }) => {
    const { state, clearCellSelection } = useGridCellSelection();
    const buttonDrag = useButtonDragOptional();
    const hasSelection = state.cells.size > 0;
    const isDragging = buttonDrag?.isDragging ?? false;

    React.useEffect(() => {
        if (!hasSelection) {
            return;
        }
        const panel = panelRef.current;
        const doc = panel?.ownerDocument ?? document;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || isDragging) {
                return;
            }
            const target = event.target;
            if (!(target instanceof Node) || !panel?.contains(target)) {
                return;
            }
            clearCellSelection();
        };
        doc.addEventListener('keydown', onKeyDown);
        return () => {
            doc.removeEventListener('keydown', onKeyDown);
        };
    }, [hasSelection, isDragging, panelRef, clearCellSelection]);

    return null;
};
