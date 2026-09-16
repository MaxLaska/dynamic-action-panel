// Drag semantics across palette context layers.
//
// The drag state always mirrors the layer that is ON SCREEN, and a slot another
// layer reserves rejects the drop outright. These tests pin the two guarantees
// that follow from that: a pinned base slot can never be taken by a context
// profile, and dragging inside one profile cannot touch another one.

import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig, ContextProfile } from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import {
    applyDragOverToItems,
    buildButtonDragItems,
    resolveGridDropOutcome,
    buildContainerLayouts,
    collectButtonsById,
    findContainerForButtonId,
    getGridSlotButtonsFromAllCategories,
    slotDroppableId,
    type BlockedSlots,
    type ButtonDragItems,
} from '@/utils/buttonDragItems';
import {
    BASE_LAYER_ID,
    applySlotIdsToPalette,
    blockedSlotsForLayer,
    findContextProfile,
    resolvePaletteLayer,
} from '@/utils/paletteLayers';

const TYPE_A: ButtonCondition = { rule: 'property', op: 'equals', key: 'type', value: 'A' };
const TYPE_B: ButtonCondition = { rule: 'property', op: 'equals', key: 'type', value: 'B' };

function button(id: string, slot: number, order = 0): ButtonConfig {
    return { id, name: id, actions: [], order, slot };
}

function profile(
    id: string,
    conditions: ButtonCondition,
    buttons: ButtonConfig[]
): ContextProfile {
    return { id, name: id, conditions, buttons };
}

/** Base: slots 0 and 2 pinned. Type A: slot 1 and 3. Type B: slot 1 only. */
function nodeTools(): CategoryConfig {
    return {
        id: 'palette',
        name: 'Node Tools',
        order: 0,
        layout: 'grid',
        buttons: [button('home', 0), button('search', 2, 1)],
        contextProfiles: [
            profile('a', TYPE_A, [button('a-tool', 1), button('a-tool-2', 3, 1)]),
            profile('b', TYPE_B, [button('b-tool', 1)]),
        ],
    };
}

/** Everything a drag needs for one displayed layer. */
function dragSetup(categories: CategoryConfig[], selection: Record<string, string>) {
    const palettes = new Map(
        categories
            .filter((c) => c.layout === 'grid')
            .map((c) => [c.id, resolvePaletteLayer(c, selection[c.id] ?? BASE_LAYER_ID)])
    );
    const items = buildButtonDragItems(categories, palettes);
    const layouts = buildContainerLayouts(categories);
    const blocked: BlockedSlots = {};
    for (const category of categories) {
        if (category.layout !== 'grid') continue;
        blocked[category.id] = blockedSlotsForLayer(
            category,
            selection[category.id] ?? BASE_LAYER_ID
        );
    }
    return { palettes, items, layouts, blocked };
}

function ids(items: ButtonDragItems, containerId: string): (string | null)[] {
    return items[containerId]!;
}

describe('drag state mirrors the layer on screen', () => {
    it('shows only the base layer when base is selected', () => {
        const category = nodeTools();
        const { items } = dragSetup([category], {});
        expect(ids(items, 'palette').slice(0, 4)).toEqual(['home', null, 'search', null]);
    });

    it('shows base plus the selected profile', () => {
        const category = nodeTools();
        const { items } = dragSetup([category], { palette: 'a' });
        expect(ids(items, 'palette').slice(0, 4)).toEqual([
            'home',
            'a-tool',
            'search',
            'a-tool-2',
        ]);
    });

    it('never shows two profiles at once', () => {
        const category = nodeTools();
        const { items } = dragSetup([category], { palette: 'b' });
        expect(ids(items, 'palette')).not.toContain('a-tool');
        expect(ids(items, 'palette')[1]).toBe('b-tool');
    });

    it('resolves a context-profile tool to its container', () => {
        const category = nodeTools();
        const { items } = dragSetup([category], { palette: 'a' });
        expect(findContainerForButtonId('a-tool', items)).toBe('palette');
    });

    it('finds tools of every layer when resolving ids to buttons', () => {
        const category = nodeTools();
        const map = collectButtonsById([category]);
        expect(map.get('b-tool')!.name).toBe('b-tool');
        const { items } = dragSetup([category], { palette: 'b' });
        const slots = getGridSlotButtonsFromAllCategories(category, [category], items);
        expect(slots[1]!.id).toBe('b-tool');
    });
});

