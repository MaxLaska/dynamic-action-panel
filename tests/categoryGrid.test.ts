import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig } from '@/types/settings';
import {
    DEFAULT_GRID_DIMENSIONS,
    LEGACY_GRID_DIMENSIONS,
    MAX_GRID_COLUMNS,
    MAX_GRID_ROWS,
    buildGridSlotIds,
    clampGridDimensions,
    findFirstFreeSlot,
    findSlotOfId,
    fitGridDimensions,
    getCategoryLayout,
    gridSlotCount,
    hasUniqueSlotIds,
    isGridCategory,
    isValidSlotIndex,
    moveIdToSlotWithinGrid,
    placeButtonsOnGrid,
    readGridDimensions,
    remapSlot,
    resizeGridButtons,
    slotColumn,
    slotRow,
    type GridDimensions,
} from '@/utils/categoryGrid';
import {
    applyCategoryLayout,
    convertCategoryToGrid,
    convertStaticGridToFlow,
} from '@/utils/categoryVariants';

const LEGACY = LEGACY_GRID_DIMENSIONS;

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

describe('grid dimensions', () => {
    it('reads stored data without dimensions as the legacy 4x4', () => {
        // The whole backward-compatibility story: nothing is migrated, absent
        // fields simply MEAN the historical fixed grid.
        expect(readGridDimensions(undefined)).toEqual({ rows: 4, columns: 4 });
        expect(readGridDimensions({})).toEqual({ rows: 4, columns: 4 });
        expect(gridSlotCount(readGridDimensions({}))).toBe(16);
    });

    it('starts a NEW grid at one row of three slots', () => {
        expect(DEFAULT_GRID_DIMENSIONS).toEqual({ rows: 1, columns: 3 });
    });

    it('reads explicit dimensions and repairs corrupt ones', () => {
        expect(readGridDimensions({ rows: 2, columns: 5 })).toEqual({ rows: 2, columns: 5 });
        // A partial record keeps the legacy value for the missing half.
        expect(readGridDimensions({ columns: 3 })).toEqual({ rows: 4, columns: 3 });
        // Garbage must never produce a zero-slot grid that hides every tool.
        expect(readGridDimensions({ rows: 0, columns: 99 })).toEqual({ rows: 1, columns: 5 });
        expect(
            readGridDimensions({ rows: 'x', columns: 1.5 } as unknown as GridDimensions)
        ).toEqual({ rows: 4, columns: 4 });
    });

    it('clamps to 1x1 .. 5x5', () => {
        expect(clampGridDimensions({ rows: 0, columns: 0 })).toEqual({ rows: 1, columns: 1 });
        expect(clampGridDimensions({ rows: 9, columns: 9 })).toEqual({
            rows: MAX_GRID_ROWS,
            columns: MAX_GRID_COLUMNS,
        });
    });

    it('maps slots to rows and columns against the grid own width', () => {
        expect([slotRow(0, 4), slotColumn(0, 4)]).toEqual([0, 0]);
        expect([slotRow(3, 4), slotColumn(3, 4)]).toEqual([0, 3]);
        expect([slotRow(4, 4), slotColumn(4, 4)]).toEqual([1, 0]);
        expect([slotRow(15, 4), slotColumn(15, 4)]).toEqual([3, 3]);
        // Same flat index, different grid: a different cell.
        expect([slotRow(4, 3), slotColumn(4, 3)]).toEqual([1, 1]);
    });

    it('accepts only integer slot indices inside the given grid', () => {
        expect(isValidSlotIndex(0, 16)).toBe(true);
        expect(isValidSlotIndex(15, 16)).toBe(true);
        expect(isValidSlotIndex(16, 16)).toBe(false);
        expect(isValidSlotIndex(3, 3)).toBe(false);
        expect(isValidSlotIndex(2, 3)).toBe(true);
        expect(isValidSlotIndex(-1, 16)).toBe(false);
        expect(isValidSlotIndex(1.5, 16)).toBe(false);
        expect(isValidSlotIndex('3', 16)).toBe(false);
        expect(isValidSlotIndex(undefined, 16)).toBe(false);
        expect(isValidSlotIndex(NaN, 16)).toBe(false);
    });

    it('fits a flow list into the smallest sensible grid', () => {
        expect(fitGridDimensions(0)).toEqual({ rows: 1, columns: 3 });
        expect(fitGridDimensions(3)).toEqual({ rows: 1, columns: 3 });
        expect(fitGridDimensions(4)).toEqual({ rows: 2, columns: 3 });
        expect(fitGridDimensions(16)).toEqual({ rows: 4, columns: 4 });
        expect(fitGridDimensions(25)).toEqual({ rows: 5, columns: 5 });
        expect(fitGridDimensions(26)).toBeNull();
    });
});

