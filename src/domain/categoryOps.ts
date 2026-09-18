// domain/categoryOps.ts
// The settings-level write operations of the v5 model: every mutation that
// touches tool placements and/or the tool registry goes through one of these
// pure functions. Hooks and modals resolve ids, call an operation, and commit
// the result through commitToolState (src/utils/categoryStore.ts) — they
// never edit placement arrays or the registry by hand.
//
// Lifecycle rule (decided in the architecture audit, F1/A6):
// - creating a tool (modal `+`, file drop, copy) registers a definition and
//   adds a placement in ONE step;
// - removing a placement garbage-collects the definition exactly when it is
//   not `library: true` and no other placement references it — the pre-v5
//   behavior, where a button existed only on its grid;
// - GC runs ONLY here, inside explicit remove/delete operations. Drag
//   rewrites, previews and moves never collect: a move is one atomic commit
//   whose result still references the tool.
//
// Everything is pure and deterministic; nothing here persists or renders.

import type {
    ButtonConfig,
    CategoryConfig,
    GridCellStyleFields,
    GridCellStyles,
    StoredCategory,
    StoredVariant,
    ToolDefinition,
    ToolPlacement,
    ToolRegistry,
} from '@/types/settings';
import {
    cloneGridCellStyles,
    findFirstFreeSlot,
    getCategoryLayout,
    gridSlotCount,
    isCellKeyInsideGrid,
    isGridCategory,
    isGridCellColor,
    isValidSlotIndex,
    readGridDimensions,
    resizeGridButtons,
    resizeGridCellStyles,
    sameGridDimensions,
    clampGridDimensions,
    withCellStyles,
    type CategoryLayout,
    type GridDimensions,
} from '@/utils/categoryGrid';
import {
    findFallbackVariant,
    findVariant,
    getCategoryVariants,
    gridDimensionsOf,
    isDynamicCategory,
    removeVariant,
    convertCategoryToGrid,
    type GridConversionResult,
    type VariantDraft,
} from '@/utils/categoryVariants';
import {
    buttonToDefinition,
    findToolVariantId,
    flowPlacementsFromButtons,
    gcTools,
    gridPlacementsFromButtons,
    materializeCategory,
    placeStoredGrid,
    storedGridSlotToolIds,
} from '@/domain/tools';

/** The slice of the settings the write operations transform. */
export interface ToolState {
    tools: ToolRegistry;
    categories: StoredCategory[];
}

// --- Internal helpers ----------------------------------------------------------

function findCategory(state: ToolState, categoryId: string): StoredCategory | null {
    return state.categories.find((category) => category.id === categoryId) ?? null;
}

function withCategory(state: ToolState, next: StoredCategory): ToolState {
    return {
        tools: state.tools,
        categories: state.categories.map((category) =>
            category.id === next.id ? next : category
        ),
    };
}

function replaceVariantPlacements(
    category: StoredCategory,
    variantId: string,
    placements: ToolPlacement[]
): StoredCategory {
    return {
        ...category,
        variants: (category.variants ?? []).map((variant) =>
            variant.id === variantId ? { ...variant, placements } : variant
        ),
    };
}

/** Placements of one grid target (a variant, or the static grid itself). */
function gridTargetPlacements(
    category: StoredCategory,
    variantId: string | null
): ToolPlacement[] {
    if (variantId === null) {
        return category.placements ?? [];
    }
    return findVariant(category, variantId)?.placements ?? [];
}

/**
 * Resolve the variant a grid write addresses: the explicit one, or — for a
 * dynamic category without an explicit target — the first variant. Returns
 * `{ ok: false }` for a dynamic category without any variant (no home).
 */
function resolveGridVariantId(
    category: StoredCategory,
    variantId: string | null
): { ok: true; variantId: string | null } | { ok: false } {
    if (variantId !== null || !isDynamicCategory(category)) {
        return { ok: true, variantId };
    }
    const first = getCategoryVariants(category)[0];
    return first ? { ok: true, variantId: first.id } : { ok: false };
}

