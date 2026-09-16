// paletteLayers.ts
// Pure model of the OCAP palette context layers.
//
// Product model (see docs/ocap/DECISIONS.md):
// - a grid category is a stable tool palette with 16 spatial slots;
// - its own `buttons` array is the BASE / PINNED layer: always present, and the
//   slots it occupies are reserved in every context profile;
// - `contextProfiles` are named alternative layers, each owning exactly one
//   condition and its own slot assignments;
// - at runtime the FIRST profile whose condition matches wins; profiles are
//   never merged, so every filled slot is attributable to exactly one layer;
// - a slot's spatial identity never depends on the context: switching contexts
//   changes what sits on a slot, never where a tool sits.
//
// Everything here is pure: no mutation of the inputs, no Obsidian imports, no
// stored functions. Edits follow the immutable-edit convention from
// DECISIONS.md (changed objects are replaced, unchanged ones keep identity).

import type { ButtonConfig, CategoryConfig, ContextProfile } from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import type { OCAPContextSnapshot } from '@/context/OCAPContext';
import { evaluateCondition, isValidCondition } from '@/context/conditions';
import {
    GRID_SLOT_COUNT,
    buttonsInOrder,
    getCategoryLayout,
    isGridCategory,
    isValidSlotIndex,
    placeButtonsOnGrid,
    type CategoryLayout,
} from '@/utils/categoryGrid';

/**
 * Layer id of the base/pinned layer. Deliberately not a valid profile id
 * shape, and never persisted — it only addresses a layer in the UI and in the
 * pure helpers below.
 */
export const BASE_LAYER_ID = '__base__';

/** Either BASE_LAYER_ID or a context profile's id. */
export type PaletteLayerId = string;

/** Layer selection of the management UI, per category id. */
export type PaletteLayerSelection = Readonly<Record<string, PaletteLayerId>>;

export function isBaseLayer(layerId: PaletteLayerId): boolean {
    return layerId === BASE_LAYER_ID;
}

/** Context profiles of a category, defensively normalized (never null/undefined). */
export function getContextProfiles(
    category: Pick<CategoryConfig, 'contextProfiles'>
): ContextProfile[] {
    const profiles = category.contextProfiles;
    if (!Array.isArray(profiles)) {
        return [];
    }
    return profiles.filter(
        (profile): profile is ContextProfile =>
            typeof profile === 'object' &&
            profile !== null &&
            typeof profile.id === 'string' &&
            Array.isArray(profile.buttons)
    );
}

export function findContextProfile(
    category: Pick<CategoryConfig, 'contextProfiles'>,
    profileId: string
): ContextProfile | null {
    return getContextProfiles(category).find((profile) => profile.id === profileId) ?? null;
}

/** True when this category uses the layered palette model at all. */
export function isPaletteCategory(category: Pick<CategoryConfig, 'layout'>): boolean {
    return isGridCategory(category);
}

/**
 * Whether a profile's condition holds in the given context.
 *
 * - absent condition: matches (a deliberate always-on fallback layer);
 * - structurally invalid condition: does NOT match. This is the one place
 *   where OCAP deliberately does not fail open: a corrupt always-matching
 *   profile would shadow every profile below it and make their tools
 *   permanently unreachable, whereas a skipped profile only loses its own
 *   tools in locked mode — and those stay fully visible and editable in the
 *   management modes, where the profile can be selected and repaired.
 */
export function isProfileMatching(
    profile: Pick<ContextProfile, 'conditions'>,
    context: OCAPContextSnapshot
): boolean {
    const conditions = profile.conditions;
    if (conditions === undefined || conditions === null) {
        return true;
    }
    if (!isValidCondition(conditions)) {
        return false;
    }
    return evaluateCondition(conditions, context);
}

/**
 * The profile that governs the palette in this context: the first match in
 * profile order. Returns null when no profile matches (base layer only).
 */
export function selectActiveProfile(
    category: Pick<CategoryConfig, 'contextProfiles'>,
    context: OCAPContextSnapshot
): ContextProfile | null {
    for (const profile of getContextProfiles(category)) {
        if (isProfileMatching(profile, context)) {
            return profile;
        }
    }
    return null;
}

