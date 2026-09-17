import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig, CategoryVariant } from '@/types/settings';
import {
    addButtonToGrid,
    addVariant,
    applySlotIdsToGridCategory,
    convertStaticGridToDynamic,
    duplicateVariant,
    gridDimensionsOf,
    planGridResize,
    planGridResizeStep,
    resolveGridViewForContext,
    resolveGridViewForVariant,
    updateVariant,
} from '@/utils/categoryVariants';
import { readGridDimensions } from '@/utils/categoryGrid';
import {
    applyDragOverToItems,
    buildButtonDragItems,
    buildContainerLayouts,
    getGridSlotButtonsFromAllCategories,
    slotDroppableId,
} from '@/utils/buttonDragItems';
import { duplicateCategoryConfig } from '@/utils/categoryStore';
import type { OCAPContextSnapshot } from '@/context/OCAPContext';

/**
 * Variable grid dimensions.
 *
 * The critical property throughout: a resize is COORDINATE-aware. The stored
 * slot is a flat row-major index, so the same number names a different cell on
 * a grid of a different width — growing or shrinking therefore has to renumber,
 * and every surviving button must keep its logical row and column.
 */

function button(id: string, order: number, slot?: number): ButtonConfig {
    const b: ButtonConfig = { id, name: id, actions: [], order };
    if (slot !== undefined) b.slot = slot;
    return b;
}

/** Buttons filling a rows x columns grid, named by their cell. */
function fill(rows: number, columns: number): ButtonConfig[] {
    const buttons: ButtonConfig[] = [];
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const slot = row * columns + column;
            buttons.push(button(`r${row}c${column}`, slot, slot));
        }
    }
    return buttons;
}

function staticGrid(
    buttons: ButtonConfig[],
    dimensions?: { rows: number; columns: number }
): CategoryConfig {
    return {
        id: 'cat',
        name: 'Cat',
        order: 0,
        layout: 'grid',
        buttons,
        ...(dimensions ?? {}),
    };
}

function dynamicGrid(variants: CategoryVariant[]): CategoryConfig {
    return { id: 'cat', name: 'Cat', order: 0, layout: 'grid', buttons: [], variants };
}

function variant(
    id: string,
    buttons: ButtonConfig[],
    dimensions?: { rows: number; columns: number }
): CategoryVariant {
    return { id, name: id, trigger: { all: [] }, buttons, ...(dimensions ?? {}) };
}

const context: OCAPContextSnapshot = {
    hasActiveFile: false,
    filePath: null,
    fileName: null,
    fileExtension: null,
    folderPath: null,
    frontmatter: {},
    tags: [],
    viewType: null,
} as unknown as OCAPContextSnapshot;

/** Slot -> button id of a resolved view, for readable assertions. */
function layout(slots: (ButtonConfig | null)[]): (string | null)[] {
    return slots.map((b) => b?.id ?? null);
}

describe('legacy data keeps its 4x4 grid', () => {
    it('a stored grid without dimensions resolves as 4x4', () => {
        const category = staticGrid([button('a', 0, 0), button('b', 1, 15)]);
        const view = resolveGridViewForVariant(category, null);

        expect(view.dimensions).toEqual({ rows: 4, columns: 4 });
        expect(view.slots).toHaveLength(16);
        expect(view.slots[0]?.id).toBe('a');
        expect(view.slots[15]?.id).toBe('b');
    });

    it('a legacy variant without dimensions resolves as 4x4', () => {
        const category = dynamicGrid([variant('v1', [button('a', 0, 12)])]);
        const view = resolveGridViewForContext(category, context);

        expect(view.dimensions).toEqual({ rows: 4, columns: 4 });
        expect(view.slots[12]?.id).toBe('a');
    });

    it('an explicitly sized grid resolves at that size', () => {
        const category = staticGrid([button('a', 0, 2)], { rows: 1, columns: 3 });
        const view = resolveGridViewForVariant(category, null);

        expect(view.dimensions).toEqual({ rows: 1, columns: 3 });
        expect(layout(view.slots)).toEqual([null, null, 'a']);
    });
});

