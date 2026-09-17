// categoryVariants.ts
// Pure model of the OCAP dynamic category variants.
//
// Product model (see docs/ocap/DECISIONS.md):
// - a grid category is either STATIC or DYNAMIC;
// - a static grid category has one full grid in `category.buttons`, sized by
//   its own `rows`/`columns`, and no context behavior at all;
// - a dynamic grid category is ONE stable container holding several COMPLETE
//   variants (`category.variants`); each variant owns a full, independent grid
//   — its own size included — plus exactly one trigger condition, or it is the
//   single fallback variant;
// - at runtime exactly one variant renders: the first (in array order) whose
//   trigger matches, else the fallback, else none (category hidden in locked
//   mode). Variants are never merged, inherited from or overlaid;
// - a slot's spatial identity never depends on the context: switching variants
//   changes what sits on a slot, never where a tool sits.
//
// Everything here is pure: no mutation of the inputs, no Obsidian imports, no
// stored functions. Edits follow the immutable-edit convention from
// DECISIONS.md (changed objects are replaced, unchanged ones keep identity).

import type { ButtonConfig, CategoryConfig, CategoryVariant } from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import type { OCAPContextSnapshot } from '@/context/OCAPContext';
import { evaluateCondition, isValidCondition } from '@/context/conditions';
import {
    LEGACY_GRID_DIMENSIONS,
    MAX_GRID_COLUMNS,
    MAX_GRID_ROWS,
    buttonsInOrder,
    clampGridDimensions,
    fitGridDimensions,
    findFirstFreeSlot,
    getCategoryLayout,
    gridSlotCount,
    isGridCategory,
    isValidSlotIndex,
    placeButtonsOnGrid,
    readGridDimensions,
    resizeGridButtons,
    sameGridDimensions,
    type CategoryLayout,
    type GridDimensions,
    type GridResizeDirection,
    type GridResizeEdge,
} from '@/utils/categoryGrid';

// --- Basic accessors ---------------------------------------------------------

/** Variants of a category, defensively normalized (never null/undefined). */
export function getCategoryVariants(
    category: Pick<CategoryConfig, 'variants'>
): CategoryVariant[] {
    const variants = category.variants;
    if (!Array.isArray(variants)) {
        return [];
    }
    return variants.filter(
        (variant): variant is CategoryVariant =>
            typeof variant === 'object' &&
            variant !== null &&
            typeof variant.id === 'string' &&
            Array.isArray(variant.buttons)
    );
}

/** True for a `layout: 'grid'` category that carries variants (dynamic). */
export function isDynamicCategory(
    category: Pick<CategoryConfig, 'layout' | 'variants'>
): boolean {
    return isGridCategory(category) && Array.isArray(category.variants);
}

/** True for a `layout: 'grid'` category without variants (static grid). */
export function isStaticGridCategory(
    category: Pick<CategoryConfig, 'layout' | 'variants'>
): boolean {
    return isGridCategory(category) && !Array.isArray(category.variants);
}

/**
 * Dimensions of ONE grid of a category: the variant's own when a variant is
 * addressed, the category's own for a static grid.
 *
 * This is the single answer to "where does the size live": a variant IS a
 * complete independent grid (see DECISIONS.md), so its size belongs to it and
 * resizing one variant can never touch another. A static grid category has
 * exactly one grid, so its size sits on the category itself. Absent fields
 * read as the legacy 4x4 in both cases.
 */
export function gridDimensionsOf(
    category: CategoryConfig,
    variantId: string | null
): GridDimensions {
    if (variantId !== null) {
        const variant = findVariant(category, variantId);
        if (variant) {
            return readGridDimensions(variant);
        }
    }
    if (isDynamicCategory(category)) {
        const first = getCategoryVariants(category)[0];
        if (first) {
            return readGridDimensions(first);
        }
    }
    return readGridDimensions(category);
}

export function findVariant(
    category: Pick<CategoryConfig, 'variants'>,
    variantId: string
): CategoryVariant | null {
    return getCategoryVariants(category).find((variant) => variant.id === variantId) ?? null;
}

/** The single fallback variant, or null. */
export function findFallbackVariant(
    category: Pick<CategoryConfig, 'variants'>
): CategoryVariant | null {
    return getCategoryVariants(category).find((variant) => variant.fallback === true) ?? null;
}

/** Triggered (non-fallback) variants in priority order. */
export function triggeredVariants(
    category: Pick<CategoryConfig, 'variants'>
): CategoryVariant[] {
    return getCategoryVariants(category).filter((variant) => variant.fallback !== true);
}

// --- Runtime resolution ------------------------------------------------------

/**
 * Whether a variant's trigger holds in the given context.
 *
 * - fallback variants never match a trigger (they are selected separately);
 * - an absent trigger never matches — "always active" is expressed explicitly
 *   as `{ all: [] }`, never implied by missing data;
 * - a structurally invalid trigger does NOT match. This is the one place where
 *   OCAP deliberately does not fail open: a corrupt always-matching variant
 *   would shadow every variant below it, whereas a skipped variant only loses
 *   itself in locked mode and stays fully selectable and repairable in the
 *   management modes (where it is marked as broken).
 */
