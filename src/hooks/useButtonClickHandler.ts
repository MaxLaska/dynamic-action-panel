import { useCallback } from 'react';
import { useButtonActions } from './useButtonActions';
import { useInteractionMode } from '@/contexts/PanelVisibilityContext';
import { executesToolActions } from '@/utils/interactionMode';
import type { ButtonConfig } from '@/types';

/**
 * useButtonClickHandler Hook
 *
 * Wraps the click handling of a panel button.
 *
 * **Edit mode never executes a tool.** Locked mode is the consumption surface
 * and runs the actions; edit mode is the management surface, where activating a
 * tool means selecting the CELL it sits on (see
 * docs/ocap/cell-selection-colors.md). Before this, a click in edit mode ran
 * the tool's actions with no mode guard at all — a slipped click could fire a
 * script while the user was rearranging the panel.
 *
 * The guard sits HERE rather than in the two item components because a tool is
 * a real `<button>`: Enter and Space on a focused tool produce an ordinary
 * click event and arrive on exactly this path. One guard therefore covers the
 * pointer and the keyboard, and it cannot be bypassed by adding another item
 * component later.
 */
export function useButtonClickHandler(button: ButtonConfig) {
    const { executeButtonActions } = useButtonActions();
    const interactionMode = useInteractionMode();

    const handleButtonClick = useCallback(() => {
        if (!executesToolActions(interactionMode)) {
            return;
        }
        void executeButtonActions(button);
    }, [button, executeButtonActions, interactionMode]);

    return handleButtonClick;
}
