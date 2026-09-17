import { describe, expect, it } from 'vitest';
import type {
    ButtonConfig,
    CategoryConfig,
    CategoryVariant,
    StoredCategory,
    StoredVariant,
    ToolPlacement,
    ToolRegistry,
} from '@/types/settings';
import {
    gridDimensionsOf,
    resolveGridViewForContext,
    resolveGridViewForVariant,
    updateVariant,
} from '@/utils/categoryVariants';
import {
    applyResizeSteps,
    readGridDimensions,
    type GridResizeDirection,
    type GridResizeEdge,
} from '@/utils/categoryGrid';
import {
    applySlotIdsToStoredCategory,
    createToolInCategory,
    duplicateCategoryInState,
    duplicateVariantInState,
    addVariantToCategory,
    convertStoredStaticGridToDynamic,
    planStoredGridResize,
    type StoredGridResizePlan,
} from '@/domain/categoryOps';
import { materializeCategory } from '@/domain/tools';
import {
    applyDragOverToItems,
    buildButtonDragItems,
    buildContainerLayouts,
    getGridSlotButtonsFromAllCategories,
    slotDroppableId,
} from '@/utils/buttonDragItems';
import type { WorkspaceContextSnapshot } from '@/context/workspaceContext';
import { p, registryOf, stateOf, storedGrid, storedVariant, tool } from './helpers/stored';

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

/** Buttons filling a rows x columns grid, named by their cell (view shape). */
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

/** Placements + registry filling a rows x columns grid (stored shape). */
function storedFill(
    rows: number,
    columns: number
): { placements: ToolPlacement[]; tools: ToolRegistry } {
    const placements: ToolPlacement[] = [];
    const defs = [];
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const slot = row * columns + column;
            placements.push(p(`r${row}c${column}`, slot));
            defs.push(tool(`r${row}c${column}`));
        }
    }
    return { placements, tools: registryOf(...defs) };
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

function storedDynamicGrid(variants: StoredVariant[]): StoredCategory {
    return { id: 'cat', name: 'Cat', order: 0, layout: 'grid', placements: [], variants };
}

const context: WorkspaceContextSnapshot = {
    hasActiveFile: false,
    filePath: null,
    fileName: null,
    fileExtension: null,
    folderPath: null,
    frontmatter: {},
    tags: [],
    viewType: null,
} as unknown as WorkspaceContextSnapshot;

/** Slot -> button id of a resolved view, for readable assertions. */
function layout(slots: (ButtonConfig | null)[]): (string | null)[] {
    return slots.map((b) => b?.id ?? null);
}

/** One stepper step, expressed through the same plan core the UI uses. */
function planStep(
    category: StoredCategory,
    variantId: string | null,
    edge: GridResizeEdge,
    direction: GridResizeDirection,
    tools: ToolRegistry
): StoredGridResizePlan | null {
    const next = applyResizeSteps(gridDimensionsOf(category, variantId), edge, direction);
    return planStoredGridResize(category, variantId, next, tools);
}

