import React from 'react';
import { useGridCellSelection } from '@/contexts/GridCellSelectionContext';
import { gestureOfEvent } from '@/utils/cellSelectionGesture';
import type { SelectionModifierFlags } from '@/utils/gridCellSelection';

interface CellSelectionModifierCursorProps {
    /** The panel element the state class is put on. */
    panelRef: React.RefObject<HTMLElement | null>;
}

/** The class that switches the grids to the selection cursor (PaletteGrid.css). */
export const SELECTION_MODIFIER_CLASS = 'ocap-selection-modifier';

/**
 * Shows, before anything is pressed, that a press will SELECT rather than use
 * or move: while Shift or Ctrl/Cmd is held, the grids wear the selection cursor.
 *
 * Purely visual. Nothing here decides what a press means — that stays with the
 * grid's click and pointer handlers, which read the modifier from the event
 * itself. This only mirrors the same question (`gestureOfEvent`, so macOS' Ctrl
 * — the secondary click — does NOT count and Cmd does) onto a class.
 *
 * Three sources keep the class honest, because each alone misses a case:
 * - `keydown` / `keyup` make it change the moment the key moves, without the
 *   mouse having to;
 * - `pointermove` carries the modifier state with every movement, which
 *   corrects a key pressed or released while the window did not have focus;
 * - `blur` clears it, because a key released outside the window never sends
 *   its `keyup` here.
 *
 * Listening on the document is needed to see the keys, but nothing here ever
 * stops or cancels an event, and the class only ever touches this panel.
 */
export const CellSelectionModifierCursor: React.FC<CellSelectionModifierCursorProps> = ({
    panelRef,
}) => {
    const { available } = useGridCellSelection();

    React.useEffect(() => {
        const panel = panelRef.current;
        if (!panel || !available) {
            return;
        }
        const doc = panel.ownerDocument;
        const win = doc.defaultView;

        const apply = (flags: SelectionModifierFlags) => {
            const gesture = gestureOfEvent(flags);
            panel.classList.toggle(
                SELECTION_MODIFIER_CLASS,
                gesture === 'add' || gesture === 'remove'
            );
        };
        const onKey = (event: KeyboardEvent) => apply(event);
        const onPointer = (event: PointerEvent) => apply(event);
        const onBlur = () => panel.classList.remove(SELECTION_MODIFIER_CLASS);

        doc.addEventListener('keydown', onKey);
        doc.addEventListener('keyup', onKey);
        doc.addEventListener('pointermove', onPointer);
        win?.addEventListener('blur', onBlur);
        return () => {
            doc.removeEventListener('keydown', onKey);
            doc.removeEventListener('keyup', onKey);
            doc.removeEventListener('pointermove', onPointer);
            win?.removeEventListener('blur', onBlur);
            panel.classList.remove(SELECTION_MODIFIER_CLASS);
        };
    }, [panelRef, available]);

    return null;
};
