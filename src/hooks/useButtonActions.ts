import { useCallback } from 'react';
import { Notice } from 'obsidian';
import { useActionDispatcher } from './useActionDispatcher';
import { t } from '@/utils/i18n';
import type { ButtonConfig } from '@/types';

/**
 * useButtonActions Hook
 * 
 * Wraps the button action execution behind a ready-made click handler.
 * The execution mode, error policy and delay of the button are applied automatically.
 * 
 * @returns A function that runs the actions of a button
 */
export function useButtonActions() {
    const { executeActions } = useActionDispatcher();

    /**
     * Runs every action of the button
     * @param button Button configuration
     */
    const executeButtonActions = useCallback(
        async (button: ButtonConfig) => {
            // A tool may legitimately exist before its action does (name,
            // icon and slot first — see ActionSequence.collectConfiguredActions).
            // Running it then has to SAY so: silence would read as a broken
            // button, and inventing a fallback action would be worse.
            if (!button.actions || button.actions.length === 0) {
                new Notice(t('button_no_action'));
                return;
            }

            await executeActions(
                button.actions,
                button.executionMode || 'sequential',
                button.stopOnError ?? true,
                button.delayBetweenActions ?? 100
            );
        },
        [executeActions]
    );

    return {
        executeButtonActions,
    };
}