/** One resolved cell of the palette. */
export interface PaletteSlot {
    /** Stable spatial identity, 0..GRID_SLOT_COUNT - 1. */
    slot: number;
    /** Button occupying the slot, or null when the slot is empty here. */
    button: ButtonConfig | null;
    /** Layer the button comes from; null for an empty slot. */
    source: PaletteLayerId | null;
    /**
     * Occupied by the base layer, i.e. reserved in every context profile.
     * Pinned slots can never be taken or overwritten by a profile.
     */
    pinned: boolean;
    /**
     * Names of OTHER context profiles occupying this slot. Purely informational
     * for the management UI (a base-layer edit must not silently displace
     * them), never a runtime concern.
     */
    reservedBy: string[];
    /** The resolved layer may not place a button here (see `blocked` below). */
    blocked: boolean;
}

export interface ResolvedPalette {
    /** Layer whose content is shown (BASE_LAYER_ID or a profile id). */
    layerId: PaletteLayerId;
    /** Profile contributing content, or null when only the base layer applies. */
    activeProfileId: string | null;
    /** Always GRID_SLOT_COUNT entries; index === slot. */
    slots: PaletteSlot[];
    /** Buttons that could not be placed. Never dropped, rendered separately. */
    overflow: ButtonConfig[];
}

function emptyBooleans(): boolean[] {
    return new Array<boolean>(GRID_SLOT_COUNT).fill(false);
}

/** Slots taken by the base/pinned layer. */
export function baseSlotOccupancy(category: CategoryConfig): boolean[] {
    return placeButtonsOnGrid(category.buttons).slots.map((button) => button !== null);
}

/**
 * Per-slot placement of every context profile, with base slots already
 * reserved. Used both for resolution and for the "reserved by other contexts"
 * information the base layer editor needs.
 */
function placeAllProfiles(
    category: CategoryConfig,
    pinned: readonly boolean[]
): Map<string, (ButtonConfig | null)[]> {
    const byProfile = new Map<string, (ButtonConfig | null)[]>();
    for (const profile of getContextProfiles(category)) {
        byProfile.set(
            profile.id,
            placeButtonsOnGrid(profile.buttons, { blocked: pinned }).slots
        );
    }
    return byProfile;
}

/**
 * Slots the given layer must not occupy:
 * - a context profile is blocked by every base/pinned slot;
 * - the base layer is blocked by slots that context profiles already use,
 *   because taking one would silently make that profile's tool unplaceable.
 *   Blocking and explaining beats a silent overwrite (see DECISIONS.md).
 */
export function blockedSlotsForLayer(
    category: CategoryConfig,
    layerId: PaletteLayerId
): boolean[] {
    const pinned = baseSlotOccupancy(category);
    if (!isBaseLayer(layerId)) {
        return pinned;
    }
    const blocked = emptyBooleans();
    for (const slots of placeAllProfiles(category, pinned).values()) {
        for (let i = 0; i < GRID_SLOT_COUNT; i++) {
            if (slots[i]) {
                blocked[i] = true;
            }
        }
    }
    return blocked;
}

/** Buttons stored in one layer (base array or a profile's array). */
export function layerButtons(
    category: CategoryConfig,
    layerId: PaletteLayerId
): ButtonConfig[] {
    if (isBaseLayer(layerId)) {
        return category.buttons;
    }
    return findContextProfile(category, layerId)?.buttons ?? [];
}

/**
 * Resolve the palette for one specific layer. This is what the management UI
 * renders: the base layer is always visible (pinned and locked while a profile
 * is selected), the selected profile fills the slots the base leaves free.
 *
 * Pure: the stored category is never mutated and the returned buttons are the
 * stored objects (identities preserved for the React memo contract).
 */