describe('pinned base slots are blocked for context layers', () => {
    it('rejects dropping a context tool on a pinned slot', () => {
        const category = nodeTools();
        const { items, layouts, blocked } = dragSetup([category], { palette: 'a' });
        const next = applyDragOverToItems(
            items,
            'a-tool',
            slotDroppableId('palette', 0),
            layouts,
            blocked
        );
        expect(next).toBe(items);
    });

    it('rejects a swap with the button sitting on a pinned slot', () => {
        const category = nodeTools();
        const { items, layouts, blocked } = dragSetup([category], { palette: 'a' });
        // Targeting the pinned button itself, not the cell.
        const next = applyDragOverToItems(items, 'a-tool', 'home', layouts, blocked);
        expect(next).toBe(items);
    });

    it('accepts a move onto a free contextual slot', () => {
        const category = nodeTools();
        const { items, layouts, blocked } = dragSetup([category], { palette: 'a' });
        const next = applyDragOverToItems(
            items,
            'a-tool',
            slotDroppableId('palette', 4),
            layouts,
            blocked
        );
        expect(ids(next, 'palette').slice(0, 5)).toEqual([
            'home',
            null,
            'search',
            'a-tool-2',
            'a-tool',
        ]);
    });

    it('swaps two tools inside the same profile', () => {
        const category = nodeTools();
        const { items, layouts, blocked } = dragSetup([category], { palette: 'a' });
        const next = applyDragOverToItems(items, 'a-tool', 'a-tool-2', layouts, blocked);
        expect(ids(next, 'palette').slice(0, 4)).toEqual([
            'home',
            'a-tool-2',
            'search',
            'a-tool',
        ]);
    });
});

describe('the base layer is blocked by slots other profiles use', () => {
    it('rejects moving a base tool onto a slot a profile occupies', () => {
        const category = nodeTools();
        const { items, layouts, blocked } = dragSetup([category], {});
        // Slot 1 is free in the base view but used by Type A and Type B.
        const next = applyDragOverToItems(
            items,
            'home',
            slotDroppableId('palette', 1),
            layouts,
            blocked
        );
        expect(next).toBe(items);
    });

    it('accepts moving a base tool onto a genuinely free slot', () => {
        const category = nodeTools();
        const { items, layouts, blocked } = dragSetup([category], {});
        const next = applyDragOverToItems(
            items,
            'home',
            slotDroppableId('palette', 5),
            layouts,
            blocked
        );
        expect(ids(next, 'palette').slice(0, 6)).toEqual([
            null,
            null,
            'search',
            null,
            null,
            'home',
        ]);
    });

    it('swaps two base tools', () => {
        const category = nodeTools();
        const { items, layouts, blocked } = dragSetup([category], {});
        const next = applyDragOverToItems(items, 'home', 'search', layouts, blocked);
        expect(ids(next, 'palette').slice(0, 3)).toEqual(['search', null, 'home']);
    });
});

