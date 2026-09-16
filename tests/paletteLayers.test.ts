// Pure model of the palette context layers.
//
// Covers the guarantees the product rests on:
// - the base/pinned layer reserves its slots in EVERY context profile;
// - profiles are ordered and the first match wins — never a merge;
// - a slot's spatial identity does not depend on the context;
// - no operation ever loses a tool.

import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig, ContextProfile } from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import type { OCAPContextSnapshot } from '@/context/OCAPContext';
import {
    BASE_LAYER_ID,
    addButtonToLayer,
    addContextProfile,
    allPaletteButtons,
    applySlotIdsToPalette,
    baseSlotOccupancy,
    blockedSlotsForLayer,
    contextualButtonIds,
    convertCategoryToFlow,
    convertCategoryToGrid,
    countProfileButtons,
    duplicateContextProfile,
    effectivePaletteButtons,
    filterPaletteButtons,
    findButtonLayerId,
    findContextProfile,
    findFreeSlotForLayer,
    getContextProfiles,
    isProfileMatching,
    layerButtons,
    moveContextProfile,
    removeButtonFromPalette,
    removeContextProfile,
    replaceButtonInPalette,
    resolvePaletteForContext,
    resolvePaletteLayer,
    selectActiveProfile,
    updateContextProfile,
} from '@/utils/paletteLayers';
import { GRID_SLOT_COUNT } from '@/utils/categoryGrid';

function context(overrides: Partial<OCAPContextSnapshot> = {}): OCAPContextSnapshot {
    return {
        viewType: 'markdown',
        filePath: 'notes/a.md',
        folderPath: 'notes',
        fileName: 'a.md',
        fileExtension: 'md',
        properties: {},
        tags: [],
        ...overrides,
    } as OCAPContextSnapshot;
}

const TYPE_A: ButtonCondition = {
    rule: 'property',
    op: 'equals',
    key: 'type',
    value: 'A',
};
const TYPE_B: ButtonCondition = {
    rule: 'property',
    op: 'equals',
    key: 'type',
    value: 'B',
};
const MARKDOWN: ButtonCondition = { rule: 'viewType', value: 'markdown' };

const ctxA = context({ properties: { type: 'A' } });
const ctxB = context({ properties: { type: 'B' } });
const ctxNone = context({ properties: { type: 'Z' } });

function button(id: string, slot: number, order = 0): ButtonConfig {
    return { id, name: id, actions: [], order, slot };
}

function profile(
    id: string,
    conditions: ButtonCondition | undefined,
    buttons: ButtonConfig[]
): ContextProfile {
    const p: ContextProfile = { id, name: id, buttons };
    if (conditions) p.conditions = conditions;
    return p;
}

function palette(
    base: ButtonConfig[],
    profiles: ContextProfile[] = []
): CategoryConfig {
    const category: CategoryConfig = {
        id: 'palette',
        name: 'Node Tools',
        order: 0,
        layout: 'grid',
        buttons: base,
    };
    if (profiles.length > 0) category.contextProfiles = profiles;
    return category;
}

/** Slot ids of a resolution, for compact assertions. */
function ids(resolved: { slots: { button: ButtonConfig | null }[] }): (string | null)[] {
    return resolved.slots.map((slot) => slot.button?.id ?? null);
}

// The example from the task brief, used by several groups below.
const NODE_TOOLS = palette(
    [button('home', 0), button('search', 2, 1), button('info', 7, 2)],
    [
        profile('a', TYPE_A, [
            button('a-tool', 1),
            button('a-tool-2', 3, 1),
            button('a-tool-3', 5, 2),
        ]),
        profile('b', TYPE_B, [button('b-tool', 1), button('b-tool-2', 3, 1)]),
    ]
);

