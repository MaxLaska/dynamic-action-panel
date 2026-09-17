// domain/tools.ts
// The tool registry half of the v5 model: pure helpers that connect
// ToolDefinition + ToolPlacement (the stored shapes) with ButtonConfig (the
// runtime view shape the renderers, drag state and modals consume).
//
// Design (see docs/ocap/audits/2026-09-17-architecture-audit-target-model.md):
// - a stored button is split into its functional definition (registry) and
//   its placement (category/variant). Materialization is the ONLY place the
//   two are joined back into a ButtonConfig-shaped view object;
// - `library` is a lifecycle metadatum, not a structural difference: an
//   ad-hoc tool and a library tool are the same kind of object;
// - garbage collection is deterministic and runs ONLY inside explicit
//   remove/delete operations (src/domain/categoryOps.ts) — never during
//   previews, drag rewrites or in the background, and never via stored
//   reference counts. References are computed from the current state.
//
// Everything here is pure and mutation-free.

import type {
    ButtonConfig,
    CategoryConfig,
    CategoryVariant,
    StoredCategory,
    StoredVariant,
    ToolDefinition,
    ToolPlacement,
    ToolRegistry,
} from '@/types/settings';
import {
    placeButtonsOnGrid,
    type GridDimensions,
} from '@/utils/categoryGrid';

// --- Definition <-> button (view) conversion ---------------------------------

/**
 * The functional half of a button: everything except its positional fields.
 * Unknown extra fields are carried along (`...rest`), so hand-added data on a
 * button survives the split.
 */
export function buttonToDefinition(button: ButtonConfig): ToolDefinition {
    const { order: _order, slot: _slot, ...rest } = button;
    return rest;
}

/**
 * Materialize one placed tool as the ButtonConfig the runtime consumes.
 * `order` is the placement's array index (deterministic tiebreaker for the
 * grid self-healing, the flow order itself for flow categories); `slot` is
 * only present when the placement carries one. The `library` flag is a
 * lifecycle metadatum and deliberately not part of the view shape.
 */
export function definitionToButton(
    definition: ToolDefinition,
    order: number,
    slot?: number
): ButtonConfig {
    const { library: _library, ...rest } = definition;
    return {
        ...(rest as ButtonConfig),
        id: definition.id,
        order,
        ...(slot !== undefined ? { slot } : {}),
    };
}

/**
 * Materialize a placement list. A placement whose definition is missing
 * (corrupt data — the operations keep registry and placements consistent) is
 * skipped with a warning rather than rendered as a broken ghost.
 */
export function materializeButtons(
    placements: readonly ToolPlacement[],
    tools: ToolRegistry
): ButtonConfig[] {
    const buttons: ButtonConfig[] = [];
    for (const placement of placements) {
        const definition = tools[placement.toolId];
        if (!definition) {
            console.warn(
                `[OCAP] Placement references unknown tool "${placement.toolId}"; skipping.`
            );
            continue;
        }
        buttons.push(definitionToButton(definition, buttons.length, placement.slot));
    }
    return buttons;
}

function materializeVariant(variant: StoredVariant, tools: ToolRegistry): CategoryVariant {
    const { placements, ...rest } = variant;
    return { ...rest, buttons: materializeButtons(placements, tools) };
}

/**
 * Materialize one stored category as the runtime CategoryConfig view. The
 * result is a projection copy: rendering reads it, but every write path
 * resolves the STORED category by id (findStoredCategory) — exactly the
 * contract the projection copies of locked mode and search already had.
 */
export function materializeCategory(
    stored: StoredCategory,
    tools: ToolRegistry
): CategoryConfig {
    const { placements, variants, ...rest } = stored;
    const view: CategoryConfig = {
        ...rest,
        buttons: materializeButtons(placements ?? [], tools),
    };
    if (Array.isArray(variants)) {
        view.variants = variants.map((variant) => materializeVariant(variant, tools));
    }
    return view;
}

/**
 * Per-object memo: an unchanged stored category with an unchanged registry
 * materializes to the identical view object, so memoized React subtrees keep
 * their identity across commits that touched other categories. A registry
 * change invalidates everything (a definition edit must re-render every
 * placement of that tool).
 */
const viewCache = new WeakMap<
    StoredCategory,
    { tools: ToolRegistry; view: CategoryConfig }
>();