describe('planGridResizeStep: growing keeps logical coordinates', () => {
    it('+ column widens every row instead of reflowing (2x3 -> 2x4)', () => {
        const category = staticGrid(fill(2, 3), { rows: 2, columns: 3 });
        const plan = planGridResizeStep(category, null, 'column', 1)!;

        expect(plan.to).toEqual({ rows: 2, columns: 4 });
        expect(plan.removed).toEqual([]);
        expect(layout(resolveGridViewForVariant(plan.category, null).slots)).toEqual([
            'r0c0', 'r0c1', 'r0c2', null,
            'r1c0', 'r1c1', 'r1c2', null,
        ]);
    });

    it('+ row appends a full empty row (2x4 -> 3x4)', () => {
        const category = staticGrid(fill(2, 4), { rows: 2, columns: 4 });
        const plan = planGridResizeStep(category, null, 'row', 1)!;

        expect(plan.to).toEqual({ rows: 3, columns: 4 });
        expect(plan.removed).toEqual([]);
        expect(layout(resolveGridViewForVariant(plan.category, null).slots)).toEqual([
            'r0c0', 'r0c1', 'r0c2', 'r0c3',
            'r1c0', 'r1c1', 'r1c2', 'r1c3',
            null, null, null, null,
        ]);
    });

    it('a full grid gains usable free slots from a resize', () => {
        const category = staticGrid(fill(1, 3), { rows: 1, columns: 3 });
        const grown = planGridResizeStep(category, null, 'column', 1)!.category;
        const withTool = addButtonToGrid(grown, null, button('new', 99), 3);

        expect(withTool).not.toBeNull();
        expect(layout(resolveGridViewForVariant(withTool!, null).slots)).toEqual([
            'r0c0', 'r0c1', 'r0c2', 'new',
        ]);
    });
});

describe('planGridResizeStep: shrinking removes exactly the outer stripe', () => {
    it('removes an EMPTY right column without reporting anything to confirm', () => {
        const category = staticGrid(
            [button('a', 0, 0), button('b', 1, 4)],
            { rows: 2, columns: 4 }
        );
        const plan = planGridResizeStep(category, null, 'column', -1)!;

        expect(plan.removed).toEqual([]);
        expect(plan.to).toEqual({ rows: 2, columns: 3 });
        expect(layout(resolveGridViewForVariant(plan.category, null).slots)).toEqual([
            'a', null, null,
            'b', null, null,
        ]);
    });

    it('removes an EMPTY bottom row without reporting anything to confirm', () => {
        const category = staticGrid([button('a', 0, 1)], { rows: 3, columns: 3 });
        const plan = planGridResizeStep(category, null, 'row', -1)!;

        expect(plan.removed).toEqual([]);
        expect(plan.to).toEqual({ rows: 2, columns: 3 });
    });

    it('reports the tools of an OCCUPIED right column instead of dropping them silently', () => {
        const category = staticGrid(fill(2, 4), { rows: 2, columns: 4 });
        const plan = planGridResizeStep(category, null, 'column', -1)!;

        expect(plan.removed.map((b) => b.id)).toEqual(['r0c3', 'r1c3']);
        // Only that column goes; every other tool keeps its logical cell.
        expect(layout(resolveGridViewForVariant(plan.category, null).slots)).toEqual([
            'r0c0', 'r0c1', 'r0c2',
            'r1c0', 'r1c1', 'r1c2',
        ]);
    });

    it('reports the tools of an OCCUPIED bottom row', () => {
        const category = staticGrid(fill(3, 3), { rows: 3, columns: 3 });
        const plan = planGridResizeStep(category, null, 'row', -1)!;

        expect(plan.removed.map((b) => b.id)).toEqual(['r2c0', 'r2c1', 'r2c2']);
        expect(plan.category.buttons.map((b) => b.id)).toEqual([
            'r0c0', 'r0c1', 'r0c2', 'r1c0', 'r1c1', 'r1c2',
        ]);
    });

    it('is a PLAN: cancelling leaves the source category completely untouched', () => {
        const category = staticGrid(fill(2, 4), { rows: 2, columns: 4 });
        const snapshot = JSON.parse(JSON.stringify(category)) as CategoryConfig;

        const plan = planGridResizeStep(category, null, 'column', -1)!;
        expect(plan.removed).toHaveLength(2);
        // Nothing is committed until the caller stores `plan.category`.
        expect(category).toEqual(snapshot);
        expect(plan.category).not.toBe(category);
    });
});

