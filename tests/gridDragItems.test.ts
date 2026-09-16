import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig } from '@/types/settings';
import {
    applyDragOverToItems,
    buildButtonDragItems,
    buildContainerLayouts,
    containerDroppableId,
    findContainerForButtonId,
    getGridSlotButtonsFromAllCategories,
    getOrderedButtonsFromAllCategories,
    itemsShallowEqual,
    parseSlotDroppableId,
    resolveOverContainerId,
    slotDroppableId,
    titleDroppableId,
    type ButtonDragItems,
} from '@/utils/buttonDragItems';
import { GRID_SLOT_COUNT, hasUniqueSlotIds } from '@/utils/categoryGrid';

function button(id: string, order: number, slot?: number): ButtonConfig {
    const b: ButtonConfig = { id, name: id, actions: [], order };
    if (slot !== undefined) b.slot = slot;
    return b;
}

function grid(id: string, buttons: ButtonConfig[]): CategoryConfig {
    return { id, name: id, order: 0, buttons, layout: 'grid' };
}

function flow(id: string, buttons: ButtonConfig[]): CategoryConfig {
    return { id, name: id, order: 0, buttons };
}

describe('slot droppable ids', () => {
    it('round-trips a category id and slot', () => {
        expect(parseSlotDroppableId(slotDroppableId('cat-1', 7))).toEqual({
            categoryId: 'cat-1',
            slot: 7,
        });
    });

    it('survives a category id containing a colon', () => {
        expect(parseSlotDroppableId(slotDroppableId('a:b:c', 3))).toEqual({
            categoryId: 'a:b:c',
            slot: 3,
        });
    });

    it('rejects non-slot and out-of-range ids', () => {
        expect(parseSlotDroppableId('button-1')).toBeNull();
        expect(parseSlotDroppableId(containerDroppableId('cat'))).toBeNull();
        expect(parseSlotDroppableId('slot:cat:99')).toBeNull();
        expect(parseSlotDroppableId('slot:cat:abc')).toBeNull();
        expect(parseSlotDroppableId('slot:cat')).toBeNull();
    });

    it('resolves the container of a slot droppable', () => {
        const items = buildButtonDragItems([grid('g', [])]);
        expect(resolveOverContainerId(slotDroppableId('g', 2), items)).toBe('g');
    });
});

describe('buildButtonDragItems', () => {
    it('gives a grid category 16 entries with holes preserved', () => {
        const items = buildButtonDragItems([
            grid('g', [button('a', 0, 0), button('b', 1, 3)]),
        ]);

        expect(items['g']).toHaveLength(GRID_SLOT_COUNT);
        expect(items['g']![0]).toBe('a');
        expect(items['g']![1]).toBeNull();
        expect(items['g']![2]).toBeNull();
        expect(items['g']![3]).toBe('b');
    });

    it('keeps flow categories dense and ordered (unchanged behavior)', () => {
        const items = buildButtonDragItems([
            flow('f', [button('second', 1), button('first', 0)]),
        ]);
        expect(items['f']).toEqual(['first', 'second']);
    });

    it('finds the container of a button in a sparse grid array', () => {
        const items = buildButtonDragItems([grid('g', [button('a', 0, 9)])]);
        expect(findContainerForButtonId('a', items)).toBe('g');
    });
});

describe('grid drag-over: within one grid', () => {
    const categories = [
        grid('g', [button('a', 0, 0), button('b', 1, 1), button('c', 2, 2)]),
    ];
    const layouts = buildContainerLayouts(categories);
    const base = () => buildButtonDragItems(categories);

    it('moves a button onto an empty slot, leaving the old slot empty', () => {
        const next = applyDragOverToItems(base(), 'a', slotDroppableId('g', 10), layouts);

        expect(next['g']![10]).toBe('a');
        expect(next['g']![0]).toBeNull();
        expect(next['g']![1]).toBe('b');
        expect(next['g']![2]).toBe('c');
    });

    it('swaps when dropped on an occupied slot', () => {
        const next = applyDragOverToItems(base(), 'a', 'c', layouts);

        expect(next['g']![2]).toBe('a');
        expect(next['g']![0]).toBe('c');
        expect(next['g']![1]).toBe('b');
    });

    it('never shifts a chain of neighbours', () => {
        const next = applyDragOverToItems(base(), 'c', 'a', layouts);
        expect(next['g']!.slice(0, 3)).toEqual(['c', 'b', 'a']);
    });

    it('ignores the container zone (no positional meaning in a grid)', () => {
        const prev = base();
        expect(applyDragOverToItems(prev, 'a', containerDroppableId('g'), layouts)).toBe(prev);
        expect(applyDragOverToItems(prev, 'a', titleDroppableId('g'), layouts)).toBe(prev);
    });

    it('returns the same reference when the drop changes nothing', () => {
        const prev = base();
        expect(applyDragOverToItems(prev, 'a', slotDroppableId('g', 0), layouts)).toBe(prev);
        expect(applyDragOverToItems(prev, 'a', 'a', layouts)).toBe(prev);
    });

    it('keeps the array length and slot uniqueness invariant', () => {
        const next = applyDragOverToItems(base(), 'b', slotDroppableId('g', 15), layouts);
        expect(next['g']).toHaveLength(GRID_SLOT_COUNT);
        expect(hasUniqueSlotIds(next['g']!)).toBe(true);
    });
});