/** Resolved view of a stored category (what the renderer would show). */
function viewOf(category: StoredCategory, tools: ToolRegistry, variantId: string | null) {
    return resolveGridViewForVariant(materializeCategory(category, tools), variantId);
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

describe('resize step: growing keeps logical coordinates', () => {
    it('+ column widens every row instead of reflowing (2x3 -> 2x4)', () => {
        const { placements, tools } = storedFill(2, 3);
        const category = storedGrid(placements, { rows: 2, columns: 3 });
        const plan = planStep(category, null, 'column', 1, tools)!;

        expect(plan.to).toEqual({ rows: 2, columns: 4 });
        expect(plan.removedToolIds).toEqual([]);
        expect(layout(viewOf(plan.category, tools, null).slots)).toEqual([
            'r0c0', 'r0c1', 'r0c2', null,
            'r1c0', 'r1c1', 'r1c2', null,
        ]);
    });

    it('+ row appends a full empty row (2x4 -> 3x4)', () => {
        const { placements, tools } = storedFill(2, 4);
        const category = storedGrid(placements, { rows: 2, columns: 4 });
        const plan = planStep(category, null, 'row', 1, tools)!;

        expect(plan.to).toEqual({ rows: 3, columns: 4 });
        expect(plan.removedToolIds).toEqual([]);
        expect(layout(viewOf(plan.category, tools, null).slots)).toEqual([
            'r0c0', 'r0c1', 'r0c2', 'r0c3',
            'r1c0', 'r1c1', 'r1c2', 'r1c3',
            null, null, null, null,
        ]);
    });

    it('a full grid gains usable free slots from a resize', () => {
        const { placements, tools } = storedFill(1, 3);
        const category = storedGrid(placements, { rows: 1, columns: 3 });
        const grown = planStep(category, null, 'column', 1, tools)!.category;
        const withTool = createToolInCategory(
            stateOf(tools, grown),
            'cat',
            null,
            button('new', 99),
            3
        );

        expect(withTool).not.toBeNull();
        expect(
            layout(viewOf(withTool!.categories[0]!, withTool!.tools, null).slots)
        ).toEqual(['r0c0', 'r0c1', 'r0c2', 'new']);
    });
});

describe('resize step: shrinking removes exactly the outer stripe', () => {
    it('removes an EMPTY right column without reporting anything to confirm', () => {
        const tools = registryOf(tool('a'), tool('b'));
        const category = storedGrid([p('a', 0), p('b', 4)], { rows: 2, columns: 4 });
        const plan = planStep(category, null, 'column', -1, tools)!;

        expect(plan.removedToolIds).toEqual([]);
        expect(plan.to).toEqual({ rows: 2, columns: 3 });
        expect(layout(viewOf(plan.category, tools, null).slots)).toEqual([
            'a', null, null,
            'b', null, null,
        ]);
    });

    it('removes an EMPTY bottom row without reporting anything to confirm', () => {
        const tools = registryOf(tool('a'));
        const category = storedGrid([p('a', 1)], { rows: 3, columns: 3 });
        const plan = planStep(category, null, 'row', -1, tools)!;

        expect(plan.removedToolIds).toEqual([]);
        expect(plan.to).toEqual({ rows: 2, columns: 3 });
    });

    it('reports the tools of an OCCUPIED right column instead of dropping them silently', () => {
        const { placements, tools } = storedFill(2, 4);
        const category = storedGrid(placements, { rows: 2, columns: 4 });
        const plan = planStep(category, null, 'column', -1, tools)!;

        expect(plan.removedToolIds).toEqual(['r0c3', 'r1c3']);
        // Only that column goes; every other tool keeps its logical cell.
        expect(layout(viewOf(plan.category, tools, null).slots)).toEqual([
            'r0c0', 'r0c1', 'r0c2',
            'r1c0', 'r1c1', 'r1c2',
        ]);
    });

    it('reports the tools of an OCCUPIED bottom row', () => {
        const { placements, tools } = storedFill(3, 3);
        const category = storedGrid(placements, { rows: 3, columns: 3 });
        const plan = planStep(category, null, 'row', -1, tools)!;

        expect(plan.removedToolIds).toEqual(['r2c0', 'r2c1', 'r2c2']);
        expect(plan.category.placements.map((pl) => pl.toolId)).toEqual([
            'r0c0', 'r0c1', 'r0c2', 'r1c0', 'r1c1', 'r1c2',
        ]);
    });

    it('is a PLAN: cancelling leaves the source category completely untouched', () => {
        const { placements, tools } = storedFill(2, 4);
        const category = storedGrid(placements, { rows: 2, columns: 4 });
        const snapshot = JSON.parse(JSON.stringify(category)) as StoredCategory;

        const plan = planStep(category, null, 'column', -1, tools)!;
        expect(plan.removedToolIds).toHaveLength(2);
        // Nothing is committed until the caller stores `plan.category`.
        expect(category).toEqual(snapshot);
        expect(plan.category).not.toBe(category);
    });
});

describe('grid bounds', () => {
    const none: ToolRegistry = {};

    it('never grows past 5x5', () => {
        const category = storedGrid([], { rows: 5, columns: 5 });
        expect(planStep(category, null, 'row', 1, none)).toBeNull();
        expect(planStep(category, null, 'column', 1, none)).toBeNull();
    });

    it('never shrinks below 1x1', () => {
        const category = storedGrid([], { rows: 1, columns: 1 });
        expect(planStep(category, null, 'row', -1, none)).toBeNull();
        expect(planStep(category, null, 'column', -1, none)).toBeNull();
    });

    it('clamps an explicit out-of-range request instead of storing it', () => {
        const category = storedGrid([], { rows: 2, columns: 2 });
        const plan = planStoredGridResize(category, null, { rows: 99, columns: 0 }, none)!;
        expect(plan.to).toEqual({ rows: 5, columns: 1 });
        expect(readGridDimensions(plan.category)).toEqual({ rows: 5, columns: 1 });
    });

    it('reports no plan when the size does not actually change', () => {
        const category = storedGrid([], { rows: 2, columns: 2 });
        expect(
            planStoredGridResize(category, null, { rows: 2, columns: 2 }, none)
        ).toBeNull();
    });
});

describe('dimensions belong to the grid being edited', () => {
    it('resizing one variant leaves every other variant byte-identical', () => {
        const tools = registryOf(tool('a'), tool('x'));
        const other = storedVariant('v2', { all: [] }, [p('x', 0)], false, {
            rows: 2,
            columns: 2,
        });
        const fallback: StoredVariant = {
            id: 'fb',
            name: 'Default',
            fallback: true,
            rows: 1,
            columns: 1,
            placements: [],
        };
        const category = storedDynamicGrid([
            storedVariant('v1', { all: [] }, [p('a', 0)], false, { rows: 1, columns: 3 }),
            other,
            fallback,
        ]);

        const plan = planStep(category, 'v1', 'column', 1, tools)!;
        const variants = plan.category.variants!;

        expect(readGridDimensions(variants[0])).toEqual({ rows: 1, columns: 4 });
        expect(variants[1]).toBe(other);
        expect(variants[2]).toBe(fallback);
        expect(gridDimensionsOf(plan.category, 'v2')).toEqual({ rows: 2, columns: 2 });
        expect(gridDimensionsOf(plan.category, 'fb')).toEqual({ rows: 1, columns: 1 });
    });

    it('a resized variant persists and resolves at its own size', () => {
        const { placements, tools } = storedFill(2, 3);
        const category = storedDynamicGrid([
            storedVariant('v1', { all: [] }, placements, false, { rows: 2, columns: 3 }),
            storedVariant('v2', { all: [] }, [p('x', 0)], false, { rows: 4, columns: 4 }),
        ]);
        const allTools = { ...tools, ...registryOf(tool('x')) };
        const resized = planStep(category, 'v1', 'row', 1, allTools)!.category;

        // Round trip through JSON: this is what a plugin reload does.
        const reloaded = JSON.parse(JSON.stringify(resized)) as StoredCategory;
        expect(viewOf(reloaded, allTools, 'v1').dimensions).toEqual({
            rows: 3,
            columns: 3,
        });
        expect(viewOf(reloaded, allTools, 'v2').dimensions).toEqual({
            rows: 4,
            columns: 4,
        });
    });

    it('editing a variant name or trigger never resizes its grid', () => {
        const category = storedDynamicGrid([
            storedVariant('v1', { all: [] }, [], false, { rows: 2, columns: 5 }),
        ]);
        const updated = updateVariant(category, 'v1', {
            name: 'Renamed',
            trigger: { all: [] },
            fallback: false,
        });
        expect(gridDimensionsOf(updated, 'v1')).toEqual({ rows: 2, columns: 5 });
    });

    it('a legacy variant stays free of size fields when only renamed', () => {
        const category = storedDynamicGrid([
            { id: 'v1', name: 'V1', trigger: { all: [] }, placements: [] },
        ]);
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
        const state = stateOf(
            registryOf(tool('a')),
            storedDynamicGrid([
                storedVariant('v1', { all: [] }, [p('a', 4)], false, {
                    rows: 2,
                    columns: 5,
                }),
            ])
        );
        const next = duplicateVariantInState(
            state,
            'cat',
            'v1',
            { id: 'copy', name: 'Copy' },
            (i) => `btn${i}`
        );

        expect(gridDimensionsOf(next.categories[0]!, 'copy')).toEqual({
            rows: 2,
            columns: 5,
        });
        expect(next.categories[0]!.variants![1]!.placements.map((pl) => pl.slot)).toEqual([
            4,
        ]);
    });

    it('duplicating a category copies the size of the grid and of every variant', () => {
        let n = 0;
        const newId = () => `id-${(n += 1)}`;

        const staticState = stateOf(
            registryOf(tool('a')),
            storedGrid([p('a', 0)], { rows: 3, columns: 2 })
        );
        const staticCopy = duplicateCategoryInState(staticState, 'cat', 1, newId)!;
        expect(readGridDimensions(staticCopy.category)).toEqual({ rows: 3, columns: 2 });

        const dynamicState = stateOf(
            {},
            storedDynamicGrid([
                storedVariant('v1', { all: [] }, [], false, { rows: 1, columns: 3 }),
                storedVariant('v2', { all: [] }, [], false, { rows: 5, columns: 5 }),
            ])
        );
        const dynamicCopy = duplicateCategoryInState(dynamicState, 'cat', 1, newId)!;
        expect(readGridDimensions(dynamicCopy.category.variants![0])).toEqual({
            rows: 1,
            columns: 3,
        });
        expect(readGridDimensions(dynamicCopy.category.variants![1])).toEqual({
            rows: 5,
            columns: 5,
        });
    });

    it('static -> dynamic moves the size onto the first variant', () => {
        const category = storedGrid([p('a', 5)], { rows: 2, columns: 3 });
        const dynamic = convertStoredStaticGridToDynamic(category, {
            id: 'v1',
            name: 'First',
        });

        expect(readGridDimensions(dynamic.variants![0])).toEqual({ rows: 2, columns: 3 });
        expect(dynamic.variants![0]!.placements.map((pl) => pl.slot)).toEqual([5]);
        // The size lives on the variant now, not in two places at once.
        expect(Object.prototype.hasOwnProperty.call(dynamic, 'rows')).toBe(false);
    });

    it('static -> dynamic keeps a legacy 4x4 a 4x4', () => {
        const tools = registryOf(tool('a'));
        const category = storedGrid([p('a', 15)]);
        const dynamic = convertStoredStaticGridToDynamic(category, {
            id: 'v1',
            name: 'First',
        });

        expect(gridDimensionsOf(dynamic, 'v1')).toEqual({ rows: 4, columns: 4 });
        expect(viewOf(dynamic, tools, 'v1').slots[15]?.id).toBe('a');
    });

    it('a new variant starts at the size the category grid already has', () => {
        const category = storedDynamicGrid([
            storedVariant('v1', { all: [] }, [], false, { rows: 2, columns: 4 }),
        ]);
        const next = addVariantToCategory(category, {
            id: 'v2',
            name: 'V2',
            trigger: { all: [] },
        });
        expect(gridDimensionsOf(next, 'v2')).toEqual({ rows: 2, columns: 4 });
    });
});

describe('creating tools on a resized grid', () => {
    it('honours the pointed-at slot anywhere in the new grid', () => {
        const state = stateOf({}, storedGrid([], { rows: 3, columns: 5 }));
        const next = createToolInCategory(state, 'cat', null, button('new', 0), 14)!;
        expect(next.categories[0]!.placements).toEqual([p('new', 14)]);
    });

    it('refuses a slot that does not exist on THIS grid and keeps the tool', () => {
        const state = stateOf({}, storedGrid([], { rows: 1, columns: 3 }));
        // Slot 9 exists on a 4x4 grid but not here: the tool lands on the
        // lowest free slot rather than being lost.
        const next = createToolInCategory(state, 'cat', null, button('new', 0), 9)!;
        expect(next.categories[0]!.placements).toEqual([p('new', 0)]);
    });

    it('reports a full SMALL grid as full', () => {
        const { placements, tools } = storedFill(1, 3);
        const state = stateOf(tools, storedGrid(placements, { rows: 1, columns: 3 }));
        expect(createToolInCategory(state, 'cat', null, button('new', 0), 0)).toBeNull();
    });

    it('drops a tool into a slot of a freshly added variant column', () => {
        const { placements, tools } = storedFill(1, 3);
        const category = storedDynamicGrid([
            storedVariant('v1', { all: [] }, placements, false, { rows: 1, columns: 3 }),
        ]);
        const grown = planStep(category, 'v1', 'column', 1, tools)!.category;
        const dropped = createToolInCategory(
            stateOf(tools, grown),
            'cat',
            'v1',
            button('dropped', 0),
            3
        )!;

        expect(
            layout(viewOf(dropped.categories[0]!, dropped.tools, 'v1').slots)
        ).toEqual(['r0c0', 'r0c1', 'r0c2', 'dropped']);
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
        const tools = registryOf(tool('a'), tool('b'), tool('x'));
        const other = storedVariant('v2', { all: [] }, [p('x', 0)], false, {
            rows: 2,
            columns: 2,
        });
        const category = storedDynamicGrid([
            storedVariant('v1', { all: [] }, [p('a', 0), p('b', 1)], false, {
                rows: 1,
                columns: 3,
            }),
            other,
        ]);

        const next = applySlotIdsToStoredCategory(
            category,
            ['b', null, 'a'],
            tools,
            'v1',
            new Set(['a', 'b'])
        );

        expect(
            next.variants![0]!.placements.map((pl) => [pl.toolId, pl.slot])
        ).toEqual([
            ['b', 0],
            ['a', 2],
        ]);
        expect(readGridDimensions(next.variants![0])).toEqual({ rows: 1, columns: 3 });
        expect(next.variants![1]).toBe(other);
    });
});