export function materializeCategoriesForRuntime(
    categories: readonly StoredCategory[],
    tools: ToolRegistry
): CategoryConfig[] {
    return categories.map((stored) => {
        const cached = viewCache.get(stored);
        if (cached && cached.tools === tools) {
            return cached.view;
        }
        const view = materializeCategory(stored, tools);
        viewCache.set(stored, { tools, view });
        return view;
    });
}

// --- Stored-shape placement helpers ------------------------------------------

/**
 * Deterministic slot resolution for stored grid placements, sharing the ONE
 * self-healing implementation (placeButtonsOnGrid): placements with a valid,
 * free slot keep it; missing/out-of-range/duplicate slots get the lowest free
 * slot in array order; what does not fit becomes overflow (never dropped).
 */
export function placeStoredGrid(
    placements: readonly ToolPlacement[],
    dimensions: GridDimensions
): { slots: (ToolPlacement | null)[]; overflow: ToolPlacement[] } {
    // Placeholder buttons: the index is the id, so two placements of the same
    // tool (possible once library tools can be placed twice) stay distinct.
    const placeholders: ButtonConfig[] = placements.map((placement, index) => ({
        id: String(index),
        name: '',
        actions: [],
        order: index,
        ...(placement.slot !== undefined ? { slot: placement.slot } : {}),
    }));
    const placed = placeButtonsOnGrid(placeholders, dimensions);
    const at = (button: ButtonConfig): ToolPlacement => placements[Number(button.id)]!;
    return {
        slots: placed.slots.map((button) => (button ? at(button) : null)),
        overflow: placed.overflow.map(at),
    };
}

/** Slot occupancy (tool ids) of stored grid placements; null = empty. */
export function storedGridSlotToolIds(
    placements: readonly ToolPlacement[],
    dimensions: GridDimensions
): (string | null)[] {
    return placeStoredGrid(placements, dimensions).slots.map(
        (placement) => placement?.toolId ?? null
    );
}

// --- Decomposition (view buttons -> placements) --------------------------------

/** Grid decomposition: each button's slot becomes the placement's slot. */
export function gridPlacementsFromButtons(
    buttons: readonly ButtonConfig[]
): ToolPlacement[] {
    return buttons.map((button) => ({
        toolId: button.id,
        ...(button.slot !== undefined ? { slot: button.slot } : {}),
    }));
}

/** Flow decomposition: array order is the order; no slots. */
export function flowPlacementsFromButtons(
    buttons: readonly ButtonConfig[]
): ToolPlacement[] {
    return buttons.map((button) => ({ toolId: button.id }));
}

// --- Category-level lookups ----------------------------------------------------

/** Stored variant holding a placement of `toolId`, or null (static/flow/absent). */
export function findToolVariantId(
    category: Pick<StoredCategory, 'variants'>,
    toolId: string
): string | null {
    for (const variant of category.variants ?? []) {
        if (variant.placements?.some((placement) => placement.toolId === toolId)) {
            return variant.id;
        }
    }
    return null;
}

/** Every placement of a stored category: own list plus each variant's. */
export function allCategoryPlacements(category: StoredCategory): ToolPlacement[] {
    const placements = [...(category.placements ?? [])];
    for (const variant of category.variants ?? []) {
        placements.push(...(variant.placements ?? []));
    }
    return placements;
}

// --- Garbage collection ---------------------------------------------------------

/** Every tool id any placement in the given categories references. */
export function collectReferencedToolIds(
    categories: readonly StoredCategory[]
): Set<string> {
    const referenced = new Set<string>();
    for (const category of categories) {
        for (const placement of allCategoryPlacements(category)) {
            referenced.add(placement.toolId);
        }
    }
    return referenced;
}

/**
 * The GC rule, applied to an explicit candidate set: a candidate definition
 * is removed exactly when nothing references it anymore AND it is not a
 * library tool. Everything else — including unreferenced library tools —
 * stays. Returns the same registry object when nothing is removed, so an
 * unchanged registry keeps its identity (the materialization cache and React
 * memo comparisons rely on that).
 */
export function gcTools(
    tools: ToolRegistry,
    categories: readonly StoredCategory[],
    candidateIds: Iterable<string>
): ToolRegistry {
    const candidates = [...new Set(candidateIds)];
    if (candidates.length === 0) {
        return tools;
    }
    const referenced = collectReferencedToolIds(categories);
    const removable = candidates.filter((id) => {
        const definition = tools[id];
        return definition !== undefined && definition.library !== true && !referenced.has(id);
    });
    if (removable.length === 0) {
        return tools;
    }
    const next = { ...tools };
    for (const id of removable) {
        delete next[id];
    }
    return next;
}