describe('grid drag-over: grid -> grid across categories', () => {
    const categories = [
        grid('g1', [button('a', 0, 0), button('b', 1, 1)]),
        grid('g2', [button('x', 0, 5)]),
    ];
    const layouts = buildContainerLayouts(categories);
    const base = () => buildButtonDragItems(categories);

    it('occupies an empty target slot and leaves a hole in the source', () => {
        const next = applyDragOverToItems(base(), 'a', slotDroppableId('g2', 8), layouts);

        expect(next['g2']![8]).toBe('a');
        expect(next['g1']![0]).toBeNull();
        expect(next['g1']![1]).toBe('b');
        expect(next['g1']).toHaveLength(GRID_SLOT_COUNT);
        expect(next['g2']).toHaveLength(GRID_SLOT_COUNT);
    });

    it('swaps across categories when the target slot is occupied', () => {
        const next = applyDragOverToItems(base(), 'a', 'x', layouts);

        expect(next['g2']![5]).toBe('a');
        expect(next['g1']![0]).toBe('x');
        expect(next['g1']![1]).toBe('b');
    });

    it('keeps every button accounted for after a swap', () => {
        const next = applyDragOverToItems(base(), 'a', 'x', layouts);
        const all = [...next['g1']!, ...next['g2']!].filter((id) => id !== null);
        expect(all.sort()).toEqual(['a', 'b', 'x']);
    });
});

describe('grid drag-over: cross-layout', () => {
    const categories = [
        flow('f', [button('f1', 0), button('f2', 1)]),
        grid('g', [button('a', 0, 0)]),
    ];
    const layouts = buildContainerLayouts(categories);
    const base = () => buildButtonDragItems(categories);

    it('flow -> grid lands on an empty slot', () => {
        const next = applyDragOverToItems(base(), 'f1', slotDroppableId('g', 4), layouts);

        expect(next['g']![4]).toBe('f1');
        expect(next['f']).toEqual(['f2']);
    });

    it('flow -> grid is rejected on an occupied slot (no cross-layout swap)', () => {
        const prev = base();
        expect(applyDragOverToItems(prev, 'f1', 'a', layouts)).toBe(prev);
        expect(applyDragOverToItems(prev, 'f1', slotDroppableId('g', 0), layouts)).toBe(prev);
    });

    it('grid -> flow inserts into the list and leaves the slot empty', () => {
        const next = applyDragOverToItems(base(), 'a', 'f2', layouts);

        expect(next['f']).toEqual(['f1', 'a', 'f2']);
        expect(next['g']![0]).toBeNull();
        expect(next['g']).toHaveLength(GRID_SLOT_COUNT);
    });

    it('grid -> flow appends when dropped on the category zone', () => {
        const next = applyDragOverToItems(base(), 'a', containerDroppableId('f'), layouts);
        expect(next['f']).toEqual(['f1', 'f2', 'a']);
        expect(next['g']![0]).toBeNull();
    });
});

describe('flow behavior is unchanged without layouts', () => {
    const categories = [
        flow('f1', [button('a', 0), button('b', 1), button('c', 2)]),
        flow('f2', [button('x', 0)]),
    ];
    const base = () => buildButtonDragItems(categories);

    it('reorders within a category', () => {
        const next = applyDragOverToItems(base(), 'a', 'c', buildContainerLayouts(categories));
        expect(next['f1']).toEqual(['b', 'c', 'a']);
    });

    it('works when no layouts argument is given at all', () => {
        const next = applyDragOverToItems(base(), 'a', 'c');
        expect(next['f1']).toEqual(['b', 'c', 'a']);
    });

    it('moves across categories', () => {
        const next = applyDragOverToItems(base(), 'a', 'x', buildContainerLayouts(categories));
        expect(next['f1']).toEqual(['b', 'c']);
        expect(next['f2']).toEqual(['a', 'x']);
    });
});

describe('reading drag state back', () => {
    const categories = [grid('g', [button('a', 0, 0), button('b', 1, 6)])];
    const items = buildButtonDragItems(categories);

    it('exposes 16 slot positions with holes as null', () => {
        const slots = getGridSlotButtonsFromAllCategories(categories[0]!, categories, items);

        expect(slots).toHaveLength(GRID_SLOT_COUNT);
        expect(slots[0]?.id).toBe('a');
        expect(slots[1]).toBeNull();
        expect(slots[6]?.id).toBe('b');
    });

    it('skips holes when read as an ordered list', () => {
        const ordered = getOrderedButtonsFromAllCategories(categories[0]!, categories, items);
        expect(ordered.map((b) => b.id)).toEqual(['a', 'b']);
    });

    it('returns an all-empty grid for an unknown container', () => {
        const slots = getGridSlotButtonsFromAllCategories(
            grid('other', []),
            categories,
            items
        );
        expect(slots.filter(Boolean)).toEqual([]);
        expect(slots).toHaveLength(GRID_SLOT_COUNT);
    });
});

describe('itemsShallowEqual with holes', () => {
    it('distinguishes a hole from a different id', () => {
        const a: ButtonDragItems = { g: ['x', null] };
        const b: ButtonDragItems = { g: ['x', 'y'] };
        expect(itemsShallowEqual(a, b)).toBe(false);
        expect(itemsShallowEqual(a, { g: ['x', null] })).toBe(true);
    });
});
