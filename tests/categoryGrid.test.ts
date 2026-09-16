import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig } from '@/types/settings';
import {
    GRID_COLUMNS,
    GRID_ROWS,
    GRID_SLOT_COUNT,
    buildGridSlotIds,
    findFirstFreeSlot,
    findSlotOfId,
    getCategoryLayout,
    hasUniqueSlotIds,
    isGridCategory,
    isValidSlotIndex,
    moveIdToSlotWithinGrid,
    placeButtonsOnGrid,
    slotColumn,
    slotRow,
} from '@/utils/categoryGrid';
import {
    applyCategoryLayout,
    convertCategoryToFlow,
    convertCategoryToGrid,
} from '@/utils/paletteLayers';

function button(id: string, order: number, slot?: number): ButtonConfig {
    const b: ButtonConfig = { id, name: id, actions: [], order };
    if (slot !== undefined) b.slot = slot;
    return b;
}

function category(
    buttons: ButtonConfig[],
    layout?: 'flow' | 'grid'
): CategoryConfig {
    const c: CategoryConfig = { id: 'cat', name: 'Cat', order: 0, buttons };
    if (layout) c.layout = layout;
    return c;
}

describe('grid geometry', () => {
    it('is a 4x4 field of 16 slots', () => {
        expect(GRID_COLUMNS).toBe(4);
        expect(GRID_ROWS).toBe(4);
        expect(GRID_SLOT_COUNT).toBe(16);
    });

    it('maps slots to rows and columns in reading order', () => {
        expect([slotRow(0), slotColumn(0)]).toEqual([0, 0]);
        expect([slotRow(3), slotColumn(3)]).toEqual([0, 3]);
        expect([slotRow(4), slotColumn(4)]).toEqual([1, 0]);
        expect([slotRow(15), slotColumn(15)]).toEqual([3, 3]);
    });

    it('accepts only integer slot indices inside the grid', () => {
        expect(isValidSlotIndex(0)).toBe(true);
        expect(isValidSlotIndex(15)).toBe(true);
        expect(isValidSlotIndex(16)).toBe(false);
        expect(isValidSlotIndex(-1)).toBe(false);
        expect(isValidSlotIndex(1.5)).toBe(false);
        expect(isValidSlotIndex('3')).toBe(false);
        expect(isValidSlotIndex(undefined)).toBe(false);
        expect(isValidSlotIndex(NaN)).toBe(false);
    });
});

describe('getCategoryLayout / isGridCategory', () => {
    it('treats an absent layout as flow (backward compatibility)', () => {
        expect(getCategoryLayout(category([]))).toBe('flow');
        expect(isGridCategory(category([]))).toBe(false);
    });

    it('reads an explicit layout', () => {
        expect(getCategoryLayout(category([], 'grid'))).toBe('grid');
        expect(getCategoryLayout(category([], 'flow'))).toBe('flow');
    });

    it('falls back to flow for unknown values', () => {
        const weird = { layout: 'hexagon' } as unknown as CategoryConfig;
        expect(getCategoryLayout(weird)).toBe('flow');
    });
});