export function variantTriggerMatches(
    variant: Pick<CategoryVariant, 'trigger' | 'fallback'>,
    context: OCAPContextSnapshot
): boolean {
    if (variant.fallback === true) {
        return false;
    }
    const trigger = variant.trigger;
    if (trigger === undefined || trigger === null) {
        return false;
    }
    if (!isValidCondition(trigger)) {
        return false;
    }
    return evaluateCondition(trigger, context);
}

/** Why a variant (or no variant) was chosen for the current context. */
export type VariantResolutionReason = 'trigger' | 'fallback' | 'none';

export interface VariantResolution {
    variant: CategoryVariant | null;
    reason: VariantResolutionReason;
}

/**
 * Runtime resolution of a dynamic category:
 * 1. check the triggered variants in priority (array) order — first match wins;
 * 2. no match -> the fallback variant, if one exists;
 * 3. otherwise none (the category renders nothing in locked mode).
 *
 * The fallback is modelled explicitly (never as a hidden always-true trigger),
 * so it can never shadow a triggered variant through its position.
 * Never mutates stored configuration.
 */
export function resolveDynamicCategoryVariant(
    category: Pick<CategoryConfig, 'variants'>,
    context: OCAPContextSnapshot
): VariantResolution {
    for (const variant of triggeredVariants(category)) {
        if (variantTriggerMatches(variant, context)) {
            return { variant, reason: 'trigger' };
        }
    }
    const fallback = findFallbackVariant(category);
    if (fallback) {
        return { variant: fallback, reason: 'fallback' };
    }
    return { variant: null, reason: 'none' };
}

// --- Resolved grid view (what the renderer consumes) -------------------------

/** How the rendered grid content was chosen. */
export type GridViewReason =
    /** Static grid category: `category.buttons` is the grid. */
    | 'static'
    /** Dynamic, locked mode: a triggered variant matched. */
    | 'trigger'
    /** Dynamic, locked mode: the fallback variant. */
    | 'fallback'
    /** Dynamic, locked mode: nothing matched (empty grid, category hidden). */
    | 'none'
    /** Dynamic, management modes: the variant the user selected. */
    | 'selected';

export interface ResolvedGridView {
    /** Variant whose grid is shown; null for static grids and for 'none'. */
    variantId: string | null;
    reason: GridViewReason;
    /** Dimensions of exactly this grid (the variant's own, or the static one). */
    dimensions: GridDimensions;
    /** Always `gridSlotCount(dimensions)` entries; index === slot. */
    slots: (ButtonConfig | null)[];
    /** Buttons that could not be placed. Never dropped, rendered separately. */
    overflow: ButtonConfig[];
}

function emptyView(reason: GridViewReason, dimensions: GridDimensions): ResolvedGridView {
    return {
        variantId: null,
        reason,
        dimensions,
        slots: new Array<ButtonConfig | null>(gridSlotCount(dimensions)).fill(null),
        overflow: [],
    };
}

function viewOfButtons(
    buttons: readonly ButtonConfig[],
    dimensions: GridDimensions,
    variantId: string | null,
    reason: GridViewReason
): ResolvedGridView {
    const placement = placeButtonsOnGrid(buttons, dimensions);
    return {
        variantId,
        reason,
        dimensions,
        slots: placement.slots,
        overflow: placement.overflow,
    };
}

/**
 * Grid view of one specific variant (management modes), or of the static grid
 * when `variantId` is null. An unknown variant id falls back to the first
 * variant, so a deleted variant can never leave the UI on a phantom grid.
 */
export function resolveGridViewForVariant(
    category: CategoryConfig,
    variantId: string | null
): ResolvedGridView {
    if (!isDynamicCategory(category)) {
        return viewOfButtons(
            category.buttons,
            readGridDimensions(category),
            null,
            'static'
        );
    }
    const variants = getCategoryVariants(category);
    const variant =
        (variantId !== null ? findVariant(category, variantId) : null) ?? variants[0] ?? null;
    if (!variant) {
        return emptyView('selected', readGridDimensions(category));
    }
    return viewOfButtons(
        variant.buttons,
        readGridDimensions(variant),
        variant.id,
        'selected'
    );
}

/** Grid view for the current context (locked mode). */
export function resolveGridViewForContext(
    category: CategoryConfig,
    context: OCAPContextSnapshot
): ResolvedGridView {
    if (!isDynamicCategory(category)) {
        return viewOfButtons(
            category.buttons,
            readGridDimensions(category),
            null,
            'static'
        );
    }
    const resolution = resolveDynamicCategoryVariant(category, context);
    if (!resolution.variant) {
        return emptyView('none', gridDimensionsOf(category, null));
    }
    return viewOfButtons(
        resolution.variant.buttons,
        readGridDimensions(resolution.variant),
        resolution.variant.id,
        resolution.reason
    );
}