describe('remapSlot', () => {
    it('keeps the logical cell when a column is added', () => {
        const from = { rows: 2, columns: 3 };
        const to = { rows: 2, columns: 4 };
        // A B C / D E F  ->  A B C . / D E F .
        expect([0, 1, 2, 3, 4, 5].map((s) => remapSlot(s, from, to))).toEqual([
            0, 1, 2, 4, 5, 6,
        ]);
    });

    it('keeps the logical cell when a row is added (flat index unchanged)', () => {
        const from = { rows: 2, columns: 4 };
        const to = { rows: 3, columns: 4 };
        expect([0, 3, 4, 7].map((s) => remapSlot(s, from, to))).toEqual([0, 3, 4, 7]);
    });

    it('reports the cut-off cells when the right column goes', () => {
        const from = { rows: 2, columns: 4 };
        const to = { rows: 2, columns: 3 };
        // A B C X / D E F Y -> X and Y have no cell any more.
        expect([0, 1, 2, 3, 4, 5, 6, 7].map((s) => remapSlot(s, from, to))).toEqual([
            0, 1, 2, null, 3, 4, 5, null,
        ]);
    });

    it('reports the cut-off cells when the bottom row goes', () => {
        const from = { rows: 3, columns: 3 };
        const to = { rows: 2, columns: 3 };
        expect([0, 5, 6, 8].map((s) => remapSlot(s, from, to))).toEqual([0, 5, null, null]);
    });
});