describe('placeButtonsOnGrid', () => {
    it('always returns 16 cells', () => {
        expect(placeButtonsOnGrid([]).slots).toHaveLength(GRID_SLOT_COUNT);
        expect(placeButtonsOnGrid([button('a', 0, 0)]).slots).toHaveLength(GRID_SLOT_COUNT);
    });

    it('honours stored slots and leaves the gaps empty', () => {
        const { slots, overflow } = placeButtonsOnGrid([
            button('a', 0, 0),
            button('b', 1, 2),
            button('c', 2, 3),
        ]);

        expect(slots[0]?.id).toBe('a');
        expect(slots[1]).toBeNull();
        expect(slots[2]?.id).toBe('b');
        expect(slots[3]?.id).toBe('c');
        expect(overflow).toEqual([]);
    });

    it('keeps several holes in place', () => {
        const { slots } = placeButtonsOnGrid([
            button('a', 0, 0),
            button('b', 1, 7),
            button('c', 2, 15),
        ]);

        expect(slots.map((b) => b?.id ?? null)).toEqual([
            'a', null, null, null, null, null, null, 'b',
            null, null, null, null, null, null, null, 'c',
        ]);
    });

    it('assigns the lowest free slot to buttons without one', () => {
        const { slots } = placeButtonsOnGrid([
            button('pinned', 0, 5),
            button('x', 1),
            button('y', 2),
        ]);

        expect(slots[0]?.id).toBe('x');
        expect(slots[1]?.id).toBe('y');
        expect(slots[5]?.id).toBe('pinned');
    });

    it('resolves duplicate slots deterministically without losing buttons', () => {
        const { slots, overflow } = placeButtonsOnGrid([
            button('first', 0, 4),
            button('second', 1, 4),
        ]);

        // First by order keeps the contested slot, the other is re-homed.
        expect(slots[4]?.id).toBe('first');
        expect(slots[0]?.id).toBe('second');
        expect(overflow).toEqual([]);
        expect(slots.filter(Boolean)).toHaveLength(2);
    });

    it('repairs out-of-range slots instead of dropping the button', () => {
        const { slots, overflow } = placeButtonsOnGrid([
            button('bad', 0, 99),
            button('worse', 1, -3),
        ]);

        expect(slots[0]?.id).toBe('bad');
        expect(slots[1]?.id).toBe('worse');
        expect(overflow).toEqual([]);
    });

    it('reports buttons beyond the grid as overflow rather than dropping them', () => {
        const buttons = Array.from({ length: 18 }, (_, i) => button(`b${i}`, i));
        const { slots, overflow } = placeButtonsOnGrid(buttons);

        expect(slots.filter(Boolean)).toHaveLength(GRID_SLOT_COUNT);
        expect(overflow.map((b) => b.id)).toEqual(['b16', 'b17']);
        expect(slots.filter(Boolean).length + overflow.length).toBe(18);
    });

    it('does not mutate its input', () => {
        const buttons = [button('a', 0, 3)];
        const snapshot: ButtonConfig[] = JSON.parse(
            JSON.stringify(buttons)
        ) as ButtonConfig[];
        placeButtonsOnGrid(buttons);
        expect(buttons).toEqual(snapshot);
    });

    it('is stable across repeated placement (serialization equivalence)', () => {
        const buttons = [button('a', 0, 0), button('b', 1, 5), button('c', 2, 9)];
        const first = buildGridSlotIds(buttons);
        const roundTripped: ButtonConfig[] = JSON.parse(
            JSON.stringify(buttons)
        ) as ButtonConfig[];
        expect(buildGridSlotIds(roundTripped)).toEqual(first);
    });
});

describe('slot id helpers', () => {
    it('finds the first free slot and the slot of an id', () => {
        const slots = buildGridSlotIds([button('a', 0, 0), button('b', 1, 1)]);
        expect(findFirstFreeSlot(slots)).toBe(2);
        expect(findSlotOfId(slots, 'b')).toBe(1);
        expect(findSlotOfId(slots, 'nope')).toBeNull();
    });

    it('reports a full grid as having no free slot', () => {
        const slots = buildGridSlotIds(
            Array.from({ length: 16 }, (_, i) => button(`b${i}`, i, i))
        );
        expect(findFirstFreeSlot(slots)).toBeNull();
    });

    it('detects duplicate slot ids', () => {
        expect(hasUniqueSlotIds(['a', null, 'b'])).toBe(true);
        expect(hasUniqueSlotIds(['a', 'a'])).toBe(false);
        expect(hasUniqueSlotIds([null, null])).toBe(true);
    });

    it('never produces duplicate ids from placement', () => {
        const slots = buildGridSlotIds([
            button('a', 0, 2),
            button('b', 1, 2),
            button('c', 2),
        ]);
        expect(hasUniqueSlotIds(slots)).toBe(true);
    });
});