describe('a drag in one profile never touches another', () => {
    it('persists a Type A move without changing Type B', () => {
        const category = nodeTools();
        const { items, layouts, blocked } = dragSetup([category], { palette: 'a' });
        const moved = applyDragOverToItems(
            items,
            'a-tool',
            slotDroppableId('palette', 6),
            layouts,
            blocked
        );

        const next = applySlotIdsToPalette(
            category,
            moved['palette']!,
            collectButtonsById([category]),
            'a',
            new Set(moved['palette']!.filter((id): id is string => id !== null))
        );

        expect(
            findContextProfile(next, 'a')!.buttons.map((b) => [b.id, b.slot])
        ).toEqual([
            ['a-tool-2', 3],
            ['a-tool', 6],
        ]);
        expect(findContextProfile(next, 'b')).toEqual(findContextProfile(category, 'b'));
        expect(next.buttons.map((b) => [b.id, b.slot])).toEqual([
            ['home', 0],
            ['search', 2],
        ]);
    });

    it('persists a base move without changing any profile', () => {
        const category = nodeTools();
        const { items, layouts, blocked } = dragSetup([category], {});
        const moved = applyDragOverToItems(
            items,
            'search',
            slotDroppableId('palette', 8),
            layouts,
            blocked
        );

        const next = applySlotIdsToPalette(
            category,
            moved['palette']!,
            collectButtonsById([category]),
            BASE_LAYER_ID,
            new Set(moved['palette']!.filter((id): id is string => id !== null))
        );

        expect(next.buttons.map((b) => [b.id, b.slot])).toEqual([
            ['home', 0],
            ['search', 8],
        ]);
        expect(next.contextProfiles).toEqual(category.contextProfiles);
    });
});

describe('cross-category drags with palettes', () => {
    function flowCategory(): CategoryConfig {
        return {
            id: 'flow',
            name: 'Flow',
            order: 1,
            buttons: [{ id: 'flow-1', name: 'flow-1', actions: [], order: 0 }],
        };
    }

    it('lands a flow tool in the selected context layer', () => {
        const palette = nodeTools();
        const flow = flowCategory();
        const categories = [palette, flow];
        const { items, layouts, blocked } = dragSetup(categories, { palette: 'b' });

        const moved = applyDragOverToItems(
            items,
            'flow-1',
            slotDroppableId('palette', 4),
            layouts,
            blocked
        );
        expect(moved['palette']![4]).toBe('flow-1');
        expect(moved['flow']).toEqual([]);

        const placedIds = new Set(
            Object.values(moved).flatMap((list) =>
                list.filter((id): id is string => id !== null)
            )
        );
        const next = applySlotIdsToPalette(
            palette,
            moved['palette']!,
            collectButtonsById(categories),
            'b',
            placedIds
        );
        expect(findContextProfile(next, 'b')!.buttons.map((b) => b.id)).toEqual([
            'b-tool',
            'flow-1',
        ]);
        expect(next.buttons.map((b) => b.id)).toEqual(['home', 'search']);
        expect(findContextProfile(next, 'a')).toEqual(findContextProfile(palette, 'a'));
    });

    it('rejects a flow tool aimed at a pinned base slot', () => {
        const categories = [nodeTools(), flowCategory()];
        const { items, layouts, blocked } = dragSetup(categories, { palette: 'a' });
        expect(
            applyDragOverToItems(
                items,
                'flow-1',
                slotDroppableId('palette', 0),
                layouts,
                blocked
            )
        ).toBe(items);
    });

    it('removes a context tool that was dragged out into a flow category', () => {
        const palette = nodeTools();
        const flow = flowCategory();
        const categories = [palette, flow];
        const { items, layouts, blocked } = dragSetup(categories, { palette: 'a' });

        const moved = applyDragOverToItems(items, 'a-tool', 'flow-1', layouts, blocked);
        expect(moved['flow']).toContain('a-tool');
        // Leaving a grid leaves a hole rather than collapsing the array.
        expect(moved['palette']![1]).toBeNull();

        const placedIds = new Set(
            Object.values(moved).flatMap((list) =>
                list.filter((id): id is string => id !== null)
            )
        );
        const next = applySlotIdsToPalette(
            palette,
            moved['palette']!,
            collectButtonsById(categories),
            'a',
            placedIds
        );
        expect(findContextProfile(next, 'a')!.buttons.map((b) => b.id)).toEqual([
            'a-tool-2',
        ]);
        expect(findContextProfile(next, 'b')).toEqual(findContextProfile(palette, 'b'));
    });
});