export function resolvePaletteLayer(
    category: CategoryConfig,
    layerId: PaletteLayerId
): ResolvedPalette {
    const basePlacement = placeButtonsOnGrid(category.buttons);
    const pinned = basePlacement.slots.map((button) => button !== null);
    const profilePlacements = placeAllProfiles(category, pinned);

    const activeProfile = isBaseLayer(layerId) ? null : findContextProfile(category, layerId);
    const emptyPlacement = (): (ButtonConfig | null)[] =>
        new Array<ButtonConfig | null>(GRID_SLOT_COUNT).fill(null);
    const activeSlots: (ButtonConfig | null)[] = activeProfile
        ? (profilePlacements.get(activeProfile.id) ?? emptyPlacement())
        : emptyPlacement();

    const overflow = [...basePlacement.overflow];
    if (activeProfile) {
        overflow.push(
            ...placeButtonsOnGrid(activeProfile.buttons, { blocked: pinned }).overflow
        );
    }

    const effectiveLayerId = activeProfile ? activeProfile.id : BASE_LAYER_ID;
    const blocked = blockedSlotsForLayer(category, effectiveLayerId);

    const slots: PaletteSlot[] = [];
    for (let slot = 0; slot < GRID_SLOT_COUNT; slot++) {
        const baseButton = basePlacement.slots[slot] ?? null;
        const profileButton = activeSlots[slot] ?? null;
        const reservedBy: string[] = [];
        for (const profile of getContextProfiles(category)) {
            if (profile.id === activeProfile?.id) continue;
            if (profilePlacements.get(profile.id)?.[slot]) {
                reservedBy.push(profile.name);
            }
        }
        slots.push({
            slot,
            button: baseButton ?? profileButton,
            source:
                baseButton !== null
                    ? BASE_LAYER_ID
                    : profileButton !== null
                      ? effectiveLayerId
                      : null,
            pinned: baseButton !== null,
            reservedBy,
            blocked: blocked[slot] === true,
        });
    }

    return {
        layerId: effectiveLayerId,
        activeProfileId: activeProfile ? activeProfile.id : null,
        slots,
        overflow,
    };
}

/**
 * Runtime resolution: base layer + the first matching context profile.
 *
 * 1. load the base layer;
 * 2. determine the first matching context profile;
 * 3. apply its slot assignments only to slots the base layer leaves free;
 * 4. produce the effective 4x4 grid.
 *
 * Never mutates stored configuration.
 */
export function resolvePaletteForContext(
    category: CategoryConfig,
    context: OCAPContextSnapshot
): ResolvedPalette {
    const activeProfile = selectActiveProfile(category, context);
    return resolvePaletteLayer(category, activeProfile ? activeProfile.id : BASE_LAYER_ID);
}

/**
 * The resolved palette as a plain button list carrying the slots it resolved
 * to. Feeding this into `placeButtonsOnGrid` reproduces exactly the same
 * arrangement, so the existing renderers need no special casing.
 * A button whose resolved slot differs from its stored one is replaced by a
 * new object (immutable-edit convention); unchanged buttons keep their
 * identity so memoized subtrees stay stable.
 */
export function effectivePaletteButtons(resolved: ResolvedPalette): ButtonConfig[] {
    const buttons: ButtonConfig[] = [];
    for (const slot of resolved.slots) {
        if (!slot.button) continue;
        buttons.push(
            slot.button.slot === slot.slot ? slot.button : { ...slot.button, slot: slot.slot }
        );
    }
    return [...buttons, ...resolved.overflow];
}

/** Ids of the buttons contributed by a context profile (not by the base layer). */
export function contextualButtonIds(resolved: ResolvedPalette): Set<string> {
    const ids = new Set<string>();
    for (const slot of resolved.slots) {
        if (slot.button && slot.source !== BASE_LAYER_ID) {
            ids.add(slot.button.id);
        }
    }
    return ids;
}

/** Layer that stores the given button, or null when the category has no such button. */
export function findButtonLayerId(
    category: CategoryConfig,
    buttonId: string
): PaletteLayerId | null {
    if (category.buttons.some((button) => button.id === buttonId)) {
        return BASE_LAYER_ID;
    }
    for (const profile of getContextProfiles(category)) {
        if (profile.buttons.some((button) => button.id === buttonId)) {
            return profile.id;
        }
    }
    return null;
}

/**
 * Filter every layer of a palette with the same predicate (used by the panel
 * search, which must reach tools in context profiles as well). Returns the
 * same category reference when nothing is filtered out.
 */
