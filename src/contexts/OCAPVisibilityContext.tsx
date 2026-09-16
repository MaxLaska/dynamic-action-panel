// OCAPVisibilityContext.tsx
// Distributes the sets of context-hidden button and category ids to the
// rendering components.
//
// In locked interaction mode conditioned buttons/categories are filtered out
// centrally (PanelContent -> projectCategoriesForContext); in sort/edit mode
// they stay rendered so the user can keep managing them, and this context
// lets SimpleButton and the category renderers mark them visually.

import React, { createContext, useContext } from 'react';
import { EMPTY_ID_SET } from '@/context/panelProjection';
import type { InteractionMode } from '@/types/settings';

const EMPTY_HIDDEN_IDS: ReadonlySet<string> = EMPTY_ID_SET;

interface OCAPVisibilityValue {
    hiddenButtonIds: ReadonlySet<string>;
    hiddenCategoryIds: ReadonlySet<string>;
    /**
     * Interaction mode, so renderers can pick the right presentation of the
     * persistent/contextual markers: management modes (sort/edit) show both
     * states explicitly, locked mode only hints at contextual elements.
     * Defaults to 'locked' (the quiet variant) when no provider is mounted.
     */
    interactionMode: InteractionMode;
}

const EMPTY_VISIBILITY: OCAPVisibilityValue = {
    hiddenButtonIds: EMPTY_HIDDEN_IDS,
    hiddenCategoryIds: EMPTY_HIDDEN_IDS,
    interactionMode: 'locked',
};

const OCAPVisibilityContext = createContext<OCAPVisibilityValue>(EMPTY_VISIBILITY);

interface OCAPVisibilityProviderProps {
    hiddenButtonIds: ReadonlySet<string>;
    hiddenCategoryIds: ReadonlySet<string>;
    interactionMode: InteractionMode;
}

export const OCAPVisibilityProvider: React.FC<
    React.PropsWithChildren<OCAPVisibilityProviderProps>
> = ({ hiddenButtonIds, hiddenCategoryIds, interactionMode, children }) => {
    const value = React.useMemo(
        () => ({ hiddenButtonIds, hiddenCategoryIds, interactionMode }),
        [hiddenButtonIds, hiddenCategoryIds, interactionMode]
    );
    return (
        <OCAPVisibilityContext.Provider value={value}>
            {children}
        </OCAPVisibilityContext.Provider>
    );
};

/** Ids of buttons currently hidden by their conditions (empty set when none). */
export function useContextHiddenButtonIds(): ReadonlySet<string> {
    return useContext(OCAPVisibilityContext).hiddenButtonIds;
}

/** Ids of categories whose own condition currently does not hold. */
export function useContextHiddenCategoryIds(): ReadonlySet<string> {
    return useContext(OCAPVisibilityContext).hiddenCategoryIds;
}

/** Current interaction mode ('locked' when no provider is mounted). */
export function useInteractionMode(): InteractionMode {
    return useContext(OCAPVisibilityContext).interactionMode;
}

export { EMPTY_HIDDEN_IDS };