/** Preserve the stored-only `library` flag across a view-shaped update. */
function mergeDefinition(
    existing: ToolDefinition | undefined,
    next: ToolDefinition
): ToolDefinition {
    if (existing?.library === true && next.library !== true) {
        return { ...next, library: true };
    }
    return next;
}

function deepCopyDefinition(definition: ToolDefinition, newId: string): ToolDefinition {
    const { library: _library, ...rest } = definition;
    return {
        ...rest,
        id: newId,
        actions: definition.actions?.map((action) => ({ ...action })) ?? [],
    };
}

/**
 * Set (or drop) the cell styles of one grid object. Dropping has to REMOVE the
 * field rather than write `undefined`, so a grid without styled cells keeps
 * serializing exactly like data written before cell styles existed.
 */
function setCellStyles<T extends GridCellStyleFields>(
    target: T,
    styles: GridCellStyles | undefined
): T {
    if (styles === undefined) {
        if (target.cellStyles === undefined) {
            return target;
        }
        const { cellStyles: _drop, ...rest } = target;
        return rest as T;
    }
    return { ...target, cellStyles: styles };
}

/** All tool ids placed anywhere inside one category (own list + variants). */
function categoryToolIds(category: StoredCategory): string[] {
    const ids: string[] = [];
    for (const placement of category.placements ?? []) {
        ids.push(placement.toolId);
    }
    for (const variant of category.variants ?? []) {
        for (const placement of variant.placements ?? []) {
            ids.push(placement.toolId);
        }
    }
    return ids;
}

// --- Create / copy / edit / remove one tool ------------------------------------

/**
 * Create a tool from a view-shaped draft (the modal's tempButton, a file-drop
 * draft) and place it in one step: definition into the registry, placement
 * into the addressed grid slot (or appended to the flow list).
 *
 * Grid semantics are unchanged from addButtonToGrid: `targetSlot` is the cell
 * the gesture pointed at and is honoured unless it turned out to be taken;
 * without one the lowest free slot is used. Returns null when the grid is
 * full or the category is missing — nothing is changed then.
 */
export function createToolInCategory(
    state: ToolState,
    categoryId: string,
    variantId: string | null,
    draft: ButtonConfig,
    targetSlot: number | null = null
): ToolState | null {
    const category = findCategory(state, categoryId);
    if (!category) {
        return null;
    }
    const definition = buttonToDefinition(draft);

    if (!isGridCategory(category)) {
        const placements = [...(category.placements ?? []), { toolId: definition.id }];
        return {
            tools: { ...state.tools, [definition.id]: definition },
            categories: withCategory(state, { ...category, placements }).categories,
        };
    }

    const target = resolveGridVariantId(category, variantId);
    if (!target.ok) {
        return null;
    }
    const existing = gridTargetPlacements(category, target.variantId);
    const dimensions = gridDimensionsOf(category, target.variantId);
    const occupancy = storedGridSlotToolIds(existing, dimensions);
    const requested =
        isValidSlotIndex(targetSlot, occupancy.length) && occupancy[targetSlot] === null
            ? targetSlot
            : null;
    const slot = requested ?? findFirstFreeSlot(occupancy);
    if (slot === null) {
        return null;
    }
    const placements = [...existing, { toolId: definition.id, slot }];
    const nextCategory =
        target.variantId === null
            ? { ...category, placements }
            : replaceVariantPlacements(category, target.variantId, placements);
    return {
        tools: { ...state.tools, [definition.id]: definition },
        categories: withCategory(state, nextCategory).categories,
    };
}

/**
 * Update a tool's definition from a view-shaped button (the edit modal's
 * result). Positions are untouched — name, icon, actions and the execution
 * settings are definition properties, so every placement of the tool shows
 * the change. The stored `library` flag survives the round trip through the
 * view shape (which deliberately does not carry it).
 */