export function filterPaletteButtons(
    category: CategoryConfig,
    predicate: (button: ButtonConfig) => boolean
): CategoryConfig {
    const profiles = getContextProfiles(category);
    const buttons = category.buttons.filter(predicate);
    const nextProfiles = profiles.map((profile) => {
        const filtered = profile.buttons.filter(predicate);
        return filtered.length === profile.buttons.length
            ? profile
            : { ...profile, buttons: filtered };
    });
    const profilesChanged = nextProfiles.some((profile, index) => profile !== profiles[index]);
    if (buttons.length === category.buttons.length && !profilesChanged) {
        return category;
    }
    return profiles.length === 0
        ? { ...category, buttons }
        : { ...category, buttons, contextProfiles: nextProfiles };
}

/** Every button of a palette, base layer first, then each profile in order. */
export function allPaletteButtons(category: CategoryConfig): ButtonConfig[] {
    const buttons = [...category.buttons];
    for (const profile of getContextProfiles(category)) {
        buttons.push(...profile.buttons);
    }
    return buttons;
}

/**
 * Lowest slot a new tool of this layer can take: free in the layer itself and
 * not blocked by another layer. Returns null when the layer has no room left.
 */
export function findFreeSlotForLayer(
    category: CategoryConfig,
    layerId: PaletteLayerId
): number | null {
    const resolved = resolvePaletteLayer(category, layerId);
    const ownLayer = isBaseLayer(layerId) ? BASE_LAYER_ID : layerId;
    for (const slot of resolved.slots) {
        const occupiedHere = slot.button !== null && slot.source === ownLayer;
        const occupiedByBase = slot.pinned && ownLayer !== BASE_LAYER_ID;
        if (!occupiedHere && !occupiedByBase && !slot.blocked) {
            return slot.slot;
        }
    }
    return null;
}

// --- Profile management (pure, immutable) -----------------------------------

function withProfiles(
    category: CategoryConfig,
    profiles: ContextProfile[]
): CategoryConfig {
    if (profiles.length === 0) {
        const { contextProfiles: _dropped, ...rest } = category;
        return rest;
    }
    return { ...category, contextProfiles: profiles };
}

export interface ContextProfileDraft {
    id: string;
    name: string;
    conditions?: ButtonCondition;
}

export function addContextProfile(
    category: CategoryConfig,
    draft: ContextProfileDraft
): CategoryConfig {
    const profile: ContextProfile = {
        id: draft.id,
        name: draft.name,
        buttons: [],
        ...(draft.conditions !== undefined ? { conditions: draft.conditions } : {}),
    };
    return withProfiles(category, [...getContextProfiles(category), profile]);
}

/**
 * Update a profile's name and condition. `conditions` is always assigned, so
 * clearing the editor really removes a previously configured rule.
 */
export function updateContextProfile(
    category: CategoryConfig,
    profileId: string,
    patch: { name: string; conditions: ButtonCondition | undefined }
): CategoryConfig {
    const profiles = getContextProfiles(category).map((profile) => {
        if (profile.id !== profileId) {
            return profile;
        }
        const { conditions: _previous, ...rest } = profile;
        return patch.conditions === undefined
            ? { ...rest, name: patch.name }
            : { ...rest, name: patch.name, conditions: patch.conditions };
    });
    return withProfiles(category, profiles);
}

export function removeContextProfile(
    category: CategoryConfig,
    profileId: string
): CategoryConfig {
    return withProfiles(
        category,
        getContextProfiles(category).filter((profile) => profile.id !== profileId)
    );
}

/**
 * Copy a profile including its condition and its complete tool configuration.
 * New ids are generated through `newId` so nothing is shared with the source;
 * the copy is inserted directly below its source, keeping priorities readable.
 */
export function duplicateContextProfile(
    category: CategoryConfig,
    profileId: string,
    newIds: { profileId: string; buttonId: (index: number) => string },
    newName: string
): CategoryConfig {
    const profiles = getContextProfiles(category);
    const index = profiles.findIndex((profile) => profile.id === profileId);
    if (index === -1) {
        return category;
    }
    const source = profiles[index]!;
    const copy: ContextProfile = {
        ...source,
        id: newIds.profileId,
        name: newName,
        buttons: source.buttons.map((button, buttonIndex) => ({
            ...button,
            id: newIds.buttonId(buttonIndex),
            actions: button.actions?.map((action) => ({ ...action })) ?? [],
        })),
    };
    const next = [...profiles];
    next.splice(index + 1, 0, copy);
    return withProfiles(category, next);
}

