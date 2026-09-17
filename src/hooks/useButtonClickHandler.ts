import { useCallback } from 'react';
import { useButtonActions } from './useButtonActions';
import type { ButtonConfig } from '@/types';

/**
 * useButtonClickHandler Hook
 *
 * Wraps the click handling of a panel button.
 */
export function useButtonClickHandler(button: ButtonConfig) {
    const { executeButtonActions } = useButtonActions();

    const handleButtonClick = useCallback(() => {
        void executeButtonActions(button);
    }, [button, executeButtonActions]);

    return handleButtonClick;
}
