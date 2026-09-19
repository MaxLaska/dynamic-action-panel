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
 *   drag" — the same precedence the folder overlay already applies. A running
 *   modifier RECTANGLE counts as a drag here for exactly the same reason:
 *   Escape then means "cancel the rectangle and put the selection back where
 *   it started", which the gesture itself does. Without standing down, both
 *   handlers would fire on the one key and the cancel would end in an empty
 *   selection instead of the baseline the user began from.
 * - **Only from the panel — or from nowhere.** An Escape aimed at a modal, a
 *   suggester or the editor is none of our business. One aimed at <body>, i.e.
 *   at nothing, is: that is where focus lands when the element that had it is
 *   unmounted, which the panel does routinely (a replaced tool, a rebuilt
 *   block after a mode toggle), and an Escape that silently stops working
 *   after such a moment is indistinguishable from a broken one.
 *
 * Precedence over the folder overlay (which closes on Escape) does NOT depend
 * on this listener winning a race: the overlay checks `useHasCellSelection()`
 * itself, which is order-independent — both handlers sit on the same node in
 * the same phase, where `stopPropagation` would do nothing between them anyway.
 */
export const CellSelectionEscape: React.FC<CellSelectionEscapeProps> = ({ panelRef }) => {
    const { state, clearCellSelection, cellGestureActive } = useGridCellSelection();
    const buttonDrag = useButtonDragOptional();
    const hasSelection = state.cells.size > 0;
    const isDragging = (buttonDrag?.isDragging ?? false) || cellGestureActive;

    React.useEffect(() => {
        if (!hasSelection) {
            return;
        }
        const panel = panelRef.current;
        const doc = panel?.ownerDocument ?? document;
        // Where an Escape may come from and still mean "clear": anywhere in
        // the panel's own leaf — its toolbar included, where the mode toggle
        // lives — or from nowhere in particular. The second case is common:
        // the focused element is often UNMOUNTED under the user (a tool
        // replaced by a drop, a category block rebuilt by a mode toggle), and
        // focus then falls back to <body>. Nothing else claims an Escape
        // aimed at <body>; a modal, a menu or the editor would hold focus
        // themselves and are still none of our business.
        const scope = panel?.closest('.workspace-leaf') ?? panel;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || isDragging) {
                return;
            }
            const target = event.target;
            const unfocused = target === doc.body || target === doc.documentElement;
            if (!unfocused && (!(target instanceof Node) || !scope?.contains(target))) {
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