describe('resizeGridButtons', () => {
    it('adding a column never reflows the existing arrangement', () => {
        const buttons = [
            button('A', 0, 0),
            button('B', 1, 1),
            button('C', 2, 2),
            button('D', 3, 3),
            button('E', 4, 4),
            button('F', 5, 5),
        ];
        const { buttons: next, removed } = resizeGridButtons(
            buttons,
            { rows: 2, columns: 3 },
            { rows: 2, columns: 4 }
        );

        expect(removed).toEqual([]);
        const bySlot = new Map(next.map((b) => [b.slot, b.id]));
        // A B C . / D E F .  — NOT A B C D / E F . .
        expect([0, 1, 2, 4, 5, 6].map((s) => bySlot.get(s))).toEqual([
            'A', 'B', 'C', 'D', 'E', 'F',
        ]);
        expect(bySlot.get(3)).toBeUndefined();
    });

    it('adding a row leaves every button exactly where it was', () => {
        const buttons = [button('A', 0, 0), button('B', 1, 7)];
        const { buttons: next, removed } = resizeGridButtons(
            buttons,
            { rows: 2, columns: 4 },
            { rows: 3, columns: 4 }
        );
        expect(removed).toEqual([]);
        expect(next.map((b) => [b.id, b.slot])).toEqual([
            ['A', 0],
            ['B', 7],
        ]);
    });

    it('removing the right column drops exactly that column', () => {
        // A B C X / D E F Y
        const buttons = [
            button('A', 0, 0),
            button('B', 1, 1),
            button('C', 2, 2),
            button('X', 3, 3),
            button('D', 4, 4),
            button('E', 5, 5),
            button('F', 6, 6),
            button('Y', 7, 7),
        ];
        const { buttons: next, removed } = resizeGridButtons(
            buttons,
            { rows: 2, columns: 4 },
            { rows: 2, columns: 3 }
        );

        expect(removed.map((b) => b.id)).toEqual(['X', 'Y']);
        expect(next.map((b) => [b.id, b.slot])).toEqual([
            ['A', 0],
            ['B', 1],
            ['C', 2],
            ['D', 3],
            ['E', 4],
            ['F', 5],
        ]);
    });

    it('removing the bottom row drops exactly that row', () => {
        const buttons = [
            button('A', 0, 0),
            button('B', 1, 2),
            button('Z', 2, 4),
        ];
        const { buttons: next, removed } = resizeGridButtons(
            buttons,
            { rows: 2, columns: 3 },
            { rows: 1, columns: 3 }
        );
        expect(removed.map((b) => b.id)).toEqual(['Z']);
        expect(next.map((b) => [b.id, b.slot])).toEqual([
            ['A', 0],
            ['B', 2],
        ]);
    });

    it('carries overflow buttons over instead of treating them as cut off', () => {
        const buttons = Array.from({ length: 4 }, (_, i) => button(`b${i}`, i, i));
        const { buttons: next, removed } = resizeGridButtons(
            buttons,
            { rows: 1, columns: 3 },
            { rows: 2, columns: 3 }
        );
        // b3 had no cell on a 1x3 grid, so nothing of its was removed.
        expect(removed).toEqual([]);
        expect(next).toHaveLength(4);
    });

    it('does not mutate its input', () => {
        const buttons = [button('a', 0, 3)];
        const snapshot = JSON.parse(JSON.stringify(buttons)) as ButtonConfig[];
        resizeGridButtons(buttons, { rows: 2, columns: 2 }, { rows: 1, columns: 2 });
        expect(buttons).toEqual(snapshot);
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
    it('returns exactly the grid cell count', () => {
        expect(placeButtonsOnGrid([], LEGACY).slots).toHaveLength(16);
        expect(placeButtonsOnGrid([button('a', 0, 0)], LEGACY).slots).toHaveLength(16);
        expect(placeButtonsOnGrid([], { rows: 1, columns: 3 }).slots).toHaveLength(3);
        expect(placeButtonsOnGrid([], { rows: 3, columns: 5 }).slots).toHaveLength(15);
    });

    it('honours stored slots and leaves the gaps empty', () => {
        const { slots, overflow } = placeButtonsOnGrid(
            [button('a', 0, 0), button('b', 1, 2), button('c', 2, 3)],
            LEGACY
        );

        expect(slots[0]?.id).toBe('a');
        expect(slots[1]).toBeNull();
        expect(slots[2]?.id).toBe('b');
        expect(slots[3]?.id).toBe('c');
        expect(overflow).toEqual([]);
    });

    it('keeps several holes in place', () => {
        const { slots } = placeButtonsOnGrid(
            [button('a', 0, 0), button('b', 1, 7), button('c', 2, 15)],
            LEGACY
        );

        expect(slots.map((b) => b?.id ?? null)).toEqual([
            'a', null, null, null, null, null, null, 'b',
            null, null, null, null, null, null, null, 'c',
        ]);
    });

    it('assigns the lowest free slot to buttons without one', () => {
        const { slots } = placeButtonsOnGrid(
            [button('pinned', 0, 5), button('x', 1), button('y', 2)],
            LEGACY
        );

        expect(slots[0]?.id).toBe('x');
        expect(slots[1]?.id).toBe('y');
        expect(slots[5]?.id).toBe('pinned');
    });

    it('resolves duplicate slots deterministically without losing buttons', () => {
        const { slots, overflow } = placeButtonsOnGrid(
            [button('first', 0, 4), button('second', 1, 4)],
            LEGACY
        );

        // First by order keeps the contested slot, the other is re-homed.
        expect(slots[4]?.id).toBe('first');
        expect(slots[0]?.id).toBe('second');
        expect(overflow).toEqual([]);
        expect(slots.filter(Boolean)).toHaveLength(2);
    });

    it('repairs out-of-range slots instead of dropping the button', () => {
        const { slots, overflow } = placeButtonsOnGrid(
            [button('bad', 0, 99), button('worse', 1, -3)],
            LEGACY
        );

        expect(slots[0]?.id).toBe('bad');
        expect(slots[1]?.id).toBe('worse');
        expect(overflow).toEqual([]);
    });

    it('treats a slot outside a SMALL grid as out of range', () => {
        // The same stored data renders differently on a smaller grid — the
        // button is re-homed, never dropped.
        const { slots, overflow } = placeButtonsOnGrid(
            [button('a', 0, 9)],
            { rows: 1, columns: 3 }
        );
        expect(slots[0]?.id).toBe('a');
        expect(overflow).toEqual([]);
    });

    it('reports buttons beyond the grid as overflow rather than dropping them', () => {
        const buttons = Array.from({ length: 18 }, (_, i) => button(`b${i}`, i));
        const { slots, overflow } = placeButtonsOnGrid(buttons, LEGACY);

        expect(slots.filter(Boolean)).toHaveLength(16);
        expect(overflow.map((b) => b.id)).toEqual(['b16', 'b17']);
        expect(slots.filter(Boolean).length + overflow.length).toBe(18);
    });

    it('does not mutate its input', () => {
        const buttons = [button('a', 0, 3)];
        const snapshot: ButtonConfig[] = JSON.parse(
            JSON.stringify(buttons)
        ) as ButtonConfig[];
        placeButtonsOnGrid(buttons, LEGACY);
        expect(buttons).toEqual(snapshot);
    });

    it('is stable across repeated placement (serialization equivalence)', () => {
        const buttons = [button('a', 0, 0), button('b', 1, 5), button('c', 2, 9)];
        const first = buildGridSlotIds(buttons, LEGACY);
        const roundTripped: ButtonConfig[] = JSON.parse(
            JSON.stringify(buttons)
        ) as ButtonConfig[];
        expect(buildGridSlotIds(roundTripped, LEGACY)).toEqual(first);
    });
});

describe('slot id helpers', () => {
    it('finds the first free slot and the slot of an id', () => {
        const slots = buildGridSlotIds([button('a', 0, 0), button('b', 1, 1)], LEGACY);
        expect(findFirstFreeSlot(slots)).toBe(2);
        expect(findSlotOfId(slots, 'b')).toBe(1);
        expect(findSlotOfId(slots, 'nope')).toBeNull();
    });

    it('reports a full grid as having no free slot, at any size', () => {
        expect(
            findFirstFreeSlot(
                buildGridSlotIds(
                    Array.from({ length: 16 }, (_, i) => button(`b${i}`, i, i)),
                    LEGACY
                )
            )
        ).toBeNull();
        expect(
            findFirstFreeSlot(
                buildGridSlotIds(
                    Array.from({ length: 3 }, (_, i) => button(`b${i}`, i, i)),
                    { rows: 1, columns: 3 }
                )
            )
        ).toBeNull();
    });

    it('detects duplicate slot ids', () => {
        expect(hasUniqueSlotIds(['a', null, 'b'])).toBe(true);
        expect(hasUniqueSlotIds(['a', 'a'])).toBe(false);
        expect(hasUniqueSlotIds([null, null])).toBe(true);
    });

    it('never produces duplicate ids from placement', () => {
        const slots = buildGridSlotIds(
            [button('a', 0, 2), button('b', 1, 2), button('c', 2)],
            LEGACY
        );
        expect(hasUniqueSlotIds(slots)).toBe(true);
    });
});

describe('moveIdToSlotWithinGrid', () => {
    const base = () => buildGridSlotIds([button('a', 0, 0), button('b', 1, 1)], LEGACY);

    it('moves a button onto an empty slot and leaves a hole behind', () => {
        const next = moveIdToSlotWithinGrid(base(), 'a', 6);
        expect(next[6]).toBe('a');
        expect(next[0]).toBeNull();
        expect(next[1]).toBe('b');
    });

    it('swaps two occupied slots without touching anything else', () => {
        const slots = buildGridSlotIds(
            [button('a', 0, 0), button('b', 1, 1), button('c', 2, 2)],
            LEGACY
        );
        const next = moveIdToSlotWithinGrid(slots, 'a', 2);

        expect(next[2]).toBe('a');
        expect(next[0]).toBe('c');
        expect(next[1]).toBe('b');
    });

    it('does not shift a chain of buttons', () => {
        const slots = buildGridSlotIds(
            [button('a', 0, 0), button('b', 1, 1), button('c', 2, 2), button('d', 3, 3)],
            LEGACY
        );
        const next = moveIdToSlotWithinGrid(slots, 'd', 0);

        expect(next.slice(0, 4)).toEqual(['d', 'b', 'c', 'a']);
    });

    it('bounds the target by the live grid, not by a fixed slot count', () => {
        const small = buildGridSlotIds(
            [button('a', 0, 0), button('b', 1, 1)],
            { rows: 1, columns: 3 }
        );
        // Slot 5 exists on a 4x4 grid but not on this one.
        expect(moveIdToSlotWithinGrid(small, 'a', 5)).toBe(small);
        expect(moveIdToSlotWithinGrid(small, 'a', 2)[2]).toBe('a');
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

    it('sizes the new grid to the flow list', () => {
        const three = convertCategoryToGrid(
            category([button('a', 0), button('b', 1), button('c', 2)])
        );
        expect(three.ok).toBe(true);
        if (!three.ok) return;
        expect(readGridDimensions(three.category)).toEqual({ rows: 1, columns: 3 });

        const five = convertCategoryToGrid(
            category(Array.from({ length: 5 }, (_, i) => button(`b${i}`, i)))
        );
        expect(five.ok).toBe(true);
        if (!five.ok) return;
        expect(readGridDimensions(five.category)).toEqual({ rows: 2, columns: 3 });
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
        expect(readGridDimensions(result.category)).toEqual(DEFAULT_GRID_DIMENSIONS);
    });

    it('handles a single button', () => {
        const result = convertCategoryToGrid(category([button('only', 0)]));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category.buttons[0]!.slot).toBe(0);
    });

    it('handles exactly 25 buttons', () => {
        const buttons = Array.from({ length: 25 }, (_, i) => button(`b${i}`, i));
        const result = convertCategoryToGrid(category(buttons));

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(readGridDimensions(result.category)).toEqual({ rows: 5, columns: 5 });
        expect(result.category.buttons.map((b) => b.slot)).toEqual(
            Array.from({ length: 25 }, (_, i) => i)
        );
        expect(
            placeButtonsOnGrid(
                result.category.buttons,
                readGridDimensions(result.category)
            ).overflow
        ).toEqual([]);
    });

    it('refuses more buttons than the largest grid holds instead of losing any', () => {
        const buttons = Array.from({ length: 26 }, (_, i) => button(`b${i}`, i));
        const result = convertCategoryToGrid(category(buttons));

        expect(result.ok).toBe(false);
        if (result.ok || result.reason !== 'too_many_buttons') {
            expect.fail('expected a too_many_buttons refusal');
            return;
        }
        expect(result.buttonCount).toBe(26);
        expect(result.slotCount).toBe(25);
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
        expect(original.rows).toBeUndefined();
    });

    it('lifts a per-button condition into a variant, keeping every other field', () => {
        // A grid models contextuality through variants, so the condition
        // becomes a variant trigger instead of staying (inert) on the button.
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
        // A dynamic category keeps no size of its own — each variant has one.
        expect(result.category.rows).toBeUndefined();

        const variant = result.category.variants![0]!;
        expect(variant.trigger).toEqual({ rule: 'viewType', value: 'markdown' });
        expect(variant.name).toBe('markdown');
        expect(readGridDimensions(variant)).toEqual({ rows: 1, columns: 3 });
        expect(variant.buttons[0]).toMatchObject({
            id: 'x',
            icon: 'star',
            customCss: 'color: red',
            slot: 0,
        });
        expect(variant.buttons[0]!.conditions).toBeUndefined();
        // No condition-free tools, so no fallback variant is invented.
        expect(result.category.variants!.some((v) => v.fallback === true)).toBe(false);
    });

    it('keeps a conditionless category static (no variants)', () => {
        const result = convertCategoryToGrid(category([button('a', 0), button('b', 1)]));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category.buttons.map((b) => [b.id, b.slot])).toEqual([
            ['a', 0],
            ['b', 1],
        ]);
        expect(result.category.variants).toBeUndefined();
    });

    it('mixed conditions become a dynamic category with a Default fallback', () => {
        const conditional: ButtonConfig = {
            ...button('cond', 1),
            conditions: { rule: 'viewType', value: 'markdown' },
        };
        const result = convertCategoryToGrid(category([button('home', 0), conditional]));

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.category.buttons).toEqual([]);
        const variants = result.category.variants!;
        expect(variants).toHaveLength(2);
        // Triggered variant = full grid: base copy plus the conditional tool.
        expect(variants[0]!.buttons.map((b) => b.slot).sort()).toEqual([0, 1]);
        expect(variants[0]!.trigger).toEqual({ rule: 'viewType', value: 'markdown' });
        // Fallback = the condition-free tools only.
        expect(variants[1]!.fallback).toBe(true);
        expect(variants[1]!.name).toBe('Default');
        expect(variants[1]!.buttons.map((b) => b.id)).toEqual(['home']);
        // Every generated variant carries the same explicit size.
        for (const variant of variants) {
            expect(readGridDimensions(variant)).toEqual({ rows: 1, columns: 3 });
        }
    });
});

describe('convertStaticGridToFlow', () => {
    it('keeps the spatial reading order and drops the slots', () => {
        const grid = category(
            [button('c', 0, 9), button('a', 1, 1), button('b', 2, 4)],
            'grid'
        );
        const flow = convertStaticGridToFlow(grid);

        expect(flow.layout).toBe('flow');
        expect(flow.buttons.map((b) => b.id)).toEqual(['a', 'b', 'c']);
        expect(flow.buttons.map((b) => b.order)).toEqual([0, 1, 2]);
        expect(flow.buttons.every((b) => b.slot === undefined)).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(flow.buttons[0]!, 'slot')).toBe(false);
    });

    it('drops the grid dimensions along with the grid', () => {
        const grid: CategoryConfig = {
            ...category([button('a', 0, 0)], 'grid'),
            rows: 2,
            columns: 3,
        };
        const flow = convertStaticGridToFlow(grid);
        expect(Object.prototype.hasOwnProperty.call(flow, 'rows')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(flow, 'columns')).toBe(false);
    });

    it('loses no button, including overflow', () => {
        const buttons = Array.from({ length: 18 }, (_, i) =>
            button(`b${i}`, i, i < 16 ? i : undefined)
        );
        const flow = convertStaticGridToFlow(category(buttons, 'grid'));
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
        const big = category(Array.from({ length: 30 }, (_, i) => button(`b${i}`, i)));
        const result = applyCategoryLayout(big, 'grid');
        expect(result.ok).toBe(false);
    });

    it('refuses to flatten a dynamic category into a flow list', () => {
        const dynamic: CategoryConfig = {
            ...category([], 'grid'),
            variants: [
                { id: 'v1', name: 'Source', trigger: { all: [] }, buttons: [button('a', 0, 0)] },
                { id: 'v2', name: 'Topic', trigger: { all: [] }, buttons: [button('b', 0, 0)] },
            ],
        };
        const result = applyCategoryLayout(dynamic, 'flow');
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('dynamic_category');
    });
});