describe('base / pinned layer', () => {
    it('is empty for a palette without buttons', () => {
        expect(baseSlotOccupancy(palette([]))).toEqual(
            new Array(GRID_SLOT_COUNT).fill(false)
        );
        expect(ids(resolvePaletteLayer(palette([]), BASE_LAYER_ID))).toEqual(
            new Array(GRID_SLOT_COUNT).fill(null)
        );
    });

    it('marks a single pinned slot', () => {
        const occupancy = baseSlotOccupancy(palette([button('home', 0)]));
        expect(occupancy[0]).toBe(true);
        expect(occupancy.filter(Boolean)).toHaveLength(1);
    });

    it('marks several pinned slots', () => {
        const occupancy = baseSlotOccupancy(NODE_TOOLS);
        expect(occupancy[0]).toBe(true);
        expect(occupancy[2]).toBe(true);
        expect(occupancy[7]).toBe(true);
        expect(occupancy.filter(Boolean)).toHaveLength(3);
    });

    it('blocks every pinned slot for a context profile', () => {
        const blocked = blockedSlotsForLayer(NODE_TOOLS, 'a');
        expect(blocked[0]).toBe(true);
        expect(blocked[2]).toBe(true);
        expect(blocked[7]).toBe(true);
        expect(blocked[1]).toBe(false);
    });

    it('blocks slots used by context profiles while the base layer is edited', () => {
        // Base must not silently displace a profile's tool.
        const blocked = blockedSlotsForLayer(NODE_TOOLS, BASE_LAYER_ID);
        expect(blocked[1]).toBe(true); // a-tool and b-tool
        expect(blocked[3]).toBe(true);
        expect(blocked[5]).toBe(true); // a-tool-3 only
        expect(blocked[4]).toBe(false);
    });

    it('relocates a profile tool that claims a pinned slot instead of overwriting it', () => {
        // Hand-edited data: the profile wants slot 0, which base owns.
        const category = palette(
            [button('home', 0)],
            [profile('a', TYPE_A, [button('a-tool', 0)])]
        );
        const resolved = resolvePaletteLayer(category, 'a');
        expect(resolved.slots[0]!.button!.id).toBe('home');
        // Deterministically relocated to the lowest free unblocked slot.
        expect(resolved.slots[1]!.button!.id).toBe('a-tool');
        expect(resolved.overflow).toEqual([]);
    });
});