export function updateToolDefinition(state: ToolState, button: ButtonConfig): ToolState {
    const definition = mergeDefinition(
        state.tools[button.id],
        buttonToDefinition(button)
    );
    return {
        tools: { ...state.tools, [definition.id]: definition },
        categories: state.categories,
    };
}

/**
 * Copy a tool inside its category: a NEW definition with a new id (never
 * implicit sharing — decided in F2) plus a new placement. In a grid the copy
 * lands on the lowest free slot of the grid/variant the source occupies; in a
 * flow list it is appended. The copy never inherits `library` — it starts as
 * an ad-hoc tool like everything else that was not explicitly kept.
 * Returns null when the grid is full or something is missing.
 */
export function copyToolInCategory(
    state: ToolState,
    categoryId: string,
    sourceToolId: string,
    newToolId: string
): ToolState | null {
    const category = findCategory(state, categoryId);
    const source = state.tools[sourceToolId];
    if (!category || !source) {
        return null;
    }
    const copy = deepCopyDefinition(source, newToolId);

    if (!isGridCategory(category)) {
        const placements = [...(category.placements ?? []), { toolId: copy.id }];
        return {
            tools: { ...state.tools, [copy.id]: copy },
            categories: withCategory(state, { ...category, placements }).categories,
        };
    }

    const variantId = findToolVariantId(category, sourceToolId);
    const existing = gridTargetPlacements(category, variantId);
    const dimensions = gridDimensionsOf(category, variantId);
    const slot = findFirstFreeSlot(storedGridSlotToolIds(existing, dimensions));
    if (slot === null) {
        return null;
    }
    const placements = [...existing, { toolId: copy.id, slot }];
    const nextCategory =
        variantId === null
            ? { ...category, placements }
            : replaceVariantPlacements(category, variantId, placements);
    return {
        tools: { ...state.tools, [copy.id]: copy },
        categories: withCategory(state, nextCategory).categories,
    };
}

/**
 * Remove every placement of a tool inside one category, then garbage-collect
 * the definition if nothing references it anymore and it is not a library
 * tool. This is THE explicit remove operation — the delete menu ends here,
 * and (via the resize commit) so does cutting an occupied stripe.
 */
export function removeToolFromCategory(
    state: ToolState,
    categoryId: string,
    toolId: string
): ToolState {
    const category = findCategory(state, categoryId);
    if (!category) {
        return state;
    }
    const strip = (placements: ToolPlacement[] | undefined): ToolPlacement[] =>
        (placements ?? []).filter((placement) => placement.toolId !== toolId);

    const nextCategory: StoredCategory = {
        ...category,
        placements: strip(category.placements),
        ...(category.variants
            ? {
                  variants: category.variants.map((variant) =>
                      variant.placements?.some((p) => p.toolId === toolId)
                          ? { ...variant, placements: strip(variant.placements) }
                          : variant
                  ),
              }
            : {}),
    };
    const categories = withCategory(state, nextCategory).categories;
    return {
        tools: gcTools(state.tools, categories, [toolId]),
        categories,
    };
}

// --- Drag write-back (no registry change, no GC) --------------------------------

/**
 * Write a dragged slot assignment back into the stored category — the v5
 * counterpart of the old applySlotIdsToGridCategory, with identical
 * semantics: `slotIds` is the live drag state of the ONE grid on screen, its
 * index IS the slot; tools arriving from another category join the addressed
 * grid (their definitions are already in the registry — a MOVE never touches
 * it); every off-screen variant stays untouched; placements the drag never
 * carried (overflow of corrupt data) stay where they are.
 */