/**
 * The resolved grid as a plain button list carrying the slots it resolved to.
 * Feeding this into `placeButtonsOnGrid` reproduces exactly the same
 * arrangement, so the existing renderers need no special casing. Unchanged
 * buttons keep their identity (React memo contract).
 */
export function effectiveGridButtons(view: ResolvedGridView): ButtonConfig[] {
    const buttons: ButtonConfig[] = [];
    for (let slot = 0; slot < view.slots.length; slot++) {
        const button = view.slots[slot];
        if (!button) continue;
        buttons.push(button.slot === slot ? button : { ...button, slot });
    }
    return [...buttons, ...view.overflow];
}

// --- Buttons across the whole category ---------------------------------------

/** Variant that stores the given button, or null (static grid / flow / absent). */
export function findButtonVariantId(
    category: CategoryConfig,
    buttonId: string
): string | null {
    for (const variant of getCategoryVariants(category)) {
        if (variant.buttons.some((button) => button.id === buttonId)) {
            return variant.id;
        }
    }
    return null;
}

/** Every button of a category: `buttons` plus each variant's grid, in order. */
export function allCategoryButtons(category: CategoryConfig): ButtonConfig[] {
    const buttons = [...category.buttons];
    for (const variant of getCategoryVariants(category)) {
        buttons.push(...variant.buttons);
    }
    return buttons;
}

/**
 * Filter every variant of a category with the same predicate (used by the
 * panel search, which must reach tools in every variant). Returns the same
 * category reference when nothing is filtered out.
 */
export function filterCategoryButtonsDeep(
    category: CategoryConfig,
    predicate: (button: ButtonConfig) => boolean
): CategoryConfig {
    const variants = getCategoryVariants(category);
    const buttons = category.buttons.filter(predicate);
    const nextVariants = variants.map((variant) => {
        const filtered = variant.buttons.filter(predicate);
        return filtered.length === variant.buttons.length
            ? variant
            : { ...variant, buttons: filtered };
    });
    const variantsChanged = nextVariants.some((variant, index) => variant !== variants[index]);
    if (buttons.length === category.buttons.length && !variantsChanged) {
        return category;
    }
    return !isDynamicCategory(category)
        ? { ...category, buttons }
        : { ...category, buttons, variants: nextVariants };
}

// --- Variant management (pure, immutable) ------------------------------------

function withVariants(
    category: CategoryConfig,
    variants: CategoryVariant[]
): CategoryConfig {
    return { ...category, variants };
}

export interface VariantDraft {
    id: string;
    name: string;
    trigger?: ButtonCondition;
    fallback?: boolean;
}

/**
 * Build a variant. `dimensions` is written only when given: passing null keeps
 * the variant free of the size fields, which is what the legacy migrations
 * want — absent fields already mean the 4x4 they produced, so nothing has to
 * be rewritten in stored data.
 */
function makeVariant(
    draft: VariantDraft,
    buttons: ButtonConfig[],
    dimensions: GridDimensions | null
): CategoryVariant {
    const size = dimensions === null ? {} : clampGridDimensions(dimensions);
    if (draft.fallback === true) {
        return { id: draft.id, name: draft.name, fallback: true, ...size, buttons };
    }
    return {
        id: draft.id,
        name: draft.name,
        ...(draft.trigger !== undefined ? { trigger: draft.trigger } : {}),
        ...size,
        buttons,
    };
}

/**
 * Append a new (empty) variant. Returns the category unchanged if the draft
 * would introduce a second fallback.
 *
 * The new variant starts at the dimensions the category's grid currently has:
 * a variant is another state of the SAME panel, so an added variant that
 * suddenly shrank to the "new grid" default would be a surprise, not a
 * default. It is freely resizable afterwards, independently of its siblings.
 */
export function addVariant(
    category: CategoryConfig,
    draft: VariantDraft
): CategoryConfig {
    if (draft.fallback === true && findFallbackVariant(category) !== null) {
        return category;
    }
    return withVariants(category, [
        ...getCategoryVariants(category),
        makeVariant(draft, [], gridDimensionsOf(category, null)),
    ]);
}

/**
 * Update a variant's name, trigger and fallback flag. `trigger` is always
 * assigned, so clearing the editor really removes a previously configured
 * rule. Refused (same reference returned) when the update would create a
 * second fallback.
 */
export function updateVariant(
    category: CategoryConfig,
    variantId: string,
    patch: { name: string; trigger: ButtonCondition | undefined; fallback: boolean }
): CategoryConfig {
    if (patch.fallback) {
        const existing = findFallbackVariant(category);
        if (existing && existing.id !== variantId) {
            return category;
        }
    }
    const variants = getCategoryVariants(category).map((variant) => {
        if (variant.id !== variantId) {
            return variant;
        }
        return makeVariant(
            {
                id: variant.id,
                name: patch.name,
                trigger: patch.fallback ? undefined : patch.trigger,
                fallback: patch.fallback,
            },
            variant.buttons,
            // Editing name/trigger must never resize the grid: an untouched
            // variant keeps its stored fields exactly as they are (absent
            // stays absent, so legacy data is not rewritten either).
            variant.rows === undefined && variant.columns === undefined
                ? null
                : readGridDimensions(variant)
        );
    });
    return withVariants(category, variants);
}