describe('context profiles', () => {
    it('reports no profiles for a plain palette', () => {
        expect(getContextProfiles(palette([button('home', 0)]))).toEqual([]);
        expect(selectActiveProfile(palette([]), ctxA)).toBeNull();
    });

    it('activates the single matching profile', () => {
        const category = palette([], [profile('a', TYPE_A, [])]);
        expect(selectActiveProfile(category, ctxA)?.id).toBe('a');
        expect(selectActiveProfile(category, ctxB)).toBeNull();
    });

    it('picks the FIRST matching profile when several match', () => {
        const category = palette(
            [],
            [
                profile('first', MARKDOWN, []),
                profile('second', MARKDOWN, []),
            ]
        );
        expect(selectActiveProfile(category, context())?.id).toBe('first');
    });

    it('follows the order after a reorder', () => {
        const category = palette(
            [],
            [profile('first', MARKDOWN, []), profile('second', MARKDOWN, [])]
        );
        const reordered = moveContextProfile(category, 'second', -1);
        expect(getContextProfiles(reordered).map((p) => p.id)).toEqual([
            'second',
            'first',
        ]);
        expect(selectActiveProfile(reordered, context())?.id).toBe('second');
        // The source category is untouched (pure helper).
        expect(getContextProfiles(category).map((p) => p.id)).toEqual([
            'first',
            'second',
        ]);
    });

    it('ignores a move beyond the ends', () => {
        const category = palette([], [profile('a', TYPE_A, [])]);
        expect(moveContextProfile(category, 'a', -1)).toBe(category);
        expect(moveContextProfile(category, 'a', 1)).toBe(category);
        expect(moveContextProfile(category, 'missing', 1)).toBe(category);
    });

    it('treats an absent condition as always matching', () => {
        expect(isProfileMatching({ conditions: undefined }, ctxNone)).toBe(true);
    });

    it('treats a structurally invalid condition as never matching', () => {
        // Deliberate asymmetry: a corrupt always-matching profile would shadow
        // every profile below it. See DECISIONS.md.
        const broken = { rule: 'nonsense' } as unknown as ButtonCondition;
        expect(isProfileMatching({ conditions: broken }, ctxA)).toBe(false);

        const category = palette([], [profile('broken', broken, []), profile('a', TYPE_A, [])]);
        expect(selectActiveProfile(category, ctxA)?.id).toBe('a');
    });

    it('adds a profile with a stable id and no buttons', () => {
        const next = addContextProfile(palette([]), {
            id: 'p1',
            name: 'Type A',
            conditions: TYPE_A,
        });
        const added = findContextProfile(next, 'p1')!;
        expect(added.name).toBe('Type A');
        expect(added.conditions).toEqual(TYPE_A);
        expect(added.buttons).toEqual([]);
    });

    it('updates name and condition, and can clear the condition', () => {
        const category = addContextProfile(palette([]), {
            id: 'p1',
            name: 'A',
            conditions: TYPE_A,
        });
        const renamed = updateContextProfile(category, 'p1', {
            name: 'Renamed',
            conditions: TYPE_B,
        });
        expect(findContextProfile(renamed, 'p1')!.name).toBe('Renamed');
        expect(findContextProfile(renamed, 'p1')!.conditions).toEqual(TYPE_B);

        const cleared = updateContextProfile(renamed, 'p1', {
            name: 'Renamed',
            conditions: undefined,
        });
        expect('conditions' in findContextProfile(cleared, 'p1')!).toBe(false);
    });

    it('duplicates a profile with new ids and full tool configuration', () => {
        const copy = duplicateContextProfile(
            NODE_TOOLS,
            'a',
            { profileId: 'a-copy', buttonId: (index) => `copy-${index}` },
            'Type A copy'
        );
        const profiles = getContextProfiles(copy);
        // Inserted directly below its source, so priority stays readable.
        expect(profiles.map((p) => p.id)).toEqual(['a', 'a-copy', 'b']);

        const duplicated = findContextProfile(copy, 'a-copy')!;
        expect(duplicated.name).toBe('Type A copy');
        expect(duplicated.conditions).toEqual(TYPE_A);
        expect(duplicated.buttons.map((b) => b.id)).toEqual([
            'copy-0',
            'copy-1',
            'copy-2',
        ]);
        expect(duplicated.buttons.map((b) => b.slot)).toEqual([1, 3, 5]);
        // Nothing is shared with the source.
        const source = findContextProfile(copy, 'a')!;
        expect(duplicated.buttons[0]).not.toBe(source.buttons[0]);
    });

    it('deletes a profile and leaves every other layer alone', () => {
        const next = removeContextProfile(NODE_TOOLS, 'a');
        expect(getContextProfiles(next).map((p) => p.id)).toEqual(['b']);
        expect(next.buttons.map((b) => b.id)).toEqual(['home', 'search', 'info']);
        expect(countProfileButtons(NODE_TOOLS, 'a')).toBe(3);
    });

    it('drops the contextProfiles field entirely when the last one is deleted', () => {
        const single = palette([], [profile('a', TYPE_A, [])]);
        expect('contextProfiles' in removeContextProfile(single, 'a')).toBe(false);
    });
});