export function applySlotIdsToStoredCategory(
    category: StoredCategory,
    slotIds: readonly (string | null)[],
    tools: ToolRegistry,
    targetVariantId: string | null,
    claimedByDrag?: ReadonlySet<string>
): StoredCategory {
    const stored = gridTargetPlacements(category, targetVariantId);

    const slotCount = Math.min(
        slotIds.length,
        gridSlotCount(gridDimensionsOf(category, targetVariantId))
    );
    const placed: ToolPlacement[] = [];
    const claimed = new Set<string>();
    for (let slot = 0; slot < slotCount; slot++) {
        const id = slotIds[slot] ?? null;
        if (id === null) continue;
        if (!tools[id]) continue;
        placed.push({ toolId: id, slot });
        claimed.add(id);
    }

    // A stored placement the drag state no longer carries has either moved to
    // another container (claimed there) or was never part of the drag
    // (overflow) — only the former leaves the grid.
    const untouched = stored.filter(
        (placement) =>
            !claimed.has(placement.toolId) &&
            !(claimedByDrag?.has(placement.toolId) ?? false)
    );

    const placements = [...placed, ...untouched];
    return targetVariantId === null
        ? { ...category, placements }
        : replaceVariantPlacements(category, targetVariantId, placements);
}

/**
 * Write a dragged flow order back: the id list is the new placement order.
 * Placements of this category that no container of the drag claimed stay
 * appended (they were never part of the drag).
 */
export function applyFlowIdsToStoredCategory(
    category: StoredCategory,
    ids: readonly (string | null)[],
    tools: ToolRegistry,
    claimedByDrag: ReadonlySet<string>
): StoredCategory {
    const placements: ToolPlacement[] = [];
    for (const id of ids) {
        if (id === null) continue;
        if (!tools[id]) continue;
        placements.push({ toolId: id });
    }
    for (const placement of category.placements ?? []) {
        if (!claimedByDrag.has(placement.toolId)) {
            placements.push(placement);
        }
    }
    return { ...category, placements };
}

// --- Resize ---------------------------------------------------------------------

export interface StoredGridResizePlan {
    /** The category as it would look afterwards. */
    category: StoredCategory;
    /** Dimensions before / after, for the UI wording. */
    from: GridDimensions;
    to: GridDimensions;
    /** Tools standing on the cut-off stripe (GC candidates of the commit). */
    removedToolIds: string[];
    /** Their names, for the confirmation modal. */
    removedNames: string[];
}

/**
 * Plan a resize of the ONE grid the user is editing — same coordinate-aware
 * semantics as ever (grow never reflows, shrink cuts exactly the outer
 * stripe), computed on placements. Returns null when there is no addressable
 * grid or the size does not change. Nothing is persisted or collected here;
 * commitStoredGridResize applies the plan.
 */
export function planStoredGridResize(
    category: StoredCategory,
    variantId: string | null,
    next: GridDimensions,
    tools: ToolRegistry
): StoredGridResizePlan | null {
    if (!isGridCategory(category)) {
        return null;
    }
    const to = clampGridDimensions(next);
    const target = resolveGridVariantId(category, variantId);
    if (!target.ok) {
        return null;
    }
    const targetVariant =
        target.variantId !== null ? findVariant(category, target.variantId) : null;
    if (isDynamicCategory(category) && !targetVariant) {
        return null;
    }

    const from = readGridDimensions(targetVariant ?? category);
    if (sameGridDimensions(from, to)) {
        return null;
    }

    const placements = targetVariant
        ? (targetVariant.placements ?? [])
        : (category.placements ?? []);

    // One resize core for both worlds: run the coordinate-aware remap on
    // index-tagged placeholders and map the results back to placements.
    const placeholders: ButtonConfig[] = placements.map((placement, index) => ({
        id: String(index),
        name: '',
        actions: [],
        order: index,
        ...(placement.slot !== undefined ? { slot: placement.slot } : {}),
    }));
    const resized = resizeGridButtons(placeholders, from, to);
    const at = (button: ButtonConfig): ToolPlacement => placements[Number(button.id)]!;
    const kept: ToolPlacement[] = resized.buttons.map((button) => ({
        toolId: at(button).toolId,
        ...(button.slot !== undefined ? { slot: button.slot } : {}),
    }));
    const removedToolIds = resized.removed.map((button) => at(button).toolId);

    // Cell styles ride along coordinate-stable: growing keeps every key
    // (a key IS the logical cell), shrinking drops exactly the cut strip.
    const nextCategory: StoredCategory = targetVariant
        ? {
              ...category,
              variants: (category.variants ?? []).map((variant) =>
                  variant.id === targetVariant.id
                      ? setCellStyles(
                            {
                                ...variant,
                                rows: to.rows,
                                columns: to.columns,
                                placements: kept,
                            },
                            resizeGridCellStyles(variant.cellStyles, to)
                        )
                      : variant
              ),
          }
        : setCellStyles(
              { ...category, rows: to.rows, columns: to.columns, placements: kept },
              resizeGridCellStyles(category.cellStyles, to)
          );

    return {
        category: nextCategory,
        from,
        to,
        removedToolIds,
        removedNames: removedToolIds.map((id) => tools[id]?.name ?? id),
    };
}