describe('grid bounds', () => {
    it('never grows past 5x5', () => {
        const category = staticGrid([], { rows: 5, columns: 5 });
        expect(planGridResizeStep(category, null, 'row', 1)).toBeNull();
        expect(planGridResizeStep(category, null, 'column', 1)).toBeNull();
    });

    it('never shrinks below 1x1', () => {
        const category = staticGrid([], { rows: 1, columns: 1 });
        expect(planGridResizeStep(category, null, 'row', -1)).toBeNull();
        expect(planGridResizeStep(category, null, 'column', -1)).toBeNull();
    });

    it('clamps an explicit out-of-range request instead of storing it', () => {
        const category = staticGrid([], { rows: 2, columns: 2 });
        const plan = planGridResize(category, null, { rows: 99, columns: 0 })!;
        expect(plan.to).toEqual({ rows: 5, columns: 1 });
        expect(readGridDimensions(plan.category)).toEqual({ rows: 5, columns: 1 });
    });

    it('reports no plan when the size does not actually change', () => {
        const category = staticGrid([], { rows: 2, columns: 2 });
        expect(planGridResize(category, null, { rows: 2, columns: 2 })).toBeNull();
    });
});

describe('dimensions belong to the grid being edited', () => {
    it('resizing one variant leaves every other variant byte-identical', () => {
        const other = variant('v2', [button('x', 0, 0)], { rows: 2, columns: 2 });
        const fallback: CategoryVariant = {
            id: 'fb',
            name: 'Default',
            fallback: true,
            rows: 1,
            columns: 1,
            buttons: [],
        };
        const category = dynamicGrid([
            variant('v1', [button('a', 0, 0)], { rows: 1, columns: 3 }),
            other,
            fallback,
        ]);

        const plan = planGridResizeStep(category, 'v1', 'column', 1)!;
        const variants = plan.category.variants!;

        expect(readGridDimensions(variants[0])).toEqual({ rows: 1, columns: 4 });
        expect(variants[1]).toBe(other);
        expect(variants[2]).toBe(fallback);
        expect(gridDimensionsOf(plan.category, 'v2')).toEqual({ rows: 2, columns: 2 });
        expect(gridDimensionsOf(plan.category, 'fb')).toEqual({ rows: 1, columns: 1 });
    });

    it('a resized variant persists and resolves at its own size', () => {
        const category = dynamicGrid([
            variant('v1', fill(2, 3), { rows: 2, columns: 3 }),
            variant('v2', [button('x', 0, 0)], { rows: 4, columns: 4 }),
        ]);
        const resized = planGridResizeStep(category, 'v1', 'row', 1)!.category;

        // Round trip through JSON: this is what a plugin reload does.
        const reloaded = JSON.parse(JSON.stringify(resized)) as CategoryConfig;
        expect(resolveGridViewForVariant(reloaded, 'v1').dimensions).toEqual({
            rows: 3,
            columns: 3,
        });
        expect(resolveGridViewForVariant(reloaded, 'v2').dimensions).toEqual({
            rows: 4,
            columns: 4,
        });
    });

    it('editing a variant name or trigger never resizes its grid', () => {
        const category = dynamicGrid([variant('v1', [], { rows: 2, columns: 5 })]);
        const updated = updateVariant(category, 'v1', {
            name: 'Renamed',
            trigger: { all: [] },
            fallback: false,
        });
        expect(gridDimensionsOf(updated, 'v1')).toEqual({ rows: 2, columns: 5 });
    });

    it('a legacy variant stays free of size fields when only renamed', () => {
        const category = dynamicGrid([{ id: 'v1', name: 'V1', trigger: { all: [] }, buttons: [] }]);
        const updated = updateVariant(category, 'v1', {
            name: 'Renamed',
            trigger: { all: [] },
            fallback: false,
        });
        const v = updated.variants![0]!;
        expect(Object.prototype.hasOwnProperty.call(v, 'rows')).toBe(false);
        expect(gridDimensionsOf(updated, 'v1')).toEqual({ rows: 4, columns: 4 });
    });
});

