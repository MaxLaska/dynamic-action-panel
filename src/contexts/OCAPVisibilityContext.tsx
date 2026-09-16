// OCAPVisibilityContext.tsx
// Distributes the set of context-hidden button ids to button components.
//
// In locked interaction mode conditioned buttons are filtered out centrally
// (PanelContent); in sort/edit mode they stay rendered so the user can keep
// managing them, and this context lets SimpleButton mark them visually.

import React, { createContext, useContext } from 'react';

const EMPTY_HIDDEN_IDS: ReadonlySet<string> = new Set<string>();

const OCAPVisibilityContext = createContext<ReadonlySet<string>>(EMPTY_HIDDEN_IDS);

interface OCAPVisibilityProviderProps {
    hiddenButtonIds: ReadonlySet<string>;
}

export const OCAPVisibilityProvider: React.FC<
    React.PropsWithChildren<OCAPVisibilityProviderProps>
> = ({ hiddenButtonIds, children }) => (
    <OCAPVisibilityContext.Provider value={hiddenButtonIds}>
        {children}
    </OCAPVisibilityContext.Provider>
);

/** Ids of buttons currently hidden by their conditions (empty set when none). */
export function useContextHiddenButtonIds(): ReadonlySet<string> {
    return useContext(OCAPVisibilityContext);
}

export { EMPTY_HIDDEN_IDS };