/**
 * Move a profile one position up or down. Order IS priority: the first
 * matching profile wins, so reordering is how the user resolves overlaps.
 */
export function moveContextProfile(
    category: CategoryConfig,
    profileId: string,
    direction: -1 | 1
): CategoryConfig {
    const profiles = getContextProfiles(category);
    const index = profiles.findIndex((profile) => profile.id === profileId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= profiles.length) {
        return category;
    }
    const next = [...profiles];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    return withProfiles(category, next);
}

/** Number of slots a profile currently occupies (for the delete confirmation). */
export function countProfileButtons(
    category: CategoryConfig,
    profileId: string
): number {
    return findContextProfile(category, profileId)?.buttons.length ?? 0;
}

// --- Layer-aware button placement -------------------------------------------

function replaceLayerButtons(
    category: CategoryConfig,
    layerId: PaletteLayerId,
    buttons: ButtonConfig[]
): CategoryConfig {
    if (isBaseLayer(layerId)) {
        return { ...category, buttons };
    }
    return withProfiles(
        category,
        getContextProfiles(category).map((profile) =>
            profile.id === layerId ? { ...profile, buttons } : profile
        )
    );
}

/**
 * Append a button to a layer, giving it the lowest slot that layer may use.
 * Returns null when the layer is full — the caller must tell the user instead
 * of dropping the tool.
 */
export function addButtonToLayer(
    category: CategoryConfig,
    layerId: PaletteLayerId,
    button: ButtonConfig
): CategoryConfig | null {
    const slot = findFreeSlotForLayer(category, layerId);
    if (slot === null) {
        return null;
    }
    const existing = layerButtons(category, layerId);
    const placed: ButtonConfig = {
        ...button,
        slot,
        order: existing.length,
    };
    return replaceLayerButtons(category, layerId, [...existing, placed]);
}

/** Remove a button from whichever layer stores it. */
export function removeButtonFromPalette(
    category: CategoryConfig,
    buttonId: string
): CategoryConfig {
    const layerId = findButtonLayerId(category, buttonId);
    if (layerId === null) {
        return category;
    }
    const remaining = layerButtons(category, layerId).filter(
        (button) => button.id !== buttonId
    );
    return replaceLayerButtons(
        category,
        layerId,
        remaining.map((button, index) => ({ ...button, order: index }))
    );
}

/** Replace a button in place, in whichever layer stores it. */
export function replaceButtonInPalette(
    category: CategoryConfig,
    button: ButtonConfig
): CategoryConfig {
    const layerId = findButtonLayerId(category, button.id);
    if (layerId === null) {
        return category;
    }
    return replaceLayerButtons(
        category,
        layerId,
        layerButtons(category, layerId).map((existing) =>
            existing.id === button.id ? button : existing
        )
    );
}

/**
 * Write a resolved slot assignment back into the stored layers.
 *
 * `slotIds` is the live 4x4 drag state of ONE displayed layer view, so it
 * contains the base buttons plus (when a profile is selected) that profile's
 * buttons. Every button keeps the layer it already belonged to; buttons that
 * arrived from another category join `incomingLayerId`. Layers that are not
 * on screen are left completely untouched — dragging in "Type A" can never
 * move anything in "Type B".
 *
 * `claimedByDrag` holds every button id the whole drag state accounts for,
 * across all containers. It is what distinguishes a tool that was dragged INTO
 * another category (claimed elsewhere, so it leaves this one) from a tool that
 * the drag never carried at all — overflow from hand-edited data, which must
 * stay exactly where it is rather than being dropped.
 */
