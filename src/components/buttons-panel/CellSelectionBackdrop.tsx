import React from 'react';
import { useButtonDragOptional, useCategoryDragOptional } from '@/contexts/ButtonDragContext';
import { useGridCellSelection } from '@/contexts/GridCellSelectionContext';
import { RESIZE_DRAG_THRESHOLD_PX } from '@/utils/categoryGrid';
import { isSelectionBackdrop } from '@/utils/selectionBackdrop';

interface CellSelectionBackdropProps {
    /** The panel subtree a click has to land in to mean "clear". */
    panelRef: React.RefObject<HTMLElement | null>;
}

/**
 * A click on empty panel background clears the cell selection.
 *
 * The second of the two ways out, next to Escape — and the one a hand reaches
 * for. It costs no button and no mode: everything that is not a control is
 * already doing nothing when clicked, so letting it mean "never mind" takes
 * nothing away.
 *
 * Three things keep it from stepping on anything:
 *
 * - **it decides on the CLICK, never on the press.** The same background is a
 *   category drag handle in list view, so clearing at pointer-down would
 *   destroy the selection at the start of every category drag. The press is
 *   only remembered; the decision waits until the gesture has proved to be a
 *   click;
 * - **a drag forfeits the click outright.** Travel past the shared 4px
 *   threshold is enough on its own, but a drag that wanders off and comes back
 *   ends near where it started — so an activated drag drops the remembered
 *   press as well, exactly as the grid does for its own cell clicks;
 * - **only genuinely inert surface counts** (`isSelectionBackdrop`). A cell, a
 *   tool, the category title, the palette, the resize frame and every ordinary
 *   control keep their own meaning; most of them stop the click themselves, and
 *   this is the backstop for the ones that do not.
 *
 * Listening on the panel element rather than the document is deliberate: a
 * click in the editor, a modal or another leaf is none of our business, and
 * nothing here ever stops an event.
 */
export const CellSelectionBackdrop: React.FC<CellSelectionBackdropProps> = ({
    panelRef,
}) => {
    const { state, clearCellSelection, cellGestureActive } = useGridCellSelection();
    const buttonDrag = useButtonDragOptional();
    const categoryDrag = useCategoryDragOptional();
    const hasSelection = state.cells.size > 0;
    const isDragging =
        (buttonDrag?.isDragging ?? false) ||
        (categoryDrag?.isDragging ?? false) ||
        cellGestureActive;

    /** Where the press started, or null once it can no longer be a click. */
    const pressOriginRef = React.useRef<{ x: number; y: number } | null>(null);

    // A drag that actually started forfeits its click, wherever the pointer
    // ends up. Without this, dragging a category away and back again would
    // release near the origin and read as a click on the background.
    React.useEffect(() => {
        if (isDragging) {
            pressOriginRef.current = null;
        }
    }, [isDragging]);

    React.useEffect(() => {
        const panel = panelRef.current;
        if (!hasSelection || !panel) {
            return;
        }

        const onPointerDown = (event: PointerEvent) => {
            pressOriginRef.current =
                event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
        };

        const onClick = (event: MouseEvent) => {
            const origin = pressOriginRef.current;
            pressOriginRef.current = null;
            if (origin === null || isDragging) {
                return;
            }
            // The same euclidean threshold the drag sensor and every other
            // click check in the panel use, so "click" and "drag" stay exact
            // complements.
            const dx = event.clientX - origin.x;
            const dy = event.clientY - origin.y;
            if (Math.sqrt(dx * dx + dy * dy) > RESIZE_DRAG_THRESHOLD_PX) {
                return;
            }
            if (!isSelectionBackdrop(event.target, panel)) {
                return;
            }
            clearCellSelection();
        };

        // Capture for the press so it is recorded even where a control stops
        // the event, bubble for the click so anything that claims it first
        // (the category title, a tool, the palette) keeps its meaning.
        panel.addEventListener('pointerdown', onPointerDown, true);
        panel.addEventListener('click', onClick);
        return () => {
            panel.removeEventListener('pointerdown', onPointerDown, true);
            panel.removeEventListener('click', onClick);
        };
    }, [hasSelection, isDragging, panelRef, clearCellSelection]);

    return null;
};
