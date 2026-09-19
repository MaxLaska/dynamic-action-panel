import React from 'react';
import { useGridCellSelection } from '@/contexts/GridCellSelectionContext';
import { gestureOfEvent } from '@/utils/cellSelectionGesture';
import type { SelectionModifierFlags } from '@/utils/gridCellSelection';

interface CellSelectionModifierCursorProps {
    /** The panel element the state class is put on. */
    panelRef: React.RefObject<HTMLElement | null>;
}

/**
 * The attribute that switches the grids to a selection cursor (the cursor
 * model in PaletteGrid.css): `add` while Shift decides, `remove` while
 * Ctrl/Cmd does, absent otherwise.
 */
export const SELECTION_INTENT_ATTRIBUTE = 'data-ocap-selection-intent';

/**
 * Shows, before anything is pressed, that a press will SELECT rather than use
 * or move: while Shift or Ctrl/Cmd is held, the grids wear the selection cursor.
 *
 * Purely visual. Nothing here decides what a press means — that stays with the
 * grid's click and pointer handlers, which read the modifier from the event
 * itself. This only mirrors the same question (`gestureOfEvent`, so macOS' Ctrl
 * — the secondary click — does NOT count and Cmd does, and with both keys held
 * Shift wins exactly as it does for the press) onto an attribute.
 *
 * Three sources keep the attribute honest, because each alone misses a case:
 * - `keydown` / `keyup` make it change the moment the key moves, without the
 *   mouse having to;
 * - `pointermove` carries the modifier state with every movement, which
 *   corrects a key pressed or released while the window did not have focus;
 * - `blur` clears it, because a key released outside the window never sends
 *   its `keyup` here.
 *
 * Listening on the document is needed to see the keys, but nothing here ever
 * stops or cancels an event, and the attribute only ever touches this panel.
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
        return trackSelectionIntent(panel);
    }, [panelRef, available]);

    return null;
};

/**
 * Mirrors the held selection modifier onto `panel` until the returned
 * function is called, which removes every listener and the attribute.
 *
 * A plain function rather than the effect body so the behaviour — not just
 * its source text — can be exercised without a DOM.
 */
export function trackSelectionIntent(panel: HTMLElement): () => void {
    const doc = panel.ownerDocument;
    const win = doc.defaultView;

    const clear = () => panel.removeAttribute(SELECTION_INTENT_ATTRIBUTE);
    const apply = (flags: SelectionModifierFlags) => {
        const gesture = gestureOfEvent(flags);
        if (gesture === 'add' || gesture === 'remove') {
            panel.setAttribute(SELECTION_INTENT_ATTRIBUTE, gesture);
        } else {
            clear();
        }
    };
    const onKey = (event: KeyboardEvent) => apply(event);
    const onPointer = (event: PointerEvent) => apply(event);

    doc.addEventListener('keydown', onKey);
    doc.addEventListener('keyup', onKey);
    doc.addEventListener('pointermove', onPointer);
    win?.addEventListener('blur', clear);
    return () => {
        doc.removeEventListener('keydown', onKey);
        doc.removeEventListener('keyup', onKey);
        doc.removeEventListener('pointermove', onPointer);
        win?.removeEventListener('blur', clear);
        clear();
    };
}
