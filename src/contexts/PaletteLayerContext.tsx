// PaletteLayerContext.tsx
// Which layer of a grid palette the panel is currently showing, and the
// resolved 4x4 arrangement that follows from it.
//
// In locked (consumption) mode the layer is decided by the context: base +
// the first matching context profile. In the management modes the user picks
// the layer explicitly in the palette's layer selector, and that choice drives
// what is rendered, what can be dragged and where a new tool is created.
//
// The resolution itself is pure (src/utils/paletteLayers.ts); this context only
// distributes it and owns the selection state.

import React, { createContext, useContext } from 'react';
import type { CategoryConfig } from '@/types/settings';
import {
    BASE_LAYER_ID,
    getContextProfiles,
    resolvePaletteLayer,
    type PaletteLayerId,
    type PaletteLayerSelection,
    type ResolvedPalette,
} from '@/utils/paletteLayers';

interface PaletteLayerValue {
    /** Resolved palette per grid category id (empty for flow categories). */
    palettes: ReadonlyMap<string, ResolvedPalette>;
    /** Layer the user selected for a palette; base when nothing is selected. */
    selection: PaletteLayerSelection;
    selectLayer: (categoryId: string, layerId: PaletteLayerId) => void;
    /** True in sort/edit mode, where the layer selector is shown. */
    manageable: boolean;
}

const EMPTY_PALETTES: ReadonlyMap<string, ResolvedPalette> = new Map();

const DEFAULT_VALUE: PaletteLayerValue = {
    palettes: EMPTY_PALETTES,
    selection: {},
    selectLayer: () => {},
    manageable: false,
};

const PaletteLayerContext = createContext<PaletteLayerValue>(DEFAULT_VALUE);

export const PaletteLayerProvider: React.FC<
    React.PropsWithChildren<PaletteLayerValue>
> = ({ palettes, selection, selectLayer, manageable, children }) => {
    const value = React.useMemo(
        () => ({ palettes, selection, selectLayer, manageable }),
        [palettes, selection, selectLayer, manageable]
    );
    return (
        <PaletteLayerContext.Provider value={value}>{children}</PaletteLayerContext.Provider>
    );
};

export function usePaletteLayers(): PaletteLayerValue {
    return useContext(PaletteLayerContext);
}

/**
 * Resolved palette of one category. Falls back to a locally computed base-layer
 * resolution so a renderer mounted outside the provider (drag overlays,
 * previews) still shows a correct grid.
 */
export function usePaletteResolution(category: CategoryConfig): ResolvedPalette {
    const { palettes } = usePaletteLayers();
    const resolved = palettes.get(category.id);
    return React.useMemo(
        () => resolved ?? resolvePaletteLayer(category, BASE_LAYER_ID),
        [resolved, category]
    );
}

/**
 * Layer the given palette is being edited on. A selection pointing at a
 * profile that no longer exists falls back to the base layer, so deleting a
 * profile can never leave the UI on a phantom layer.
 */
export function selectedLayerOf(
    category: CategoryConfig,
    selection: PaletteLayerSelection
): PaletteLayerId {
    const selected = selection[category.id];
    if (!selected || selected === BASE_LAYER_ID) {
        return BASE_LAYER_ID;
    }
    return getContextProfiles(category).some((profile) => profile.id === selected)
        ? selected
        : BASE_LAYER_ID;
}
