// dragActivator.ts
// Which BUTTON starts which drag.
//
// One dnd-kit context serves two different drags, and the mouse grammar gives
// them different buttons (cell-selection-colors.md §3a):
//
//     a TOOL moves on a RIGHT drag   — the left button runs it, and its drag
//                                      is reserved
//     a CATEGORY moves on a LEFT drag from its grip — the grip has no other
//                                      meaning, so the ordinary button does it
//
// dnd-kit decides activation per SENSOR, not per draggable, so the sensor
// accepts both buttons (ScrollAwarePointerSensor) and each draggable filters
// the press here, where its own rule is visible.

import { pressCarriesSelectionModifier, type GridPointerPress } from '@/utils/gridPointerIntent';
import { Platform } from 'obsidian';

/** The listener map dnd-kit hands to a draggable. */
export type DragActivatorListeners = Record<string, unknown> | undefined;

interface ActivatorEvent extends GridPointerPress {
    stopPropagation?: () => void;
}

function isMacPlatform(): boolean {
    return Platform.isMacOS === true;
}

/**
 * Lets only a press on `button` reach dnd-kit's activator.
 *
 * `blockSelectionModifier` additionally ignores a press carrying Shift or
 * Ctrl/Cmd: outside a grid there is no cell to select, but the user holding a
 * selection modifier is building a selection, and a category that reorders
 * under their hand would be a surprise. Inside a grid the press never reaches
 * an activator anyway — the grid claims it in the capture phase.
 *
 * Returns the very same object when nothing needs wrapping, so a memoized
 * subtree does not re-render for it.
 */
export function activateOnButton<T extends DragActivatorListeners>(
    listeners: T,
    button: number,
    options: { blockSelectionModifier?: boolean } = {}
): T {
    if (!listeners || typeof listeners.onPointerDown !== 'function') {
        return listeners;
    }
    const activate = listeners.onPointerDown as (event: ActivatorEvent) => void;
    return {
        ...listeners,
        onPointerDown: (event: ActivatorEvent) => {
            if (event.button !== button) {
                return;
            }
            if (
                options.blockSelectionModifier === true &&
                pressCarriesSelectionModifier(event, isMacPlatform())
            ) {
                // The selection owns this press; nothing else may claim it,
                // not even by bubbling up to an ancestor handle.
                event.stopPropagation?.();
                return;
            }
            activate(event);
        },
    };
}
