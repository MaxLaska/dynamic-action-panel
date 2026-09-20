// cellSelectionGesture.ts
// The one place that turns a real browser event into a selection gesture.
//
// The rules themselves are pure (src/utils/gridCellSelection.ts); this module
// only supplies the platform fact they need, so no component has to know that
// Ctrl means something different on macOS.

import { Platform } from 'obsidian';
import {
    gridPointerIntent,
    type GridPointerIntent,
    type GridPointerPress,
} from '@/utils/gridPointerIntent';
import {
    cellGestureOf,
    hasSelectionModifierFlags,
    type CellSelectionGesture,
    type SelectionModifierFlags,
} from '@/utils/gridCellSelection';

function isMacPlatform(): boolean {
    return Platform.isMacOS === true;
}

/** The gesture this activation means, or null when it must be ignored. */
export function gestureOfEvent(
    event: SelectionModifierFlags
): CellSelectionGesture | null {
    return cellGestureOf(event, isMacPlatform());
}

/**
 * Whether this activation carries a selection modifier.
 *
 * Used by affordances that must step aside during a multi-select — the empty
 * cell's `+`, which would otherwise open a create modal on a stray corner hit.
 */
export function hasSelectionModifier(event: SelectionModifierFlags): boolean {
    return hasSelectionModifierFlags(event, isMacPlatform());
}

/**
 * What a press means, from its button and its modifiers (the mouse grammar of
 * `gridPointerIntent`). Same job as `gestureOfEvent` above, for the surfaces
 * where the BUTTON carries part of the meaning — which is the grid.
 */
export function pointerIntentOfEvent(press: GridPointerPress): GridPointerIntent {
    return gridPointerIntent(press, isMacPlatform());
}