/**
 * Apply a resize plan: replace the category, then garbage-collect the cut
 * tools (library tools and tools still placed elsewhere survive).
 */
export function commitStoredGridResize(
    state: ToolState,
    plan: StoredGridResizePlan
): ToolState {
    const categories = withCategory(state, plan.category).categories;
    return {
        tools: gcTools(state.tools, categories, plan.removedToolIds),
        categories,
    };
}

// --- Cell colors ----------------------------------------------------------------

/**
 * Set (or clear) the color of a set of CELLS in one grid.
 *
 * The unit is the cell coordinate, so a cell is colored whether a tool sits on
 * it or not — this operation does not even look at the occupancy. It touches
 * nothing but `cellStyles`: no placement, no registry entry, no other variant,
 * and it never garbage-collects.
 *
 * Target resolution is STRICTER than `resolveGridVariantId` on purpose and does
 * not use it: that helper reads `variantId === null` on a dynamic category as
 * "the first variant", which is right for a write the user aimed at a category
 * but wrong for a selection, whose `null` means "the static grid". A mismatch
 * must therefore color nothing rather than the wrong grid:
 *
 * - static/flow category  ⇒ only `variantId === null`;
 * - dynamic category      ⇒ only a `variantId` that actually exists.
 *
 * Every refusal — no such category, no grid, wrong variant shape, a color that
 * is not a portable value — returns the very SAME state object, so a caller can
 * tell "nothing to do" from "done" by identity and skip the commit.
 *
 * @param color the stored color value, or null to clear the cells.
 */
export function setCellColorsInState(
    state: ToolState,
    categoryId: string,
    variantId: string | null,
    cells: readonly string[],
    color: string | null
): ToolState {
    if (cells.length === 0) {
        return state;
    }
    if (color !== null && !isGridCellColor(color)) {
        // Validated in the domain, not in the UI: nothing may write a value the
        // template parser would later reject.
        return state;
    }

    const category = findCategory(state, categoryId);
    if (!category || !isGridCategory(category)) {
        return state;
    }

    const dynamic = isDynamicCategory(category);
    const variant = variantId !== null ? findVariant(category, variantId) : null;
    if (dynamic !== (variantId !== null) || (variantId !== null && !variant)) {
        return state;
    }

    const owner: GridCellStyleFields = variant ?? category;
    const dimensions = gridDimensionsOf(category, variantId);

    // A key outside the grid can neither be shown nor cleaned up, so it is
    // ignored rather than written — the same strip rule as a resize.
    const inside = cells.filter((cell) => isCellKeyInsideGrid(cell, dimensions));
    if (inside.length === 0) {
        return state;
    }

    const current = owner.cellStyles;
    const next: GridCellStyles = { ...cloneGridCellStyles(current) };
    let changed = false;
    for (const cell of inside) {
        const entry = current?.[cell];
        if (color === null) {
            if (entry?.color === undefined) {
                continue;
            }
            // Clearing removes the color, and an entry that carried nothing
            // else goes with it, so untouched data stays byte-identical to
            // data written before cell colors existed.
            const { color: _drop, ...rest } = entry;
            if (Object.keys(rest).length === 0) {
                delete next[cell];
            } else {
                next[cell] = rest;
            }
            changed = true;
            continue;
        }
        if (entry?.color === color) {
            continue;
        }
        // Other style fields of the cell survive: a GridCellStyle may carry
        // more than a color later.
        next[cell] = { ...entry, color };
        changed = true;
    }

    if (!changed) {
        return state;
    }

    const styles = Object.keys(next).length === 0 ? undefined : next;
    const nextCategory: StoredCategory = variant
        ? {
              ...category,
              variants: (category.variants ?? []).map((entry) =>
                  entry.id === variant.id ? setCellStyles(entry, styles) : entry
              ),
          }
        : setCellStyles(category, styles);

    return withCategory(state, nextCategory);
}