describe('runtime resolution', () => {
    it('shows only the base layer when no profile matches', () => {
        const resolved = resolvePaletteForContext(NODE_TOOLS, ctxNone);
        expect(resolved.activeProfileId).toBeNull();
        expect(ids(resolved).slice(0, 8)).toEqual([
            'home',
            null,
            'search',
            null,
            null,
            null,
            null,
            'info',
        ]);
    });

    it('resolves the Type A example exactly as specified', () => {
        const resolved = resolvePaletteForContext(NODE_TOOLS, ctxA);
        expect(resolved.activeProfileId).toBe('a');
        expect(ids(resolved).slice(0, 8)).toEqual([
            'home',
            'a-tool',
            'search',
            'a-tool-2',
            null,
            'a-tool-3',
            null,
            'info',
        ]);
    });

    it('resolves the Type B example exactly as specified', () => {
        const resolved = resolvePaletteForContext(NODE_TOOLS, ctxB);
        expect(resolved.activeProfileId).toBe('b');
        expect(ids(resolved).slice(0, 8)).toEqual([
            'home',
            'b-tool',
            'search',
            'b-tool-2',
            null,
            null, // Type B leaves slot 5 empty
            null,
            'info',
        ]);
    });

    it('gives the same slot a different tool per profile', () => {
        expect(ids(resolvePaletteForContext(NODE_TOOLS, ctxA))[1]).toBe('a-tool');
        expect(ids(resolvePaletteForContext(NODE_TOOLS, ctxB))[1]).toBe('b-tool');
    });

    it('never lets a context profile overwrite a pinned slot', () => {
        for (const ctx of [ctxA, ctxB, ctxNone]) {
            const resolved = resolvePaletteForContext(NODE_TOOLS, ctx);
            expect(resolved.slots[0]!.button!.id).toBe('home');
            expect(resolved.slots[2]!.button!.id).toBe('search');
            expect(resolved.slots[7]!.button!.id).toBe('info');
            expect(resolved.slots[0]!.pinned).toBe(true);
        }
    });

    it('keeps every slot spatially stable across context switches', () => {
        const a = ids(resolvePaletteForContext(NODE_TOOLS, ctxA));
        const b = ids(resolvePaletteForContext(NODE_TOOLS, ctxB));
        const none = ids(resolvePaletteForContext(NODE_TOOLS, ctxNone));

        for (const arrangement of [a, b, none]) {
            expect(arrangement).toHaveLength(GRID_SLOT_COUNT);
            expect(arrangement.indexOf('home')).toBe(0);
            expect(arrangement.indexOf('search')).toBe(2);
            expect(arrangement.indexOf('info')).toBe(7);
        }
    });

    it('never mutates the stored configuration', () => {
        const snapshot: unknown = JSON.parse(JSON.stringify(NODE_TOOLS));
        resolvePaletteForContext(NODE_TOOLS, ctxA);
        resolvePaletteForContext(NODE_TOOLS, ctxB);
        resolvePaletteLayer(NODE_TOOLS, 'b');
        expect(NODE_TOOLS).toEqual(snapshot);
    });

    it('reports which slots belong to another profile (management info)', () => {
        const resolved = resolvePaletteLayer(NODE_TOOLS, 'a');
        expect(resolved.slots[1]!.reservedBy).toEqual(['b']);
        expect(resolved.slots[5]!.reservedBy).toEqual([]);
    });

    it('exposes the effective buttons with their resolved slots', () => {
        const buttons = effectivePaletteButtons(resolvePaletteForContext(NODE_TOOLS, ctxA));
        expect(buttons.map((b) => [b.id, b.slot])).toEqual([
            ['home', 0],
            ['a-tool', 1],
            ['search', 2],
            ['a-tool-2', 3],
            ['a-tool-3', 5],
            ['info', 7],
        ]);
    });

    it('marks profile-contributed tools as contextual', () => {
        expect([...contextualButtonIds(resolvePaletteForContext(NODE_TOOLS, ctxA))]).toEqual([
            'a-tool',
            'a-tool-2',
            'a-tool-3',
        ]);
        expect(contextualButtonIds(resolvePaletteForContext(NODE_TOOLS, ctxNone)).size).toBe(
            0
        );
    });

    it('reports overflow instead of dropping tools that do not fit', () => {
        const base = Array.from({ length: GRID_SLOT_COUNT }, (_, i) =>
            button(`base-${i}`, i, i)
        );
        const resolved = resolvePaletteLayer(
            palette(base, [profile('a', TYPE_A, [button('extra', 0)])]),
            'a'
        );
        expect(resolved.overflow.map((b) => b.id)).toEqual(['extra']);
        expect(ids(resolved).filter((id) => id !== null)).toHaveLength(GRID_SLOT_COUNT);
    });
});