describe('a rejected drop reverts the whole drag', () => {
    // The live drag state follows the pointer, so by the time it reaches a
    // blocked cell it may already show the tool on the last accepted cell it
    // crossed. Persisting that would drop the tool somewhere the user never
    // aimed at, so the drop is reported as rejected and the caller reverts.
    it('reports a pinned base slot as blocked', () => {
        const category = nodeTools();
        const { items, layouts, blocked } = dragSetup([category], { palette: 'a' });
        expect(
            resolveGridDropOutcome(items, 'a-tool', slotDroppableId('palette', 0), layouts, blocked)
        ).toBe('blocked');
        expect(resolveGridDropOutcome(items, 'a-tool', 'home', layouts, blocked)).toBe('blocked');
    });

    it('reports a profile-reserved slot as blocked while editing the base layer', () => {
        const category = nodeTools();
        const { items, layouts, blocked } = dragSetup([category], {});
        expect(
            resolveGridDropOutcome(items, 'home', slotDroppableId('palette', 1), layouts, blocked)
        ).toBe('blocked');
    });

    it('accepts an ordinary free or occupied slot of the same layer', () => {
        const category = nodeTools();
        const { items, layouts, blocked } = dragSetup([category], { palette: 'a' });
        expect(
            resolveGridDropOutcome(items, 'a-tool', slotDroppableId('palette', 4), layouts, blocked)
        ).toBe('accept');
        expect(resolveGridDropOutcome(items, 'a-tool', 'a-tool-2', layouts, blocked)).toBe(
            'accept'
        );
    });

    it('reports a flow tool aimed at an occupied slot as blocked', () => {
        const palette = nodeTools();
        const flow: CategoryConfig = {
            id: 'flow',
            name: 'Flow',
            order: 1,
            buttons: [{ id: 'flow-1', name: 'flow-1', actions: [], order: 0 }],
        };
        const { items, layouts, blocked } = dragSetup([palette, flow], { palette: 'a' });
        expect(resolveGridDropOutcome(items, 'flow-1', 'a-tool', layouts, blocked)).toBe(
            'blocked'
        );
        expect(
            resolveGridDropOutcome(items, 'flow-1', slotDroppableId('palette', 4), layouts, blocked)
        ).toBe('accept');
    });

    it('reports the palette background as no-cell, so the drag reverts silently', () => {
        const category = nodeTools();
        const { items, layouts, blocked } = dragSetup([category], { palette: 'a' });
        expect(
            resolveGridDropOutcome(items, 'a-tool', 'container:palette', layouts, blocked)
        ).toBe('no-cell');
    });

    it('never refuses anything for a flow container', () => {
        const flow: CategoryConfig = {
            id: 'flow',
            name: 'Flow',
            order: 0,
            buttons: [{ id: 'f1', name: 'f1', actions: [], order: 0 }],
        };
        const { items, layouts, blocked } = dragSetup([flow], {});
        expect(resolveGridDropOutcome(items, 'f1', 'f1', layouts, blocked)).toBe('accept');
        expect(resolveGridDropOutcome(items, 'f1', 'container:flow', layouts, blocked)).toBe(
            'accept'
        );
    });
});

describe('palettes without context profiles behave exactly as before', () => {
    const plain: CategoryConfig = {
        id: 'plain',
        name: 'Plain',
        order: 0,
        layout: 'grid',
        buttons: [button('a', 0), button('b', 5, 1)],
    };

    it('blocks nothing', () => {
        expect(blockedSlotsForLayer(plain, BASE_LAYER_ID).some(Boolean)).toBe(false);
    });

    it('moves and swaps like the pre-layer palette did', () => {
        const { items, layouts, blocked } = dragSetup([plain], {});
        const moved = applyDragOverToItems(
            items,
            'a',
            slotDroppableId('plain', 9),
            layouts,
            blocked
        );
        expect(moved['plain']![0]).toBeNull();
        expect(moved['plain']![9]).toBe('a');

        const swapped = applyDragOverToItems(items, 'a', 'b', layouts, blocked);
        expect(swapped['plain']![0]).toBe('b');
        expect(swapped['plain']![5]).toBe('a');
    });

    it('builds the same drag state with and without a resolution', () => {
        expect(buildButtonDragItems([plain])).toEqual(dragSetup([plain], {}).items);
    });
});
