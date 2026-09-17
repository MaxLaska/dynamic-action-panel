// categoryVariants.ts
// Pure model of the OCAP dynamic category variants.
//
// Product model (see docs/ocap/DECISIONS.md):
// - a grid category is either STATIC or DYNAMIC;
// - a static grid category has one full 4x4 grid in `category.buttons` and no
//   context behavior at all;
// - a dynamic grid category is ONE stable container holding several COMPLETE
//   variants (`category.variants`); each variant owns a full, independent grid
//   plus exactly one trigger condition — or it is the single fallback variant;
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
    GRID_SLOT_COUNT,
    buttonsInOrder,
    findFirstFreeSlot,
    getCategoryLayout,
    isGridCategory,
    placeButtonsOnGrid,
    type CategoryLayout,
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
    /** Always GRID_SLOT_COUNT entries; index === slot. */
    slots: (ButtonConfig | null)[];
    /** Buttons that could not be placed. Never dropped, rendered separately. */
    overflow: ButtonConfig[];
}

function emptyView(reason: GridViewReason): ResolvedGridView {
    return {
        variantId: null,
        reason,
        slots: new Array<ButtonConfig | null>(GRID_SLOT_COUNT).fill(null),
        overflow: [],
    };
}

function viewOfButtons(
    buttons: readonly ButtonConfig[],
    variantId: string | null,
    reason: GridViewReason
): ResolvedGridView {
    const placement = placeButtonsOnGrid(buttons);
    return { variantId, reason, slots: placement.slots, overflow: placement.overflow };
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
        return viewOfButtons(category.buttons, null, 'static');
    }
    const variants = getCategoryVariants(category);
    const variant =
        (variantId !== null ? findVariant(category, variantId) : null) ?? variants[0] ?? null;
    if (!variant) {
        return emptyView('selected');
    }
    return viewOfButtons(variant.buttons, variant.id, 'selected');
}

/** Grid view for the current context (locked mode). */
export function resolveGridViewForContext(
    category: CategoryConfig,
    context: OCAPContextSnapshot
): ResolvedGridView {
    if (!isDynamicCategory(category)) {
        return viewOfButtons(category.buttons, null, 'static');
    }
    const resolution = resolveDynamicCategoryVariant(category, context);
    if (!resolution.variant) {
        return emptyView('none');
    }
    return viewOfButtons(resolution.variant.buttons, resolution.variant.id, resolution.reason);
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

function makeVariant(draft: VariantDraft, buttons: ButtonConfig[]): CategoryVariant {
    if (draft.fallback === true) {
        return { id: draft.id, name: draft.name, fallback: true, buttons };
    }
    return {
        id: draft.id,
        name: draft.name,
        ...(draft.trigger !== undefined ? { trigger: draft.trigger } : {}),
        buttons,
    };
}

/** Append a new (empty) variant. Returns the category unchanged if the draft
 * would introduce a second fallback. */
export function addVariant(
    category: CategoryConfig,
    draft: VariantDraft
): CategoryConfig {
    if (draft.fallback === true && findFallbackVariant(category) !== null) {
        return category;
    }
    return withVariants(category, [
        ...getCategoryVariants(category),
        makeVariant(draft, []),
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
            variant.buttons
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
 * decides its name and trigger).
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
        }))
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
 * grid becomes the first variant exactly as it is (same buttons, same slots),
 * so no button is lost and nothing moves. The draft decides the variant's
 * name and trigger (or fallback).
 */
export function convertStaticGridToDynamic(
    category: CategoryConfig,
    draft: VariantDraft
): CategoryConfig {
    return {
        ...category,
        buttons: [],
        variants: [makeVariant(draft, category.buttons)],
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
 * Append a button to a variant (or to the static grid when `variantId` is
 * null), giving it the lowest free slot. Returns null when the grid is full —
 * the caller must tell the user instead of dropping the tool.
 */
export function addButtonToGrid(
    category: CategoryConfig,
    variantId: string | null,
    button: ButtonConfig
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
    const slot = findFirstFreeSlot(
        placeButtonsOnGrid(existing).slots.map((b) => b?.id ?? null)
    );
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
 * `slotIds` is the live 4x4 drag state of the ONE grid on screen: the static
 * grid, or the variant currently selected in the editor (`targetVariantId`).
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

    const placed: ButtonConfig[] = [];
    const claimed = new Set<string>();
    for (let slot = 0; slot < GRID_SLOT_COUNT; slot++) {
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
    trigger: ButtonCondition
): CategoryVariant {
    const baseOccupied = placeButtonsOnGrid(base).slots.map((button) => button !== null);
    const baseCopies = base.map((button) => ({
        ...button,
        id: derivedButtonId(variantId, button.id),
        actions: button.actions?.map((action) => ({ ...action })) ?? [],
    }));
    const overlayPlacement = placeButtonsOnGrid(overlay, { blocked: baseOccupied });
    const overlayButtons: ButtonConfig[] = [];
    overlayPlacement.slots.forEach((button, slot) => {
        if (button) overlayButtons.push({ ...button, slot });
    });
    overlayButtons.push(...overlayPlacement.overflow.map((button) => ({ ...button })));
    return {
        id: variantId,
        name,
        trigger,
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
    name = 'Default'
): CategoryVariant {
    return {
        id: variantId,
        name,
        fallback: true,
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
    idPrefix: string
): CategoryVariant[] {
    const variants: CategoryVariant[] = groups.map((group, index) =>
        composeFullVariant(
            base,
            group.buttons,
            `${idPrefix}-var-${index + 1}`,
            group.name,
            group.condition
        )
    );
    if (base.length > 0) {
        variants.push(composeFallbackVariant(base, `${idPrefix}-fallback`));
    }
    return variants;
}

export function convertCategoryToGrid(category: CategoryConfig): GridConversionResult {
    if (category.buttons.length > GRID_SLOT_COUNT) {
        return {
            ok: false,
            reason: 'too_many_buttons',
            buttonCount: category.buttons.length,
            slotCount: GRID_SLOT_COUNT,
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
        return { ok: true, category: { ...category, layout: 'grid', buttons: base } };
    }

    const variants = composeVariantsFromConditionGroups(base, groups, category.id);
    return {
        ok: true,
        category: { ...category, layout: 'grid', buttons: [], variants },
    };
}

/**
 * Conversion of a STATIC grid category back to flow: slots are dropped and the
 * buttons keep their spatial reading order (slot 0 first), so the flow list
 * matches what the user last saw.
 */
export function convertStaticGridToFlow(category: CategoryConfig): CategoryConfig {
    const placement = placeButtonsOnGrid(category.buttons);
    const ordered: ButtonConfig[] = [
        ...placement.slots.filter((b): b is ButtonConfig => b !== null),
        ...placement.overflow,
    ];
    const buttons = ordered.map((button, index) => {
        const { slot: _slot, ...rest } = button;
        return { ...rest, order: index };
    });
    const { layout: _layout, ...categoryRest } = category;
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