describe('moveIdToSlotWithinGrid', () => {
    const base = () => buildGridSlotIds([button('a', 0, 0), button('b', 1, 1)]);

    it('moves a button onto an empty slot and leaves a hole behind', () => {
        const next = moveIdToSlotWithinGrid(base(), 'a', 6);
        expect(next[6]).toBe('a');
        expect(next[0]).toBeNull();
        expect(next[1]).toBe('b');
    });

    it('swaps two occupied slots without touching anything else', () => {
        const slots = buildGridSlotIds([
            button('a', 0, 0),
            button('b', 1, 1),
            button('c', 2, 2),
        ]);
        const next = moveIdToSlotWithinGrid(slots, 'a', 2);

        expect(next[2]).toBe('a');
        expect(next[0]).toBe('c');
        expect(next[1]).toBe('b');
    });

    it('does not shift a chain of buttons', () => {
        const slots = buildGridSlotIds([
            button('a', 0, 0),
            button('b', 1, 1),
            button('c', 2, 2),
            button('d', 3, 3),
        ]);
        const next = moveIdToSlotWithinGrid(slots, 'd', 0);

        expect(next.slice(0, 4)).toEqual(['d', 'b', 'c', 'a']);
    });

    it('returns the same reference when nothing changes', () => {
        const slots = base();
        expect(moveIdToSlotWithinGrid(slots, 'a', 0)).toBe(slots);
        expect(moveIdToSlotWithinGrid(slots, 'missing', 5)).toBe(slots);
        expect(moveIdToSlotWithinGrid(slots, 'a', 99)).toBe(slots);
    });

    it('does not mutate the input array', () => {
        const slots = base();
        const copy = [...slots];
        moveIdToSlotWithinGrid(slots, 'a', 9);
        expect(slots).toEqual(copy);
    });
});

describe('convertCategoryToGrid', () => {
    it('lays existing buttons out in order on slots 0..n-1', () => {
        const result = convertCategoryToGrid(
            category([button('a', 0), button('b', 1), button('c', 2)])
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category.layout).toBe('grid');
        expect(result.category.buttons.map((b) => [b.id, b.slot])).toEqual([
            ['a', 0],
            ['b', 1],
            ['c', 2],
        ]);
    });

    it('respects the stored order rather than the array order', () => {
        const result = convertCategoryToGrid(
            category([button('late', 2), button('early', 0), button('mid', 1)])
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category.buttons.map((b) => b.id)).toEqual(['early', 'mid', 'late']);
        expect(result.category.buttons.map((b) => b.slot)).toEqual([0, 1, 2]);
    });

    it('handles an empty category', () => {
        const result = convertCategoryToGrid(category([]));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category.buttons).toEqual([]);
        expect(placeButtonsOnGrid(result.category.buttons).slots.filter(Boolean)).toEqual([]);
    });

    it('handles a single button', () => {
        const result = convertCategoryToGrid(category([button('only', 0)]));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category.buttons[0]!.slot).toBe(0);
    });

    it('handles exactly 16 buttons', () => {
        const buttons = Array.from({ length: 16 }, (_, i) => button(`b${i}`, i));
        const result = convertCategoryToGrid(category(buttons));

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category.buttons.map((b) => b.slot)).toEqual(
            Array.from({ length: 16 }, (_, i) => i)
        );
        expect(placeButtonsOnGrid(result.category.buttons).overflow).toEqual([]);
    });

    it('refuses more than 16 buttons instead of losing any', () => {
        const buttons = Array.from({ length: 17 }, (_, i) => button(`b${i}`, i));
        const result = convertCategoryToGrid(category(buttons));

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('too_many_buttons');
        expect(result.buttonCount).toBe(17);
        expect(result.slotCount).toBe(16);
    });

    it('replaces objects instead of mutating them (identity convention)', () => {
        const original = category([button('a', 0)]);
        const originalButton = original.buttons[0]!;
        const result = convertCategoryToGrid(original);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category).not.toBe(original);
        expect(result.category.buttons[0]).not.toBe(originalButton);
        expect(originalButton.slot).toBeUndefined();
        expect(original.layout).toBeUndefined();
    });

    it('lifts a per-button condition into a context profile, keeping every other field', () => {
        // A palette models contextuality through its layers, so the condition
        // moves to a profile instead of staying (inert) on the button.
        const rich: ButtonConfig = {
            id: 'x',
            name: 'X',
            icon: 'star',
            actions: [],
            order: 0,
            conditions: { rule: 'viewType', value: 'markdown' },
            customCss: 'color: red',
        };
        const result = convertCategoryToGrid(category([rich]));

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category.buttons).toEqual([]);

        const profile = result.category.contextProfiles![0]!;
        expect(profile.conditions).toEqual({ rule: 'viewType', value: 'markdown' });
        expect(profile.name).toBe('markdown');
        expect(profile.buttons[0]).toMatchObject({
            id: 'x',
            icon: 'star',
            customCss: 'color: red',
            slot: 0,
        });
        expect(profile.buttons[0]!.conditions).toBeUndefined();
    });

    it('keeps a conditionless button on the base layer', () => {
        const result = convertCategoryToGrid(category([button('a', 0), button('b', 1)]));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category.buttons.map((b) => [b.id, b.slot])).toEqual([
            ['a', 0],
            ['b', 1],
        ]);
        expect(result.category.contextProfiles).toBeUndefined();
    });
});