export function removeVariant(
    category: CategoryConfig,
    variantId: string
): CategoryConfig {
    return withVariants(
        category,
        getCategoryVariants(category).filter((variant) => variant.id !== variantId)
    );
}

/**
 * Full copy of a variant: complete grid, slots, actions, appearance — with a
 * new variant id and new button ids, so nothing is shared with the source and
 * a later edit of the copy can never leak into the original. The copy is
 * inserted directly below its source and is never the fallback (the draft
 * decides its name and trigger). The source's grid DIMENSIONS are copied as
 * well — a copy that changed shape would not be a copy.
 */
export function duplicateVariant(
    category: CategoryConfig,
    sourceVariantId: string,
    draft: VariantDraft,
    newButtonId: (index: number) => string
): CategoryConfig {
    if (draft.fallback === true && findFallbackVariant(category) !== null) {
        return category;
    }
    const variants = getCategoryVariants(category);
    const index = variants.findIndex((variant) => variant.id === sourceVariantId);
    if (index === -1) {
        return category;
    }
    const source = variants[index]!;
    const copy = makeVariant(
        draft,
        source.buttons.map((button, buttonIndex) => ({
            ...button,
            id: newButtonId(buttonIndex),
            actions: button.actions?.map((action) => ({ ...action })) ?? [],
        })),
        source.rows === undefined && source.columns === undefined
            ? null
            : readGridDimensions(source)
    );
    const next = [...variants];
    next.splice(index + 1, 0, copy);
    return withVariants(category, next);
}

/**
 * Move a variant one position up or down. Order IS priority for triggered
 * variants (first match wins). The fallback variant is not movable — its
 * position never affects resolution — and other variants do not move past it.
 */
export function moveVariant(
    category: CategoryConfig,
    variantId: string,
    direction: -1 | 1
): CategoryConfig {
    const variants = getCategoryVariants(category);
    const index = variants.findIndex((variant) => variant.id === variantId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= variants.length) {
        return category;
    }
    if (variants[index]!.fallback === true) {
        return category;
    }
    const next = [...variants];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    return withVariants(category, next);
}

// --- Static <-> dynamic conversion --------------------------------------------

/**
 * Turn a STATIC grid category into a DYNAMIC one. The category's existing full
 * grid becomes the first variant exactly as it is (same buttons, same slots,
 * same DIMENSIONS), so no button is lost and nothing moves or resizes. The
 * draft decides the variant's name and trigger (or fallback).
 *
 * The size moves WITH the grid: from here on every variant owns its own, so
 * leaving a stale copy on the category would be a second source of truth.
 */
export function convertStaticGridToDynamic(
    category: CategoryConfig,
    draft: VariantDraft
): CategoryConfig {
    const hadDimensions = category.rows !== undefined || category.columns !== undefined;
    const { rows: _rows, columns: _columns, ...rest } = category;
    return {
        ...rest,
        buttons: [],
        variants: [
            makeVariant(
                draft,
                category.buttons,
                hadDimensions ? readGridDimensions(category) : null
            ),
        ],
    };
}

// --- Layer-aware button placement --------------------------------------------

function replaceVariantButtons(
    category: CategoryConfig,
    variantId: string,
    buttons: ButtonConfig[]
): CategoryConfig {
    return withVariants(
        category,
        getCategoryVariants(category).map((variant) =>
            variant.id === variantId ? { ...variant, buttons } : variant
        )
    );
}

/** Buttons stored in one grid target (a variant, or the static grid itself). */
function gridTargetButtons(
    category: CategoryConfig,
    variantId: string | null
): ButtonConfig[] {
    if (variantId === null) {
        return category.buttons;
    }
    return findVariant(category, variantId)?.buttons ?? [];
}

/**
 * Add a button to a variant (or to the static grid when `variantId` is null).
 *
 * `targetSlot` is the slot the user pointed at — the `+` of an empty cell, or
 * the cell a vault file was dropped on. The position is then already part of
 * the gesture and must be honoured. It is only ignored when that slot turned
 * out to be taken after all, in which case the lowest free slot keeps the tool
 * rather than losing it; without a target slot the lowest free one is the
 * default as before.
 *
 * Returns null when the grid is full — the caller must tell the user instead
 * of dropping the tool.
 */
