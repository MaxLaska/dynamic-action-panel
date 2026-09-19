import { useCallback } from 'react';
import { useButtonActions } from './useButtonActions';
import type { ButtonConfig } from '@/types';

/**
 * useButtonClickHandler Hook
 *
 * Wraps the click handling of a panel button: activating a tool runs it, in
 * EITHER mode.
 *
 * There is deliberately no mode guard here any more. The modes differ only in
 * whether the layout may change (see src/utils/interactionMode.ts); running a
 * tool is operative and works whether the layout is locked or not.
 *
 * What stops a click from running a tool is decided BEFORE it gets here, by the
 * grid, in the capture phase (see CategoryButtonGrid): a click carrying a
 * selection modifier is a selection gesture, and the click that ends a layout
 * drag is not a click at all. Neither ever reaches this handler. Enter and
 * Space on a focused tool produce an ordinary click and arrive on this same
 * path, so the keyboard follows the same rule as the pointer.
 */
export function useButtonClickHandler(button: ButtonConfig) {
    const { executeButtonActions } = useButtonActions();

    return useCallback(() => {
        void executeButtonActions(button);
    }, [button, executeButtonActions]);
}