// --- Variant operations ----------------------------------------------------------

/**
 * Append a new (empty) variant. Returns the category unchanged if the draft
 * would introduce a second fallback. The new variant starts at the dimensions
 * the category's grid currently has (a variant is another state of the SAME
 * panel), written explicitly, and is freely resizable afterwards.
 */
export function addVariantToCategory(
    category: StoredCategory,
    draft: VariantDraft
): StoredCategory {
    if (draft.fallback === true && findFallbackVariant(category) !== null) {
        return category;
    }
    const size = clampGridDimensions(gridDimensionsOf(category, null));
    const variant: StoredVariant = draft.fallback === true
        ? { id: draft.id, name: draft.name, fallback: true, ...size, placements: [] }
        : {
              id: draft.id,
              name: draft.name,
              ...(draft.trigger !== undefined ? { trigger: draft.trigger } : {}),
              ...size,
              placements: [],
          };
    return {
        ...category,
        variants: [...getCategoryVariants<StoredVariant>(category), variant],
    };
}

/**
 * Full copy of a variant: complete grid, slots, actions, appearance — with a
 * new variant id and NEW TOOL DEFINITIONS (decided in F2: a duplicate is
 * fully independent; deliberately shared tools only ever arise from
 * explicitly placing the same library tool). The copy is inserted directly
 * below its source. Refused (state returned unchanged) when the draft would
 * introduce a second fallback or the source is missing.
 */
export function duplicateVariantInState(
    state: ToolState,
    categoryId: string,
    sourceVariantId: string,
    draft: VariantDraft,
    newToolId: (index: number) => string
): ToolState {
    const category = findCategory(state, categoryId);
    if (!category) {
        return state;
    }
    if (draft.fallback === true && findFallbackVariant(category) !== null) {
        return state;
    }
    const variants = getCategoryVariants<StoredVariant>(category);
    const index = variants.findIndex((variant) => variant.id === sourceVariantId);
    if (index === -1) {
        return state;
    }
    const source = variants[index]!;

    const tools = { ...state.tools };
    const placements: ToolPlacement[] = [];
    (source.placements ?? []).forEach((placement, placementIndex) => {
        const definition = state.tools[placement.toolId];
        if (!definition) {
            return;
        }
        const copy = deepCopyDefinition(definition, newToolId(placementIndex));
        tools[copy.id] = copy;
        placements.push({
            toolId: copy.id,
            ...(placement.slot !== undefined ? { slot: placement.slot } : {}),
        });
    });

    const size =
        source.rows === undefined && source.columns === undefined
            ? {}
            : clampGridDimensions(readGridDimensions(source));
    // A duplicate is a FULL independent copy of the variant's grid state, so
    // its cell styles come along as an independent object (F2).
    const styles = withCellStyles(cloneGridCellStyles(source.cellStyles));
    const copyVariant: StoredVariant = draft.fallback === true
        ? { id: draft.id, name: draft.name, fallback: true, ...size, ...styles, placements }
        : {
              id: draft.id,
              name: draft.name,
              ...(draft.trigger !== undefined ? { trigger: draft.trigger } : {}),
              ...size,
              ...styles,
              placements,
          };
    const next = [...variants];
    next.splice(index + 1, 0, copyVariant);
    return {
        tools,
        categories: withCategory(state, { ...category, variants: next }).categories,
    };
}

