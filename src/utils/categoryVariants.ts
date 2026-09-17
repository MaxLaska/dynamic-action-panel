// categoryVariants.ts
// Pure model of the dynamic category variants.
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
import type { WorkspaceContextSnapshot } from '@/context/workspaceContext';
import { evaluateCondition, isValidCondition } from '@/context/conditions';
import {
    LEGACY_GRID_DIMENSIONS,
    MAX_GRID_COLUMNS,
    MAX_GRID_ROWS,
    buttonsInOrder,
    clampGridDimensions,
    fitGridDimensions,
    getCategoryLayout,
    gridSlotCount,
    isGridCategory,
    placeButtonsOnGrid,
    readGridDimensions,
    resizeGridButtons,
    type CategoryLayout,
    type GridDimensions,
} from '@/utils/categoryGrid';

// --- Basic accessors ---------------------------------------------------------
//
// The accessors are GENERIC over the variant shape, because two shapes share
// this vocabulary since settings v5: the stored world (StoredVariant with
// `placements`) that every write path operates on, and the runtime view
// world (CategoryVariant with `buttons`) the renderers consume. Everything
// they touch — ids, names, triggers, fallback flags, grid dimensions,
// priority order — is identical in both.

/** The fields both variant shapes share (see StoredVariant / CategoryVariant). */
export interface VariantFields {
    id: string;
    name: string;
    trigger?: ButtonCondition;
    fallback?: boolean;
    rows?: number;
    columns?: number;
}

/**
 * The fields both category shapes share, as far as the accessors need them.
 * Parameters below are written as inline structural types (not Pick of this)
 * so TypeScript can INFER the concrete variant type from the argument.
 */
export interface CategoryVariantsHost<V extends VariantFields> {
    layout?: 'flow' | 'grid';
    variants?: V[];
    rows?: number;
    columns?: number;
}

/** A structurally valid variant of either shape (stored or view). */
function isVariantShaped(value: unknown): value is VariantFields {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as { id?: unknown; buttons?: unknown; placements?: unknown };
    return (
        typeof record.id === 'string' &&
        (Array.isArray(record.buttons) || Array.isArray(record.placements))
    );
}

/** Variants of a category, defensively normalized (never null/undefined). */
export function getCategoryVariants<V extends VariantFields>(category: {
    variants?: V[];
}): V[] {
    const variants = category.variants;
    if (!Array.isArray(variants)) {
        return [];
    }
    return variants.filter((variant): variant is V => isVariantShaped(variant));
}

/** True for a `layout: 'grid'` category that carries variants (dynamic). */
export function isDynamicCategory(category: {
    layout?: 'flow' | 'grid';
    variants?: unknown;
}): boolean {
    return isGridCategory(category) && Array.isArray(category.variants);
}

/** True for a `layout: 'grid'` category without variants (static grid). */
export function isStaticGridCategory(category: {
    layout?: 'flow' | 'grid';
    variants?: unknown;
}): boolean {
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
export function gridDimensionsOf<V extends VariantFields>(
    category: {
        layout?: 'flow' | 'grid';
        variants?: V[];
        rows?: number;
        columns?: number;
    },
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

export function findVariant<V extends VariantFields>(
    category: { variants?: V[] },
    variantId: string
): V | null {
    return getCategoryVariants(category).find((variant) => variant.id === variantId) ?? null;
}

/** The single fallback variant, or null. */
export function findFallbackVariant<V extends VariantFields>(category: {
    variants?: V[];
}): V | null {
    return getCategoryVariants(category).find((variant) => variant.fallback === true) ?? null;
}

/** Triggered (non-fallback) variants in priority order. */
export function triggeredVariants<V extends VariantFields>(category: {
    variants?: V[];
}): V[] {
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
 *   Resolution deliberately does not fail open: a corrupt always-matching variant
 *   would shadow every variant below it, whereas a skipped variant only loses
 *   itself in locked mode and stays fully selectable and repairable in the
 *   management modes (where it is marked as broken).
 */
export function variantTriggerMatches(
    variant: Pick<CategoryVariant, 'trigger' | 'fallback'>,
    context: WorkspaceContextSnapshot
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

export interface VariantResolution<V extends VariantFields = CategoryVariant> {
    variant: V | null;
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
export function resolveDynamicCategoryVariant<V extends VariantFields>(
    category: { variants?: V[] },
    context: WorkspaceContextSnapshot
): VariantResolution<V> {
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
    context: WorkspaceContextSnapshot
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

// --- Variant management (pure, immutable, shape-generic) ----------------------
//
// Only the operations that touch nothing but the variant METADATA (name,
// trigger, fallback, order) live here — they are identical for both shapes.
// Operations that create variants, copy tools or resize grids live in
// src/domain/categoryOps.ts, because since v5 they involve the tool registry.

export interface VariantDraft {
    id: string;
    name: string;
    trigger?: ButtonCondition;
    fallback?: boolean;
}

/**
 * Update a variant's name, trigger and fallback flag. `trigger` is always
 * assigned, so clearing the editor really removes a previously configured
 * rule. Refused (same reference returned) when the update would create a
 * second fallback. Everything else on the variant — its grid content and its
 * stored dimension fields (absent stays absent) — passes through untouched.
 */
export function updateVariant<
    V extends VariantFields,
    C extends { variants?: V[] },
>(
    category: C & { variants?: V[] },
    variantId: string,
    patch: { name: string; trigger: ButtonCondition | undefined; fallback: boolean }
): C {
    if (patch.fallback) {
        const existing = findFallbackVariant(category);
        if (existing && existing.id !== variantId) {
            return category;
        }
    }
    const variants = getCategoryVariants<V>(category).map((variant) => {
        if (variant.id !== variantId) {
            return variant;
        }
        const next: V = { ...variant, name: patch.name };
        if (patch.fallback) {
            next.fallback = true;
            delete next.trigger;
        } else {
            delete next.fallback;
            if (patch.trigger !== undefined) {
                next.trigger = patch.trigger;
            } else {
                delete next.trigger;
            }
        }
        return next;
    });
    return { ...category, variants };
}

export function removeVariant<
    V extends VariantFields,
    C extends { variants?: V[] },
>(category: C & { variants?: V[] }, variantId: string): C {
    return {
        ...category,
        variants: getCategoryVariants<V>(category).filter(
            (variant) => variant.id !== variantId
        ),
    };
}

/**
 * Move a variant one position up or down. Order IS priority for triggered
 * variants (first match wins). The fallback variant is not movable — its
 * position never affects resolution — and other variants do not move past it.
 */
export function moveVariant<
    V extends VariantFields,
    C extends { variants?: V[] },
>(category: C & { variants?: V[] }, variantId: string, direction: -1 | 1): C {
    const variants = getCategoryVariants<V>(category);
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
    return { ...category, variants: next };
}

// --- Resize preview (view world) ----------------------------------------------

// The edge/direction vocabulary is pure geometry and lives in categoryGrid.ts;
// re-exported here so callers keep one import for the whole resize story.
export type { GridResizeDirection, GridResizeEdge } from '@/utils/categoryGrid';

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
    // A flow category has no grid, so it carries neither grid dimensions nor
    // grid cell styles.
    const {
        layout: _layout,
        rows: _rows,
        columns: _columns,
        cellStyles: _cellStyles,
        ...categoryRest
    } = category;
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
