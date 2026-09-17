import { useCallback } from 'react';

/**
 * useRefresh Hook
 * 
 * Wraps the panel refresh behind a single entry point.
 * Dispatches the 'buttons-panel-refresh' event to refresh the panel.
 * 
 * @returns The refresh function
 */
export function useRefresh() {
    /**
     * Triggers a refresh of the buttons panel
     */
    const refresh = useCallback(() => {
        activeDocument.dispatchEvent(new CustomEvent('buttons-panel-refresh'));
    }, []);

    return {
        refresh,
    };
}