/**
 * Remove a variant and garbage-collect its tools (a variant's grid was the
 * only home of its tools unless something else references them or they are
 * library tools).
 */
export function removeVariantFromState(
    state: ToolState,
    categoryId: string,
    variantId: string
): ToolState {
    const category = findCategory(state, categoryId);
    const variant = category ? findVariant<StoredVariant>(category, variantId) : null;
    if (!category || !variant) {
        return state;
    }
    const candidates = (variant.placements ?? []).map((placement) => placement.toolId);
    const categories = withCategory(
        state,
        removeVariant<StoredVariant, StoredCategory>(category, variantId)
    ).categories;
    return {
        tools: gcTools(state.tools, categories, candidates),
        categories,
    };
}

// --- Category-level operations ----------------------------------------------------

/**
 * Deep copy of a category (the "duplicate category" command): new category
 * and variant ids, NEW TOOL DEFINITIONS for every placement (F2 — the copy is
 * fully independent of its source).
 */
export function duplicateCategoryInState(
    state: ToolState,
    categoryId: string,
    order: number,
    newId: () => string
): { state: ToolState; category: StoredCategory } | null {
    const source = findCategory(state, categoryId);
    if (!source) {
        return null;
    }
    const tools = { ...state.tools };

    const copyPlacements = (placements: ToolPlacement[] | undefined): ToolPlacement[] => {
        const copied: ToolPlacement[] = [];
        for (const placement of placements ?? []) {
            const definition = state.tools[placement.toolId];
            if (!definition) continue;
            const copy = deepCopyDefinition(definition, newId());
            tools[copy.id] = copy;
            copied.push({
                toolId: copy.id,
                ...(placement.slot !== undefined ? { slot: placement.slot } : {}),
            });
        }
        return copied;
    };

    const copy: StoredCategory = setCellStyles(
        {
            ...source,
            id: newId(),
            order,
            placements: copyPlacements(source.placements),
        },
        cloneGridCellStyles(source.cellStyles)
    );
    if (source.variants) {
        copy.variants = source.variants.map((variant) =>
            setCellStyles(
                {
                    ...variant,
                    id: newId(),
                    placements: copyPlacements(variant.placements),
                },
                cloneGridCellStyles(variant.cellStyles)
            )
        );
    } else {
        delete copy.variants;
    }

    return {
        state: { tools, categories: [...state.categories, copy] },
        category: copy,
    };
}

/**
 * Delete a category: remove it, renumber the survivors immutably, and
 * garbage-collect every tool that lived only there.
 */
export function deleteCategoryFromState(state: ToolState, categoryId: string): ToolState {
    const category = findCategory(state, categoryId);
    if (!category) {
        return state;
    }
    const candidates = categoryToolIds(category);
    const categories = state.categories
        .filter((c) => c.id !== categoryId)
        .map((c, index) => (c.order === index ? c : { ...c, order: index }));
    return {
        tools: gcTools(state.tools, categories, candidates),
        categories,
    };
}

/**
 * Turn a STATIC grid category into a DYNAMIC one: the existing grid becomes
 * the first variant exactly as it is (same placements, same slots, same
 * dimensions — the size moves WITH the grid). Registry untouched.
 */
export function convertStoredStaticGridToDynamic(
    category: StoredCategory,
    draft: VariantDraft
): StoredCategory {
    const hadDimensions = category.rows !== undefined || category.columns !== undefined;
    const size = hadDimensions
        ? clampGridDimensions(readGridDimensions(category))
        : ({} as Record<string, never>);
    // The existing grid becomes the first variant EXACTLY as it is — its cell
    // styles are part of that grid state and move with it, never get dropped.
    const styles = withCellStyles(cloneGridCellStyles(category.cellStyles));
    const variant: StoredVariant = draft.fallback === true
        ? {
              id: draft.id,
              name: draft.name,
              fallback: true,
              ...size,
              ...styles,
              placements: category.placements ?? [],
          }
        : {
              id: draft.id,
              name: draft.name,
              ...(draft.trigger !== undefined ? { trigger: draft.trigger } : {}),
              ...size,
              ...styles,
              placements: category.placements ?? [],
          };
    const { rows: _rows, columns: _columns, cellStyles: _cellStyles, ...rest } = category;
    return { ...rest, placements: [], variants: [variant] };
}