export function addButtonToGrid(
    category: CategoryConfig,
    variantId: string | null,
    button: ButtonConfig,
    targetSlot: number | null = null
): CategoryConfig | null {
    // A dynamic category stores every tool inside a variant; without an
    // explicit target the first variant is the only sensible home. A dynamic
    // category without any variant has no place for a tool at all.
    if (variantId === null && isDynamicCategory(category)) {
        const first = getCategoryVariants(category)[0];
        if (!first) {
            return null;
        }
        variantId = first.id;
    }
    const existing = gridTargetButtons(category, variantId);
    const dimensions = gridDimensionsOf(category, variantId);
    const occupancy = placeButtonsOnGrid(existing, dimensions).slots.map(
        (b) => b?.id ?? null
    );
    const requested =
        isValidSlotIndex(targetSlot, occupancy.length) && occupancy[targetSlot] === null
            ? targetSlot
            : null;
    const slot = requested ?? findFirstFreeSlot(occupancy);
    if (slot === null) {
        return null;
    }
    const placed: ButtonConfig = { ...button, slot, order: existing.length };
    const buttons = [...existing, placed];
    return variantId === null
        ? { ...category, buttons }
        : replaceVariantButtons(category, variantId, buttons);
}

/** Remove a button from wherever it lives (static grid or any variant). */
export function removeButtonFromGridCategory(
    category: CategoryConfig,
    buttonId: string
): CategoryConfig {
    const variantId = findButtonVariantId(category, buttonId);
    const stored = gridTargetButtons(category, variantId);
    if (!stored.some((button) => button.id === buttonId)) {
        return category;
    }
    const remaining = stored
        .filter((button) => button.id !== buttonId)
        .map((button, index) => ({ ...button, order: index }));
    return variantId === null
        ? { ...category, buttons: remaining }
        : replaceVariantButtons(category, variantId, remaining);
}

/** Replace a button in place, in whichever variant (or static grid) stores it. */
export function replaceButtonInGridCategory(
    category: CategoryConfig,
    button: ButtonConfig
): CategoryConfig {
    const variantId = findButtonVariantId(category, button.id);
    const stored = gridTargetButtons(category, variantId);
    if (!stored.some((existing) => existing.id === button.id)) {
        return category;
    }
    const buttons = stored.map((existing) =>
        existing.id === button.id ? button : existing
    );
    return variantId === null
        ? { ...category, buttons }
        : replaceVariantButtons(category, variantId, buttons);
}

/**
 * Write a dragged slot assignment back into the stored category.
 *
 * `slotIds` is the live drag state of the ONE grid on screen: the static
 * grid, or the variant currently selected in the editor (`targetVariantId`).
 * Its length IS that grid's slot count — the drag state is built from the same
 * resolved view the renderer uses — so no dimension has to be re-derived here.
 * Buttons that arrived from another category join that on-screen grid. Every
 * variant that is NOT on screen is left completely untouched — dragging in
 * "Source" can never move anything in "Topic".
 *
 * `claimedByDrag` holds every button id the whole drag state accounts for,
 * across all containers. It distinguishes a tool that was dragged INTO another
 * category (claimed elsewhere, so it leaves this one) from a tool the drag
 * never carried at all — overflow from hand-edited data, which must stay
 * exactly where it is rather than being dropped.
 */
export function applySlotIdsToGridCategory(
    category: CategoryConfig,
    slotIds: readonly (string | null)[],
    buttonsById: ReadonlyMap<string, ButtonConfig>,
    targetVariantId: string | null,
    claimedByDrag?: ReadonlySet<string>
): CategoryConfig {
    const stored = gridTargetButtons(category, targetVariantId);
    const storedIds = new Set(stored.map((button) => button.id));

    const slotCount = Math.min(
        slotIds.length,
        gridSlotCount(gridDimensionsOf(category, targetVariantId))
    );
    const placed: ButtonConfig[] = [];
    const claimed = new Set<string>();
    for (let slot = 0; slot < slotCount; slot++) {
        const id = slotIds[slot] ?? null;
        if (id === null) continue;
        const button = buttonsById.get(id);
        if (!button) continue;
        placed.push({ ...button, slot });
        claimed.add(id);
    }

    // A stored tool of the on-screen grid that the drag state no longer
    // carries has either moved to another container (claimed there) or was
    // never part of the drag (overflow) — only the former leaves the grid.
    const untouched = stored.filter(
        (button) =>
            !claimed.has(button.id) &&
            !(storedIds.has(button.id) && (claimedByDrag?.has(button.id) ?? false))
    );

    const buttons = [...placed, ...untouched].map((button, index) => ({
        ...button,
        order: index,
    }));

    return targetVariantId === null
        ? { ...category, buttons }
        : replaceVariantButtons(category, targetVariantId, buttons);
}

// --- Resizing one grid --------------------------------------------------------

// The edge/direction vocabulary is pure geometry and lives in categoryGrid.ts;
// re-exported here so callers keep one import for the whole resize story.
export type { GridResizeDirection, GridResizeEdge } from '@/utils/categoryGrid';

export interface GridResizePlan {
    /** The category as it would look afterwards. */
    category: CategoryConfig;
    /** Dimensions before / after, for the UI wording. */
    from: GridDimensions;
    to: GridDimensions;
    /**
     * Tools standing on the stripe that would be cut away. Empty for every
     * growth and for shrinking into empty space — the caller asks for a
     * confirmation exactly when this is non-empty.
     */
    removed: ButtonConfig[];
}