describe('layer-aware helpers', () => {
    it('finds the layer a tool lives in', () => {
        expect(findButtonLayerId(NODE_TOOLS, 'home')).toBe(BASE_LAYER_ID);
        expect(findButtonLayerId(NODE_TOOLS, 'b-tool')).toBe('b');
        expect(findButtonLayerId(NODE_TOOLS, 'missing')).toBeNull();
    });

    it('lists every tool of every layer', () => {
        expect(allPaletteButtons(NODE_TOOLS).map((b) => b.id)).toEqual([
            'home',
            'search',
            'info',
            'a-tool',
            'a-tool-2',
            'a-tool-3',
            'b-tool',
            'b-tool-2',
        ]);
    });

    it('returns the buttons of one layer', () => {
        expect(layerButtons(NODE_TOOLS, BASE_LAYER_ID).map((b) => b.id)).toEqual([
            'home',
            'search',
            'info',
        ]);
        expect(layerButtons(NODE_TOOLS, 'b').map((b) => b.id)).toEqual([
            'b-tool',
            'b-tool-2',
        ]);
        expect(layerButtons(NODE_TOOLS, 'missing')).toEqual([]);
    });

    it('finds the lowest slot a layer may actually use', () => {
        // Base: 0/2/7 taken by base, 1/3/5 reserved by profiles -> 4.
        expect(findFreeSlotForLayer(NODE_TOOLS, BASE_LAYER_ID)).toBe(4);
        // Type A: 0/2/7 pinned, 1/3/5 its own -> 4.
        expect(findFreeSlotForLayer(NODE_TOOLS, 'a')).toBe(4);
        // Type B: 0/2/7 pinned, 1/3 its own -> 4 (5 belongs to A, not to B).
        expect(findFreeSlotForLayer(NODE_TOOLS, 'b')).toBe(4);
    });

    it('reports a full layer instead of inventing a slot', () => {
        const full = palette(
            Array.from({ length: GRID_SLOT_COUNT }, (_, i) => button(`b${i}`, i, i))
        );
        expect(findFreeSlotForLayer(full, BASE_LAYER_ID)).toBeNull();
        expect(addButtonToLayer(full, BASE_LAYER_ID, button('extra', 0))).toBeNull();
    });

    it('adds a tool to the selected layer on its lowest free slot', () => {
        const next = addButtonToLayer(NODE_TOOLS, 'b', button('b-tool-3', 99))!;
        const added = findContextProfile(next, 'b')!.buttons.at(-1)!;
        expect(added.slot).toBe(4);
        expect(next.buttons.map((b) => b.id)).toEqual(['home', 'search', 'info']);
        expect(findContextProfile(next, 'a')!.buttons).toHaveLength(3);
    });

    it('removes a tool from whichever layer stores it', () => {
        const next = removeButtonFromPalette(NODE_TOOLS, 'a-tool-2');
        expect(findContextProfile(next, 'a')!.buttons.map((b) => b.id)).toEqual([
            'a-tool',
            'a-tool-3',
        ]);
        expect(findContextProfile(next, 'b')!.buttons).toHaveLength(2);
        expect(next.buttons).toHaveLength(3);
    });

    it('replaces a tool in whichever layer stores it', () => {
        const edited = { ...button('b-tool', 1), name: 'Renamed' };
        const next = replaceButtonInPalette(NODE_TOOLS, edited);
        expect(findContextProfile(next, 'b')!.buttons[0]!.name).toBe('Renamed');
        expect(findContextProfile(next, 'a')!.buttons[0]!.name).toBe('a-tool');
    });

    it('filters every layer for the panel search', () => {
        const filtered = filterPaletteButtons(NODE_TOOLS, (b) => b.name.includes('tool'));
        expect(filtered.buttons).toEqual([]);
        expect(findContextProfile(filtered, 'a')!.buttons).toHaveLength(3);
        // Unchanged input returns the same reference.
        expect(filterPaletteButtons(NODE_TOOLS, () => true)).toBe(NODE_TOOLS);
    });
});