// --- Layout conversion (flow <-> grid) ---------------------------------------------

export type StoredLayoutResult =
    | { ok: true; state: ToolState }
    | Exclude<GridConversionResult, { ok: true }>;

/** Decompose a converted view category back into stored shape + definitions. */
function decomposeViewCategory(view: CategoryConfig): {
    stored: StoredCategory;
    definitions: ToolDefinition[];
} {
    const definitions: ToolDefinition[] = [];
    const { buttons, variants, ...rest } = view;
    const grid = view.layout === 'grid';
    const stored: StoredCategory = {
        ...rest,
        placements: grid
            ? gridPlacementsFromButtons(buttons)
            : flowPlacementsFromButtons(buttons),
    };
    for (const button of buttons) {
        definitions.push(buttonToDefinition(button));
    }
    if (variants) {
        stored.variants = variants.map((variant) => {
            const { buttons: variantButtons, ...variantRest } = variant;
            for (const button of variantButtons) {
                definitions.push(buttonToDefinition(button));
            }
            return {
                ...variantRest,
                placements: gridPlacementsFromButtons(variantButtons),
            };
        });
    }
    return { stored, definitions };
}

/**
 * Apply a category's layout choice (the edit modal's dropdown).
 *
 * - flow -> grid runs the existing view-level conversion core
 *   (convertCategoryToGrid: slot assignment, condition lifting into full
 *   variants) on the materialized category and decomposes the result back:
 *   updated/derived definitions are upserted, and originals that the
 *   conversion replaced (base tools copied per variant) are GC'd.
 * - grid -> flow (static only) reorders directly on the placements: spatial
 *   reading order, slots dropped, registry untouched.
 * - a DYNAMIC category refuses the switch to flow (data-loss path).
 */
export function applyStoredCategoryLayout(
    state: ToolState,
    categoryId: string,
    layout: CategoryLayout
): StoredLayoutResult {
    const category = findCategory(state, categoryId);
    if (!category) {
        return { ok: true, state };
    }
    const current = getCategoryLayout(category);
    if (current === layout) {
        return { ok: true, state };
    }

    if (layout === 'grid') {
        const view = materializeCategory(category, state.tools);
        const result = convertCategoryToGrid(view);
        if (!result.ok) {
            return result;
        }
        const { stored, definitions } = decomposeViewCategory(result.category);
        const tools = { ...state.tools };
        for (const definition of definitions) {
            tools[definition.id] = mergeDefinition(tools[definition.id], definition);
        }
        const categories = withCategory({ tools, categories: state.categories }, stored)
            .categories;
        return {
            ok: true,
            state: {
                // Originals the conversion replaced lose their last reference
                // and are collected; everything still placed survives.
                tools: gcTools(tools, categories, categoryToolIds(category)),
                categories,
            },
        };
    }

    if (isDynamicCategory(category)) {
        return { ok: false, reason: 'dynamic_category' };
    }

    // grid -> flow: spatial reading order (slot 0 first, then overflow),
    // slots and grid dimensions dropped. Definitions are untouched.
    const placed = placeStoredGrid(
        category.placements ?? [],
        readGridDimensions(category)
    );
    const ordered: ToolPlacement[] = [
        ...placed.slots.filter((p): p is ToolPlacement => p !== null),
        ...placed.overflow,
    ].map((placement) => ({ toolId: placement.toolId }));
    const {
        layout: _layout,
        rows: _rows,
        columns: _columns,
        cellStyles: _cellStyles,
        ...rest
    } = category;
    return {
        ok: true,
        state: withCategory(state, { ...rest, layout: 'flow', placements: ordered }),
    };
}