export function applySlotIdsToPalette(
    category: CategoryConfig,
    slotIds: readonly (string | null)[],
    buttonsById: ReadonlyMap<string, ButtonConfig>,
    incomingLayerId: PaletteLayerId,
    claimedByDrag?: ReadonlySet<string>
): CategoryConfig {
    const placedByLayer = new Map<PaletteLayerId, ButtonConfig[]>();
    const claimed = new Set<string>();

    for (let slot = 0; slot < GRID_SLOT_COUNT; slot++) {
        const id = slotIds[slot] ?? null;
        if (id === null) continue;
        const button = buttonsById.get(id);
        if (!button) continue;
        const layerId = findButtonLayerId(category, id) ?? incomingLayerId;
        const list = placedByLayer.get(layerId) ?? [];
        list.push({ ...button, slot });
        placedByLayer.set(layerId, list);
        claimed.add(id);
    }

    // Layers the drag state actually rendered. A button of one of these that
    // the drag state no longer carries has left this category; a button of any
    // other layer was simply off screen and keeps its stored slot.
    const onScreenLayers = new Set<PaletteLayerId>([BASE_LAYER_ID]);
    if (!isBaseLayer(incomingLayerId)) {
        onScreenLayers.add(incomingLayerId);
    }

    /** A tool of a layer on screen that some other container now claims. */
    const movedAway = (layerId: PaletteLayerId, buttonId: string): boolean =>
        onScreenLayers.has(layerId) &&
        !slotIds.includes(buttonId) &&
        (claimedByDrag?.has(buttonId) ?? false);

    const rebuildLayer = (
        layerId: PaletteLayerId,
        stored: readonly ButtonConfig[]
    ): ButtonConfig[] => {
        const placed = placedByLayer.get(layerId) ?? [];
        const untouched = stored.filter(
            (button) => !claimed.has(button.id) && !movedAway(layerId, button.id)
        );
        return [...placed, ...untouched].map((button, index) => ({
            ...button,
            order: index,
        }));
    };

    const next: CategoryConfig = {
        ...category,
        buttons: rebuildLayer(BASE_LAYER_ID, category.buttons),
    };
    const profiles = getContextProfiles(category);
    if (profiles.length === 0) {
        return next;
    }
    return {
        ...next,
        contextProfiles: profiles.map((profile) => ({
            ...profile,
            buttons: rebuildLayer(profile.id, profile.buttons),
        })),
    };
}

/** Guard for slot values coming from drag ids or hand-edited data. */
export function isPaletteSlot(value: unknown): value is number {
    return isValidSlotIndex(value);
}

// --- Lifting per-button conditions into context profiles --------------------

/**
 * Stable stringification for grouping: object keys are sorted, so two buttons
 * carrying the same rule group together regardless of the key order their JSON
 * happened to be written in.
 */
function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

/**
 * Short, data-derived label for a lifted context profile ("type = A", "#todo").
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

export interface LiftedButtonConditions {
    /** Buttons without a (valid) condition: the base/pinned layer. */
    base: ButtonConfig[];
    /** One profile per distinct condition, in first-appearance order. */
    profiles: ContextProfile[];
}

/**
 * Split a flat button list into a base layer plus one context profile per
 * distinct condition.
 *
 * This is the one rule that turns "five buttons with the same trigger" into
 * "one context profile" — used both by the version-2 settings migration and by
 * the flow -> palette conversion, so both produce exactly the same shape.
 *
 * - no condition: stays in the base layer;
 * - a structurally INVALID condition: stays in the base layer and keeps that
 *   condition untouched. It failed open (the button was always visible), so
 *   base is the behavior-preserving home, and the data is kept rather than
 *   discarded;
 * - a valid condition: moves into its profile and loses the now-redundant
 *   per-button copy.
 *
 * Profile ids are derived from `idPrefix`, so the result is deterministic and
 * reproducible — a migration must never depend on a clock or a random source.
 */