describe('layout conversion keeps every layer', () => {
    it('converts a flow category into a base-only palette', () => {
        const flow: CategoryConfig = {
            id: 'flow',
            name: 'Flow',
            order: 0,
            buttons: [
                { id: 'a', name: 'a', actions: [], order: 0 },
                { id: 'b', name: 'b', actions: [], order: 1 },
            ],
        };
        const result = convertCategoryToGrid(flow);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category.buttons.map((b) => b.slot)).toEqual([0, 1]);
        expect(result.category.contextProfiles).toBeUndefined();
    });

    it('refuses to convert more buttons than the grid has slots', () => {
        const flow: CategoryConfig = {
            id: 'flow',
            name: 'Flow',
            order: 0,
            buttons: Array.from({ length: GRID_SLOT_COUNT + 1 }, (_, i) => ({
                id: `b${i}`,
                name: `b${i}`,
                actions: [],
                order: i,
            })),
        };
        const result = convertCategoryToGrid(flow);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.buttonCount).toBe(GRID_SLOT_COUNT + 1);
    });

    it('round-trips palette -> flow -> palette without losing a layer', () => {
        const flow = convertCategoryToFlow(NODE_TOOLS);
        const back = convertCategoryToGrid(flow);
        expect(back.ok).toBe(true);
        if (!back.ok) return;
        expect(back.category.buttons.map((b) => b.id)).toEqual(['home', 'search', 'info']);
        const profiles = getContextProfiles(back.category);
        expect(profiles).toHaveLength(2);
        expect(profiles[0]!.conditions).toEqual(TYPE_A);
        expect(profiles[0]!.buttons.map((b) => b.id)).toEqual([
            'a-tool',
            'a-tool-2',
            'a-tool-3',
        ]);
        expect(profiles[1]!.conditions).toEqual(TYPE_B);
        expect(profiles[1]!.buttons.map((b) => b.id)).toEqual(['b-tool', 'b-tool-2']);
        // Every tool survives the round trip.
        expect(allPaletteButtons(back.category).map((b) => b.id).sort()).toEqual(
            allPaletteButtons(NODE_TOOLS).map((b) => b.id).sort()
        );
    });

    it('flattens context profiles back into per-button conditions, losing nothing', () => {
        const flow = convertCategoryToFlow(NODE_TOOLS);
        expect(flow.layout).toBe('flow');
        expect(flow.contextProfiles).toBeUndefined();
        expect(flow.buttons.map((b) => b.id)).toEqual([
            'home',
            'search',
            'info',
            'a-tool',
            'a-tool-2',
            'a-tool-3',
            'b-tool',
            'b-tool-2',
        ]);
        expect(flow.buttons.every((b) => b.slot === undefined)).toBe(true);
        expect(flow.buttons.find((b) => b.id === 'a-tool')!.conditions).toEqual(TYPE_A);
        expect(flow.buttons.find((b) => b.id === 'b-tool')!.conditions).toEqual(TYPE_B);
        expect(flow.buttons.find((b) => b.id === 'home')!.conditions).toBeUndefined();
    });
});

