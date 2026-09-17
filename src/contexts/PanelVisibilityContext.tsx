// PanelVisibilityContext.tsx
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

interface PanelVisibilityValue {
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

const EMPTY_VISIBILITY: PanelVisibilityValue = {
    hiddenButtonIds: EMPTY_HIDDEN_IDS,
    hiddenCategoryIds: EMPTY_HIDDEN_IDS,
    interactionMode: 'locked',
};

const PanelVisibilityContext = createContext<PanelVisibilityValue>(EMPTY_VISIBILITY);

interface PanelVisibilityProviderProps {
    hiddenButtonIds: ReadonlySet<string>;
    hiddenCategoryIds: ReadonlySet<string>;
    interactionMode: InteractionMode;
}

export const PanelVisibilityProvider: React.FC<
    React.PropsWithChildren<PanelVisibilityProviderProps>
> = ({ hiddenButtonIds, hiddenCategoryIds, interactionMode, children }) => {
    const value = React.useMemo(
        () => ({ hiddenButtonIds, hiddenCategoryIds, interactionMode }),
        [hiddenButtonIds, hiddenCategoryIds, interactionMode]
    );
    return (
        <PanelVisibilityContext.Provider value={value}>
            {children}
        </PanelVisibilityContext.Provider>
    );
};

/** Ids of buttons currently hidden by their conditions (empty set when none). */
export function useContextHiddenButtonIds(): ReadonlySet<string> {
    return useContext(PanelVisibilityContext).hiddenButtonIds;
}

/** Ids of categories whose own condition currently does not hold. */
export function useContextHiddenCategoryIds(): ReadonlySet<string> {
    return useContext(PanelVisibilityContext).hiddenCategoryIds;
}

/** Current interaction mode ('locked' when no provider is mounted). */
export function useInteractionMode(): InteractionMode {
    return useContext(PanelVisibilityContext).interactionMode;
}

export { EMPTY_HIDDEN_IDS };
