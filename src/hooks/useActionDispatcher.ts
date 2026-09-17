import { useMemo } from 'react';
import { ActionDispatcher } from '@/services/ActionDispatcher';
import { usePluginContext } from '@/contexts/PluginContext';
import type { ButtonAction } from '@/types';

/**
 * useActionDispatcher Hook
 * 
 * Wraps the ActionDispatcher behind a type-safe interface for running actions.
 * Reads app and plugin from PluginContext and creates or reuses the ActionDispatcher instance.
 * 
 * @returns The executeActions method of the ActionDispatcher
 */
export function useActionDispatcher() {
    const { plugin, app } = usePluginContext();

    // Memoize the ActionDispatcher so it is not recreated on every render.
    const dispatcher = useMemo(() => {
        // Prefer an actionDispatcher the plugin already owns (backwards compatible).
        const existingDispatcher = plugin.actionDispatcher as ActionDispatcher | null | undefined;
        if (existingDispatcher && typeof existingDispatcher.executeActions === 'function') {
            return existingDispatcher;
        }
        // Otherwise create a new instance.
        return new ActionDispatcher(app, plugin);
    }, [app, plugin]);

    /**
     * Runs the action sequence of a button
     * @param actions Button actions to run
     * @param executionMode 'sequential' or 'parallel'
     * @param stopOnError Whether to abort on the first error (sequential mode only)
     * @param delayBetweenActions Delay between actions in milliseconds (sequential mode only)
     */
    const executeActions = useMemo(
        () =>
            async (
                actions: ButtonAction[],
                executionMode: 'sequential' | 'parallel' = 'sequential',
                stopOnError: boolean = true,
                delayBetweenActions: number = 100
            ) => {
                await dispatcher.executeActions(actions, executionMode, stopOnError, delayBetweenActions);
            },
        [dispatcher]
    );

    return {
        executeActions,
        dispatcher,
    };
}

