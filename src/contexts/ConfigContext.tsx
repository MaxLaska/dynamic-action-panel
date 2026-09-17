import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { PanelConfig } from '@/types';

export interface ConfigContextValue {
    panelConfig: PanelConfig;
    setPanelConfig: (config: PanelConfig) => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

interface ConfigProviderProps {
    initialConfig: PanelConfig;
}

export const ConfigProvider: React.FC<React.PropsWithChildren<ConfigProviderProps>> = ({
    initialConfig,
    children,
}) => {
    const [panelConfig, updatePanelConfig] = useState<PanelConfig>(initialConfig);
    // Marks an internal setPanelConfig call, so the external prop sync does not overwrite it.
    const internalUpdateRef = useRef(false);

    // Sync the state when the external prop changes.
    useEffect(() => {
        if (internalUpdateRef.current) {
            internalUpdateRef.current = false;
            return;
        }
        updatePanelConfig(initialConfig);
    }, [initialConfig]);

    const setPanelConfig = useCallback((config: PanelConfig) => {
        internalUpdateRef.current = true;
        updatePanelConfig(config);
    }, []);

    return (
        <ConfigContext.Provider
            value={{
                panelConfig,
                setPanelConfig,
            }}
        >
            {children}
        </ConfigContext.Provider>
    );
};

export function useConfigContext(): ConfigContextValue {
    const ctx = useContext(ConfigContext);
    if (!ctx) {
        throw new Error('useConfigContext must be used within ConfigProvider');
    }
    return ctx;
}