export function liftButtonConditionsToProfiles(
    buttons: readonly ButtonConfig[],
    idPrefix: string
): LiftedButtonConditions {
    const base: ButtonConfig[] = [];
    const order: string[] = [];
    const groups = new Map<string, { condition: ButtonCondition; buttons: ButtonConfig[] }>();

    for (const button of buttons) {
        const condition = button.conditions;
        if (condition === undefined || condition === null || !isValidCondition(condition)) {
            base.push(button);
            continue;
        }
        const key = canonicalJson(condition);
        let group = groups.get(key);
        if (!group) {
            group = { condition, buttons: [] };
            groups.set(key, group);
            order.push(key);
        }
        const { conditions: _lifted, ...rest } = button;
        group.buttons.push(rest);
    }

    const profiles = order.map((key, index) => {
        const group = groups.get(key)!;
        return {
            id: `${idPrefix}-ctx-${index + 1}`,
            name: describeConditionForName(group.condition) ?? `Context ${index + 1}`,
            conditions: group.condition,
            buttons: group.buttons.map((button, i) => ({ ...button, order: i })),
        };
    });

    return { base: base.map((button, i) => ({ ...button, order: i })), profiles };
}

// --- Layout conversion (flow <-> palette) -----------------------------------

/**
 * Conversion of an existing flow category to the palette layout.
 *
 * Buttons keep their relative order and are laid out left-to-right, top-to-
 * bottom on slots 0..n-1. Per-button conditions are lifted into context
 * profiles by exactly the same rule the version-2 migration uses, because a
 * palette expresses contextuality through its layers — leaving the conditions
 * on the buttons would silently make every conditional tool permanent.
 * Converting back and forth is therefore lossless.
 *
 * Refuses (returns `ok: false`) when the category holds more buttons than the
 * grid has slots, rather than dropping or hiding any of them — the caller is
 * expected to tell the user instead of silently losing configuration.
 */
export type GridConversionResult =
    | { ok: true; category: CategoryConfig }
    | { ok: false; reason: 'too_many_buttons'; buttonCount: number; slotCount: number };

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

    const { base, profiles } = liftButtonConditionsToProfiles(positioned, category.id);
    const existing = getContextProfiles(category);
    const allProfiles = [...existing, ...profiles];

    return {
        ok: true,
        category:
            allProfiles.length === 0
                ? { ...category, layout: 'grid', buttons: base }
                : {
                      ...category,
                      layout: 'grid',
                      buttons: base,
                      contextProfiles: allProfiles,
                  },
    };
}

/**
 * Conversion of a palette back to flow.
 *
 * Slots are dropped and the buttons keep their spatial reading order (slot 0
 * first), so the flow list matches what the user last saw. Context profiles
 * cannot survive as layers in a flow category, so their tools are appended and
 * each one gets its profile's condition as its own per-button condition — the
 * legacy flow model expresses exactly that. Nothing is lost: converting back
 * and forth keeps every tool, and a flow category with per-button conditions is
 * lifted into profiles again by the palette itself.
 */
export function convertCategoryToFlow(category: CategoryConfig): CategoryConfig {
    const placement = placeButtonsOnGrid(category.buttons);
    const ordered: ButtonConfig[] = [
        ...placement.slots.filter((b): b is ButtonConfig => b !== null),
        ...placement.overflow,
    ];

    for (const profile of getContextProfiles(category)) {
        const profilePlacement = placeButtonsOnGrid(profile.buttons);
        const profileButtons = [
            ...profilePlacement.slots.filter((b): b is ButtonConfig => b !== null),
            ...profilePlacement.overflow,
        ];
        for (const button of profileButtons) {
            ordered.push(
                profile.conditions === undefined
                    ? button
                    : { ...button, conditions: profile.conditions }
            );
        }
    }

    const buttons = ordered.map((button, index) => {
        const { slot: _slot, ...rest } = button;
        return { ...rest, order: index };
    });

    const { layout: _layout, contextProfiles: _profiles, ...categoryRest } = category;
    return { ...categoryRest, layout: 'flow', buttons };
}

/**
 * Apply a category's layout choice, converting the buttons when the layout
 * actually changes. Returns the same category reference when nothing changes.
 */
export function applyCategoryLayout(
    category: CategoryConfig,
    layout: CategoryLayout
): GridConversionResult {
    const current = getCategoryLayout(category);
    if (current === layout) {
        return { ok: true, category };
    }
    return layout === 'grid'
        ? convertCategoryToGrid(category)
        : { ok: true, category: convertCategoryToFlow(category) };
}