/**
 * Resize the ONE grid the user is editing to explicit dimensions.
 *
 * Writes the size onto the grid that owns it (the variant, or the category for
 * a static grid) and remaps every button coordinate-aware, so growing never
 * reflows the existing arrangement and shrinking removes exactly the outer
 * stripe. Returns null when the category has no addressable grid or when the
 * requested size equals the current one.
 *
 * Nothing is persisted here: the result is a PLAN. The caller commits it —
 * after a confirmation when `removed` is non-empty.
 */
export function planGridResize(
    category: CategoryConfig,
    variantId: string | null,
    next: GridDimensions
): GridResizePlan | null {
    if (!isGridCategory(category)) {
        return null;
    }
    const to = clampGridDimensions(next);
    const targetVariant =
        variantId !== null
            ? findVariant(category, variantId)
            : isDynamicCategory(category)
              ? (getCategoryVariants(category)[0] ?? null)
              : null;
    if (isDynamicCategory(category) && !targetVariant) {
        return null;
    }

    const from = readGridDimensions(targetVariant ?? category);
    if (sameGridDimensions(from, to)) {
        return null;
    }

    const stored = targetVariant ? targetVariant.buttons : category.buttons;
    const resized = resizeGridButtons(stored, from, to);

    const nextCategory: CategoryConfig = targetVariant
        ? withVariants(
              category,
              getCategoryVariants(category).map((variant) =>
                  variant.id === targetVariant.id
                      ? {
                            ...variant,
                            rows: to.rows,
                            columns: to.columns,
                            buttons: resized.buttons,
                        }
                      : variant
              )
          )
        : { ...category, rows: to.rows, columns: to.columns, buttons: resized.buttons };

    return { category: nextCategory, from, to, removed: resized.removed };
}

/**
 * The grid a resize WOULD render, computed from a resolved view and touching
 * no stored data at all.
 *
 * This is what the drag handle shows while the pointer is still down: the same
 * coordinate-aware core the commit uses (`resizeGridButtons` +
 * `placeButtonsOnGrid`), so the preview cannot disagree with the result. Tools
 * on a stripe the preview cuts away simply do not appear — they are still in
 * the settings and only a confirmed pointer-up removes them.
 */
export function previewResizedSlots(
    view: ResolvedGridView,
    to: GridDimensions
): (ButtonConfig | null)[] {
    const resized = resizeGridButtons(effectiveGridButtons(view), view.dimensions, to);
    return placeButtonsOnGrid(resized.buttons, to).slots;
}

/**
 * One step of the grid resize controls: add or remove the outermost row /
 * column. Only the right column and the bottom row are addressable — a
 * predictable model beats "insert anywhere" for a panel this small — and the
 * 1x1 .. 5x5 bounds are enforced here, so a control at its limit simply has
 * nothing to do.
 */
export function planGridResizeStep(
    category: CategoryConfig,
    variantId: string | null,
    edge: GridResizeEdge,
    direction: GridResizeDirection
): GridResizePlan | null {
    const current = gridDimensionsOf(category, variantId);
    const next =
        edge === 'row'
            ? { rows: current.rows + direction, columns: current.columns }
            : { rows: current.rows, columns: current.columns + direction };
    if (
        next.rows < 1 ||
        next.columns < 1 ||
        next.rows > MAX_GRID_ROWS ||
        next.columns > MAX_GRID_COLUMNS
    ) {
        return null;
    }
    return planGridResize(category, variantId, next);
}

// --- Lifting per-button conditions (legacy flow data) -------------------------

/**
 * Stable stringification for grouping: object keys are sorted, so two buttons
 * carrying the same rule group together regardless of the key order their JSON
 * happened to be written in.
 */
