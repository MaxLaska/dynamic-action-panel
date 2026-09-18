// dragSelectionGuard.ts
// One rule, applied wherever dnd-kit's activator listeners are bound:
//
//     a press that carries a SELECTION modifier never starts a drag.
//
// Shift and Ctrl/Cmd mean "I am building a cell selection" (see
// docs/ocap/cell-selection-colors.md §4 and §4a). The gesture is decided at
// pointer-down and nowhere else: a plain press stays a drag for its whole life
// even if Shift is pressed later, and a modifier press never turns into a drag
// even if the modifier is released mid-gesture. Anything else would let the
// meaning of a gesture change under the user's hand.
//
// Inside a grid the guard is not needed — `CategoryButtonGrid` stops such a
// press in the CAPTURE phase, before it can reach any descendant's activator.
// This wrapper covers the surfaces OUTSIDE a grid that are themselves drag
// handles: the list-view category block's header, the category tabs and the
// folder tiles. There a modifier press starts nothing at all; the header is not
// a cell, so there is no rectangle to begin either.
//
// The guard is per-press and holds no state, so nothing can stay "stuck off"
// after a key-up.

import type React from 'react';
import { hasSelectionModifier } from '@/utils/cellSelectionGesture';

/**
 * dnd-kit's activator listeners, structurally.
 *
 * Typed loosely on purpose: `SyntheticListenerMap` lives behind a deep import
 * path in `@dnd-kit/core`, and pinning it here would tie this module to the
 * library's file layout for no gain.
 */
export type DragActivatorListeners = Record<string, unknown>;

/** The pointer activator of a listener map, or null when it has none. */
function pointerActivatorOf(
    listeners: DragActivatorListeners
): ((event: React.PointerEvent) => void) | null {
    const activator = listeners.onPointerDown;
    if (typeof activator !== 'function') {
        return null;
    }
    // dnd-kit types its activator map as `Record<string, Function>`, so the
    // narrowing above lands on the bare `Function` type and the concrete
    // signature has to be stated here.
    return activator as (event: React.PointerEvent) => void;
}

/**
 * The same listeners, with `onPointerDown` wrapped so a selection modifier
 * suppresses the drag.
 *
 * Only the pointer activator is wrapped: the touch sensor activates on
 * `onTouchStart`, and a touch carries no Shift or Ctrl — touch behaviour is
 * deliberately left exactly as it is.
 */
export function suppressDragOnSelectionModifier<T extends DragActivatorListeners>(
    listeners: T | undefined
): T | undefined {
    if (!listeners) {
        return listeners;
    }
    const start = pointerActivatorOf(listeners);
    if (start === null) {
        return listeners;
    }
    return {
        ...listeners,
        onPointerDown: (event: React.PointerEvent) => {
            if (hasSelectionModifier(event)) {
                // Not merely "do not start": the press must not reach an
                // ancestor handle either, or a modifier press on a tab would
                // still drag whatever contains it.
                event.stopPropagation();
                return;
            }
            start(event);
        },
    };
}