describe('applySlotIdsToPalette', () => {
    const byId = new Map(allPaletteButtons(NODE_TOOLS).map((b) => [b.id, b]));

    /** Drag state of one displayed layer view. */
    function view(category: CategoryConfig, layerId: string): (string | null)[] {
        return resolvePaletteLayer(category, layerId).slots.map(
            (slot) => slot.button?.id ?? null
        );
    }

    it('writes a base move back into the base layer only', () => {
        const slots = view(NODE_TOOLS, BASE_LAYER_ID);
        // Move `info` from slot 7 to the free slot 4.
        slots[7] = null;
        slots[4] = 'info';

        const next = applySlotIdsToPalette(NODE_TOOLS, slots, byId, BASE_LAYER_ID);
        expect(next.buttons.find((b) => b.id === 'info')!.slot).toBe(4);
        // Both profiles are byte-identical to before.
        expect(next.contextProfiles).toEqual(NODE_TOOLS.contextProfiles);
    });

    it('writes a context move back into that profile only', () => {
        const slots = view(NODE_TOOLS, 'a');
        slots[5] = null;
        slots[4] = 'a-tool-3';

        const next = applySlotIdsToPalette(NODE_TOOLS, slots, byId, 'a');
        expect(findContextProfile(next, 'a')!.buttons.find((b) => b.id === 'a-tool-3')!.slot)
            .toBe(4);
        // Type B untouched — profiles never influence each other.
        expect(findContextProfile(next, 'b')).toEqual(findContextProfile(NODE_TOOLS, 'b'));
        expect(next.buttons.map((b) => [b.id, b.slot])).toEqual([
            ['home', 0],
            ['search', 2],
            ['info', 7],
        ]);
    });

    it('keeps base tools in the base layer while a profile is being edited', () => {
        const slots = view(NODE_TOOLS, 'a');
        const next = applySlotIdsToPalette(NODE_TOOLS, slots, byId, 'a');
        expect(next.buttons.map((b) => b.id)).toEqual(['home', 'search', 'info']);
        expect(findContextProfile(next, 'a')!.buttons.map((b) => b.id)).toEqual([
            'a-tool',
            'a-tool-2',
            'a-tool-3',
        ]);
    });

    it('leaves off-screen profiles alone when the base layer is edited', () => {
        const slots = view(NODE_TOOLS, BASE_LAYER_ID);
        const next = applySlotIdsToPalette(NODE_TOOLS, slots, byId, BASE_LAYER_ID);
        expect(next.contextProfiles).toEqual(NODE_TOOLS.contextProfiles);
    });

    it('removes a tool that was dragged into another category', () => {
        const slots = view(NODE_TOOLS, 'a');
        slots[slots.indexOf('a-tool-2')] = null;
        // Another container claims it now, which is what makes it a move.
        const next = applySlotIdsToPalette(
            NODE_TOOLS,
            slots,
            byId,
            'a',
            new Set(['a-tool-2'])
        );
        expect(findContextProfile(next, 'a')!.buttons.map((b) => b.id)).toEqual([
            'a-tool',
            'a-tool-3',
        ]);
        expect(findContextProfile(next, 'b')!.buttons).toHaveLength(2);
    });

    it('drops a tool arriving from another category into the layer on screen', () => {
        const incoming = button('foreign', 0);
        const slots = view(NODE_TOOLS, 'b');
        slots[6] = 'foreign';
        const next = applySlotIdsToPalette(
            NODE_TOOLS,
            slots,
            new Map([...byId, ['foreign', incoming]]),
            'b'
        );
        expect(findContextProfile(next, 'b')!.buttons.map((b) => [b.id, b.slot])).toEqual([
            ['b-tool', 1],
            ['b-tool-2', 3],
            ['foreign', 6],
        ]);
        expect(next.buttons.map((b) => b.id)).toEqual(['home', 'search', 'info']);
    });

    it('preserves a tool the drag state never carried (overflow data)', () => {
        const overflowing = palette([
            ...Array.from({ length: GRID_SLOT_COUNT }, (_, i) => button(`b${i}`, i, i)),
            { id: 'ghost', name: 'ghost', actions: [], order: 99 },
        ]);
        const map = new Map(allPaletteButtons(overflowing).map((b) => [b.id, b]));
        const slots = view(overflowing, BASE_LAYER_ID);
        const next = applySlotIdsToPalette(
            overflowing,
            slots,
            map,
            BASE_LAYER_ID,
            new Set(slots.filter((id): id is string => id !== null))
        );
        expect(next.buttons.map((b) => b.id)).toContain('ghost');
    });

    it('is a no-op in content when nothing moved', () => {
        const slots = view(NODE_TOOLS, 'a');
        const next = applySlotIdsToPalette(NODE_TOOLS, slots, byId, 'a');
        expect(JSON.parse(JSON.stringify(next))).toEqual(
            JSON.parse(JSON.stringify(NODE_TOOLS))
        );
    });
});