describe('convertCategoryToFlow', () => {
    it('keeps the spatial reading order and drops the slots', () => {
        const grid = category(
            [button('c', 0, 9), button('a', 1, 1), button('b', 2, 4)],
            'grid'
        );
        const flow = convertCategoryToFlow(grid);

        expect(flow.layout).toBe('flow');
        expect(flow.buttons.map((b) => b.id)).toEqual(['a', 'b', 'c']);
        expect(flow.buttons.map((b) => b.order)).toEqual([0, 1, 2]);
        expect(flow.buttons.every((b) => b.slot === undefined)).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(flow.buttons[0]!, 'slot')).toBe(false);
    });

    it('loses no button, including overflow', () => {
        const buttons = Array.from({ length: 18 }, (_, i) => button(`b${i}`, i, i < 16 ? i : undefined));
        const flow = convertCategoryToFlow(category(buttons, 'grid'));
        expect(flow.buttons).toHaveLength(18);
    });
});

describe('applyCategoryLayout', () => {
    it('is a no-op when the layout does not change', () => {
        const flow = category([button('a', 0)]);
        const result = applyCategoryLayout(flow, 'flow');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category).toBe(flow);
    });

    it('treats an absent layout as flow when comparing', () => {
        const legacy = category([button('a', 0)]);
        const result = applyCategoryLayout(legacy, 'flow');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category).toBe(legacy);
        expect(result.category.layout).toBeUndefined();
    });

    it('converts flow -> grid and back without losing buttons', () => {
        const flow = category([button('a', 0), button('b', 1), button('c', 2)]);

        const toGrid = applyCategoryLayout(flow, 'grid');
        expect(toGrid.ok).toBe(true);
        if (!toGrid.ok) return;

        const backToFlow = applyCategoryLayout(toGrid.category, 'flow');
        expect(backToFlow.ok).toBe(true);
        if (!backToFlow.ok) return;

        expect(backToFlow.category.buttons.map((b) => b.id)).toEqual(['a', 'b', 'c']);
        expect(backToFlow.category.buttons.map((b) => b.order)).toEqual([0, 1, 2]);
    });

    it('propagates the refusal for oversized categories', () => {
        const big = category(Array.from({ length: 20 }, (_, i) => button(`b${i}`, i)));
        const result = applyCategoryLayout(big, 'grid');
        expect(result.ok).toBe(false);
    });
});