export function canonicalConditionKey(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalConditionKey).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalConditionKey(record[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

/**
 * Short, data-derived label for a generated variant ("type = A", "#todo").
 * Deliberately not translated: it is generated once from the user's own rule
 * and is freely renameable afterwards. Null when the rule is too complex for a
 * one-liner.
 */
export function describeConditionForName(condition: ButtonCondition): string | null {
    if ('all' in condition) {
        return condition.all.length === 1
            ? describeConditionForName(condition.all[0]!)
            : null;
    }
    if ('any' in condition) {
        return condition.any.length === 1
            ? describeConditionForName(condition.any[0]!)
            : null;
    }
    if ('not' in condition) {
        const inner = describeConditionForName(condition.not);
        return inner === null ? null : `not ${inner}`;
    }
    switch (condition.rule) {
        case 'property':
            return condition.op === 'exists'
                ? `${condition.key} exists`
                : `${condition.key} = ${String(condition.value)}`;
        case 'tag':
            return `#${condition.value.replace(/^#/, '')}`;
        case 'extension':
            return `.${condition.value.replace(/^\./, '')}`;
        case 'folder':
        case 'path':
        case 'viewType':
            return condition.value;
    }
    return null;
}

export interface ConditionGroup {
    /** The shared condition of this group. */
    condition: ButtonCondition;
    /** Data-derived label, or a neutral `Context N` fallback. */
    name: string;
    /** Buttons carrying that condition, stripped of the per-button copy. */
    buttons: ButtonConfig[];
}

export interface LiftedButtonConditions {
    /** Buttons without a (valid) condition. */
    base: ButtonConfig[];
    /** One group per distinct condition, in first-appearance order. */
    groups: ConditionGroup[];
}

/**
 * Split a flat button list into a condition-free base plus one group per
 * distinct valid condition. Used by the flow -> grid conversion (to build a
 * dynamic category out of a flow category with per-button conditions) and by
 * the legacy v1 -> v2 settings migration.
 *
 * - no condition: stays in the base list;
 * - a structurally INVALID condition: stays in the base list and keeps that
 *   condition untouched. It failed open (the button was always visible), so
 *   base is the behavior-preserving home, and the data is kept rather than
 *   discarded;
 * - a valid condition: moves into its group and loses the now-redundant
 *   per-button copy.
 *
 * Deterministic and reproducible — a migration must never depend on a clock or
 * a random source.
 */
export function liftButtonConditions(
    buttons: readonly ButtonConfig[]
): LiftedButtonConditions {
    const base: ButtonConfig[] = [];
    const order: string[] = [];
    const grouped = new Map<string, { condition: ButtonCondition; buttons: ButtonConfig[] }>();

    for (const button of buttons) {
        const condition = button.conditions;
        if (condition === undefined || condition === null || !isValidCondition(condition)) {
            base.push(button);
            continue;
        }
        const key = canonicalConditionKey(condition);
        let group = grouped.get(key);
        if (!group) {
            group = { condition, buttons: [] };
            grouped.set(key, group);
            order.push(key);
        }
        const { conditions: _lifted, ...rest } = button;
        group.buttons.push(rest);
    }

    const groups = order.map((key, index) => {
        const group = grouped.get(key)!;
        return {
            condition: group.condition,
            name: describeConditionForName(group.condition) ?? `Context ${index + 1}`,
            buttons: group.buttons.map((button, i) => ({ ...button, order: i })),
        };
    });

    return { base: base.map((button, i) => ({ ...button, order: i })), groups };
}

// --- Layout conversion (flow <-> grid) ----------------------------------------

/**
 * Conversion of an existing flow category to the grid layout.
 *
 * Buttons keep their relative order and are laid out left-to-right, top-to-
 * bottom on slots 0..n-1.
 *
 * - A flow category WITHOUT per-button conditions becomes a STATIC grid.
 * - A flow category WITH per-button conditions becomes a DYNAMIC category,
 *   because a grid ignores per-button conditions and silently making every
 *   conditional tool permanent would be data loss in disguise: the
 *   condition-free tools become the fallback variant ("Default"), and each
 *   distinct condition becomes one triggered variant holding the
 *   condition-free tools PLUS that condition's tools — full variants, exactly
 *   like the settings migration produces. Structurally invalid conditions stay
 *   on their button as inert data (they failed open before).
 *
 * Refuses (returns `ok: false`) when the category holds more buttons than the
 * grid has slots, rather than dropping or hiding any of them. Converting a
 * DYNAMIC category back to flow is refused as well — collapsing several
 * complete variants into one list would lose data; the user must stay in the
 * grid world or delete variants deliberately.
 */
export type GridConversionResult =
    | { ok: true; category: CategoryConfig }
    | { ok: false; reason: 'too_many_buttons'; buttonCount: number; slotCount: number }
    | { ok: false; reason: 'dynamic_category' };

/** Deterministic derived id for buttons copied into a generated variant. */
function derivedButtonId(variantId: string, originalId: string): string {
    return `${variantId}--${originalId}`;
}

/**
 * Compose ONE full triggered variant out of a shared base grid plus an
 * overlay button set (the migration/composition rule): the variant holds the
 * complete base grid PLUS the overlay's tools, exactly on the slots the old
 * layered model rendered them (overlay slots colliding with base slots
 * relocate deterministically). Base buttons get deterministic derived ids so
 * every button id stays unique across variants; nothing is shared between the
 * inputs and the result.
 */
export function composeFullVariant(
    base: readonly ButtonConfig[],
    overlay: readonly ButtonConfig[],
    variantId: string,
    name: string,
    trigger: ButtonCondition,
    /**
     * Grid of the composed variant. `null` writes no size fields at all, which
     * is what the v2 -> v3 settings migration needs: absent fields already mean
     * the 4x4 those variants were, so stored data stays byte-identical.
     */
    dimensions: GridDimensions | null = null
): CategoryVariant {
    const grid = dimensions ?? LEGACY_GRID_DIMENSIONS;
    const baseOccupied = placeButtonsOnGrid(base, grid).slots.map(
        (button) => button !== null
    );
    const baseCopies = base.map((button) => ({
        ...button,
        id: derivedButtonId(variantId, button.id),
        actions: button.actions?.map((action) => ({ ...action })) ?? [],
    }));
    const overlayPlacement = placeButtonsOnGrid(overlay, grid, { blocked: baseOccupied });
    const overlayButtons: ButtonConfig[] = [];
    overlayPlacement.slots.forEach((button, slot) => {
        if (button) overlayButtons.push({ ...button, slot });
    });
    overlayButtons.push(...overlayPlacement.overflow.map((button) => ({ ...button })));
    return {
        id: variantId,
        name,
        trigger,
        ...(dimensions === null ? {} : clampGridDimensions(dimensions)),
        buttons: [...baseCopies, ...overlayButtons].map((button, order) => ({
            ...button,
            order,
        })),
    };
}

/** The base-only state as an explicit fallback variant ("Default"). */
export function composeFallbackVariant(
    base: readonly ButtonConfig[],
    variantId: string,
    name = 'Default',
    dimensions: GridDimensions | null = null
): CategoryVariant {
    return {
        id: variantId,
        name,
        fallback: true,
        ...(dimensions === null ? {} : clampGridDimensions(dimensions)),
        buttons: base.map((button, order) => ({
            ...button,
            order,
            actions: button.actions?.map((action) => ({ ...action })) ?? [],
        })),
    };
}

/**
 * Compose full variants out of a condition-free base list plus condition
 * groups: every triggered variant holds the complete base grid PLUS its
 * group's tools, and the base-only state becomes the fallback variant (when
 * the base holds anything at all).
 */
export function composeVariantsFromConditionGroups(
    base: readonly ButtonConfig[],
    groups: readonly ConditionGroup[],
    idPrefix: string,
    dimensions: GridDimensions | null = null
): CategoryVariant[] {
    const variants: CategoryVariant[] = groups.map((group, index) =>
        composeFullVariant(
            base,
            group.buttons,
            `${idPrefix}-var-${index + 1}`,
            group.name,
            group.condition,
            dimensions
        )
    );
    if (base.length > 0) {
        variants.push(
            composeFallbackVariant(base, `${idPrefix}-fallback`, 'Default', dimensions)
        );
    }
    return variants;
}

export function convertCategoryToGrid(category: CategoryConfig): GridConversionResult {
    // The new grid is sized to actually hold the flow list — starting at the
    // default width and growing only as far as the buttons require.
    const dimensions = fitGridDimensions(category.buttons.length);
    if (!dimensions) {
        return {
            ok: false,
            reason: 'too_many_buttons',
            buttonCount: category.buttons.length,
            slotCount: MAX_GRID_ROWS * MAX_GRID_COLUMNS,
        };
    }

    const positioned = buttonsInOrder(category.buttons).map((button, index) => ({
        ...button,
        order: index,
        slot: index,
    }));

    const { base, groups } = liftButtonConditions(positioned);
    if (groups.length === 0) {
        // No conditional tools: a plain static grid.
        return {
            ok: true,
            category: {
                ...category,
                layout: 'grid',
                rows: dimensions.rows,
                columns: dimensions.columns,
                buttons: base,
            },
        };
    }

    // Every composed variant holds the base grid PLUS its group, so the size
    // has to cover both — `category.buttons.length` is that upper bound.
    const variants = composeVariantsFromConditionGroups(
        base,
        groups,
        category.id,
        dimensions
    );
    const { rows: _rows, columns: _columns, ...rest } = category;
    return {
        ok: true,
        category: { ...rest, layout: 'grid', buttons: [], variants },
    };
}

/**
 * Conversion of a STATIC grid category back to flow: slots are dropped and the
 * buttons keep their spatial reading order (slot 0 first), so the flow list
 * matches what the user last saw.
 */
export function convertStaticGridToFlow(category: CategoryConfig): CategoryConfig {
    const placement = placeButtonsOnGrid(category.buttons, readGridDimensions(category));
    const ordered: ButtonConfig[] = [
        ...placement.slots.filter((b): b is ButtonConfig => b !== null),
        ...placement.overflow,
    ];
    const buttons = ordered.map((button, index) => {
        const { slot: _slot, ...rest } = button;
        return { ...rest, order: index };
    });
    // A flow category has no grid, so it carries no grid dimensions either.
    const { layout: _layout, rows: _rows, columns: _columns, ...categoryRest } = category;
    return { ...categoryRest, layout: 'flow', buttons };
}

/**
 * Apply a category's layout choice, converting the buttons when the layout
 * actually changes. Returns the same category reference when nothing changes.
 * A DYNAMIC category refuses the switch to flow (see convertCategoryToGrid).
 */
export function applyCategoryLayout(
    category: CategoryConfig,
    layout: CategoryLayout
): GridConversionResult {
    const current = getCategoryLayout(category);
    if (current === layout) {
        return { ok: true, category };
    }
    if (layout === 'grid') {
        return convertCategoryToGrid(category);
    }
    if (isDynamicCategory(category)) {
        return { ok: false, reason: 'dynamic_category' };
    }
    return { ok: true, category: convertStaticGridToFlow(category) };
}
