// useOCAPContext.ts
// React subscription to the OCAPContextService via useSyncExternalStore.
// The service itself is React-free; this hook is the only bridge.

import React from 'react';
import { usePluginContext } from '@/contexts/PluginContext';
import type { OCAPContextSnapshot } from '@/context/OCAPContext';

/**
 * Current OCAP context snapshot, re-rendering the caller only when the
 * snapshot reference changes (the service already guarantees referential
 * stability while the context is semantically unchanged).
 */
export function useOCAPContext(): OCAPContextSnapshot {
    const { plugin } = usePluginContext();
    const service = plugin.contextService;

    const subscribe = React.useCallback(
        (onStoreChange: () => void) => service.subscribe(onStoreChange),
        [service]
    );
    const getSnapshot = React.useCallback(() => service.getSnapshot(), [service]);

    return React.useSyncExternalStore(subscribe, getSnapshot);
}