describe('copy / duplicate / make dynamic keep the size', () => {
    it('duplicating a variant copies its dimensions', () => {
        const category = dynamicGrid([
            variant('v1', [button('a', 0, 4)], { rows: 2, columns: 5 }),
        ]);
        const copied = duplicateVariant(
            category,
            'v1',
            { id: 'copy', name: 'Copy' },
            (i) => `btn${i}`
        );

        expect(gridDimensionsOf(copied, 'copy')).toEqual({ rows: 2, columns: 5 });
        expect(copied.variants![1]!.buttons.map((b) => b.slot)).toEqual([4]);
    });

    it('duplicating a category copies the size of the grid and of every variant', () => {
        const staticCopy = duplicateCategoryConfig(
            staticGrid([button('a', 0, 0)], { rows: 3, columns: 2 }),
            1
        );
        expect(readGridDimensions(staticCopy)).toEqual({ rows: 3, columns: 2 });

        const dynamicCopy = duplicateCategoryConfig(
            dynamicGrid([
                variant('v1', [], { rows: 1, columns: 3 }),
                variant('v2', [], { rows: 5, columns: 5 }),
            ]),
            1
        );
        expect(readGridDimensions(dynamicCopy.variants![0])).toEqual({ rows: 1, columns: 3 });
        expect(readGridDimensions(dynamicCopy.variants![1])).toEqual({ rows: 5, columns: 5 });
    });

    it('static -> dynamic moves the size onto the first variant', () => {
        const category = staticGrid([button('a', 0, 5)], { rows: 2, columns: 3 });
        const dynamic = convertStaticGridToDynamic(category, { id: 'v1', name: 'First' });

        expect(readGridDimensions(dynamic.variants![0])).toEqual({ rows: 2, columns: 3 });
        expect(dynamic.variants![0]!.buttons.map((b) => b.slot)).toEqual([5]);
        // The size lives on the variant now, not in two places at once.
        expect(Object.prototype.hasOwnProperty.call(dynamic, 'rows')).toBe(false);
    });

    it('static -> dynamic keeps a legacy 4x4 a 4x4', () => {
        const category = staticGrid([button('a', 0, 15)]);
        const dynamic = convertStaticGridToDynamic(category, { id: 'v1', name: 'First' });

        expect(gridDimensionsOf(dynamic, 'v1')).toEqual({ rows: 4, columns: 4 });
        expect(resolveGridViewForVariant(dynamic, 'v1').slots[15]?.id).toBe('a');
    });

    it('a new variant starts at the size the category grid already has', () => {
        const category = dynamicGrid([variant('v1', [], { rows: 2, columns: 4 })]);
        const next = addVariant(category, { id: 'v2', name: 'V2', trigger: { all: [] } });
        expect(gridDimensionsOf(next, 'v2')).toEqual({ rows: 2, columns: 4 });
    });
});

describe('creating tools on a resized grid', () => {
    it('honours the pointed-at slot anywhere in the new grid', () => {
        const category = staticGrid([], { rows: 3, columns: 5 });
        const next = addButtonToGrid(category, null, button('new', 0), 14)!;
        expect(next.buttons[0]!.slot).toBe(14);
    });

    it('refuses a slot that does not exist on THIS grid and keeps the tool', () => {
        const category = staticGrid([], { rows: 1, columns: 3 });
        // Slot 9 exists on a 4x4 grid but not here: the tool lands on the
        // lowest free slot rather than being lost.
        const next = addButtonToGrid(category, null, button('new', 0), 9)!;
        expect(next.buttons[0]!.slot).toBe(0);
    });

    it('reports a full SMALL grid as full', () => {
        const category = staticGrid(fill(1, 3), { rows: 1, columns: 3 });
        expect(addButtonToGrid(category, null, button('new', 0), 0)).toBeNull();
    });

    it('drops a tool into a slot of a freshly added variant column', () => {
        const category = dynamicGrid([variant('v1', fill(1, 3), { rows: 1, columns: 3 })]);
        const grown = planGridResizeStep(category, 'v1', 'column', 1)!.category;
        const dropped = addButtonToGrid(grown, 'v1', button('dropped', 0), 3)!;

        expect(layout(resolveGridViewForVariant(dropped, 'v1').slots)).toEqual([
            'r0c0', 'r0c1', 'r0c2', 'dropped',
        ]);
    });
});

describe('drag state follows the grid size', () => {
    const sizes: Array<[number, number]> = [
        [1, 3],
        [2, 4],
        [3, 5],
    ];

    for (const [rows, columns] of sizes) {
        it(`sizes the drag state of a ${rows}x${columns} grid`, () => {
            const category = staticGrid(fill(rows, columns), { rows, columns });
            const views = new Map([
                [category.id, resolveGridViewForVariant(category, null)],
            ]);
            const items = buildButtonDragItems([category], views);

            expect(items[category.id]).toHaveLength(rows * columns);
            expect(
                getGridSlotButtonsFromAllCategories(category, [category], items)
            ).toHaveLength(rows * columns);
        });

        it(`moves and swaps inside a ${rows}x${columns} grid`, () => {
            const buttons = fill(rows, columns);
            // Free the last cell so a plain MOVE has a target.
            const moved = buttons.slice(0, -1);
            const category = staticGrid(moved, { rows, columns });
            const views = new Map([
                [category.id, resolveGridViewForVariant(category, null)],
            ]);
            const items = buildButtonDragItems([category], views);
            const layouts = buildContainerLayouts([category]);
            const last = rows * columns - 1;

            const afterMove = applyDragOverToItems(
                items,
                'r0c0',
                slotDroppableId(category.id, last),
                layouts
            );
            expect(afterMove[category.id]![last]).toBe('r0c0');
            expect(afterMove[category.id]![0]).toBeNull();
            expect(afterMove[category.id]).toHaveLength(rows * columns);

            if (rows * columns >= 2) {
                const afterSwap = applyDragOverToItems(
                    items,
                    'r0c0',
                    slotDroppableId(category.id, 1),
                    layouts
                );
                expect(afterSwap[category.id]![1]).toBe('r0c0');
                expect(afterSwap[category.id]![0]).toBe(
                    items[category.id]![1]
                );
            }
        });
    }

    it('writes a non-16 drag state back into exactly the edited variant', () => {
        const other = variant('v2', [button('x', 0, 0)], { rows: 2, columns: 2 });
        const category = dynamicGrid([
            variant('v1', [button('a', 0, 0), button('b', 1, 1)], { rows: 1, columns: 3 }),
            other,
        ]);
        const buttonsById = new Map<string, ButtonConfig>([
            ['a', button('a', 0, 0)],
            ['b', button('b', 1, 1)],
        ]);

        const next = applySlotIdsToGridCategory(
            category,
            ['b', null, 'a'],
            buttonsById,
            'v1',
            new Set(['a', 'b'])
        );

        expect(next.variants![0]!.buttons.map((b) => [b.id, b.slot])).toEqual([
            ['b', 0],
            ['a', 2],
        ]);
        expect(readGridDimensions(next.variants![0])).toEqual({ rows: 1, columns: 3 });
        expect(next.variants![1]).toBe(other);
    });
});
