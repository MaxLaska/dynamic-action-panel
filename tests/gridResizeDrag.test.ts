import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig, CategoryVariant } from '@/types/settings';
import {
    RESIZE_DRAG_THRESHOLD_PX,
    applyResizeSteps,
    clampResizeSteps,
    isResizeDragGesture,
    readGridDimensions,
    resizeStepSize,
    snapResizeSteps,
    type GridDimensions,
    type GridResizeEdge,
} from '@/utils/categoryGrid';
import {
    gridDimensionsOf,
    planGridResize,
    previewResizedSlots,
    resolveGridViewForVariant,
} from '@/utils/categoryVariants';

/**
 * Notion-style drag resizing.
 *
 * The drag is an INTERACTION layer: it turns pointer pixels into whole
 * row/column steps and then hands the target size to the very same
 * `planGridResize` the stepper buttons use. Everything below therefore tests
 * either the pixel -> steps translation or that the shared core still owns the
 * data half.
 */

function button(id: string, order: number, slot?: number): ButtonConfig {
    const b: ButtonConfig = { id, name: id, actions: [], order };
    if (slot !== undefined) b.slot = slot;
    return b;
}

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
    dimensions: GridDimensions
): CategoryConfig {
    return {
        id: 'cat',
        name: 'Cat',
        order: 0,
        layout: 'grid',
        buttons,
        ...dimensions,
    };
}

function variant(
    id: string,
    buttons: ButtonConfig[],
    dimensions: GridDimensions
): CategoryVariant {
    return { id, name: id, trigger: { all: [] }, buttons, ...dimensions };
}

/**
 * Replay a pointer drag the way the hook does: one snapped, clamped step count
 * carried from move to move.
 */
function dragTo(
    start: GridDimensions,
    edge: GridResizeEdge,
    step: number,
    deltas: number[]
): { steps: number; dimensions: GridDimensions; dragging: boolean } {
    let steps = 0;
    let dragging = false;
    for (const delta of deltas) {
        dragging = isResizeDragGesture(delta, dragging);
        if (!dragging) continue;
        steps = clampResizeSteps(start, edge, snapResizeSteps(delta, step, steps));
    }
    return { steps, dimensions: applyResizeSteps(start, edge, steps), dragging };
}

const layout = (slots: (ButtonConfig | null)[]) => slots.map((b) => b?.id ?? null);

// ---------------------------------------------------------------------------

describe('pixels -> whole row/column steps', () => {
    it('derives the step size from the grid box and its gap', () => {
        // 4 columns of 54px with 4px gaps => 4*54 + 3*4 = 228
        expect(resizeStepSize(228, 4, 4)).toBe(58);
        // One column: the gap never applies inside, so the step is the cell.
        expect(resizeStepSize(100, 1, 4)).toBe(104);
        expect(resizeStepSize(0, 0, 4)).toBe(0);
    });

    it('snaps horizontally to whole columns', () => {
        const start = { rows: 1, columns: 3 };
        expect(dragTo(start, 'column', 50, [10, 30, 60]).dimensions).toEqual({
            rows: 1,
            columns: 4,
        });
        expect(dragTo(start, 'column', 50, [10, 60, 110]).dimensions).toEqual({
            rows: 1,
            columns: 5,
        });
    });

    it('snaps vertically to whole rows', () => {
        const start = { rows: 2, columns: 3 };
        expect(dragTo(start, 'row', 58, [10, 45]).dimensions).toEqual({
            rows: 3,
            columns: 3,
        });
        expect(dragTo(start, 'row', 58, [10, 45, 100, 160]).dimensions).toEqual({
            rows: 5,
            columns: 3,
        });
    });

    it('does not move on sub-threshold travel inside a cell', () => {
        const start = { rows: 1, columns: 3 };
        // 0.6 of a cell is past the half mark but below half + hysteresis.
        expect(dragTo(start, 'column', 50, [30]).dimensions).toEqual(start);
        // And it holds there instead of flickering back and forth.
        expect(dragTo(start, 'column', 50, [34, 30, 33, 29]).dimensions).toEqual(start);
    });

    it('holds the step while the pointer hovers a boundary (hysteresis)', () => {
        // Sitting at exactly one cell, jittering around 1.5 cells.
        const start = { rows: 1, columns: 2 };
        const jitter = [60, 74, 76, 73, 77, 74];
        expect(dragTo(start, 'column', 50, jitter).dimensions).toEqual({
            rows: 1,
            columns: 3,
        });
    });

    it('crosses several cells in one move rather than one step at a time', () => {
        const start = { rows: 1, columns: 1 };
        expect(dragTo(start, 'column', 50, [200]).steps).toBe(4);
    });

    it('returns to the starting size when the pointer comes back', () => {
        const start = { rows: 3, columns: 3 };
        const out = dragTo(start, 'column', 50, [120, 60, 5]);
        expect(out.dimensions).toEqual(start);
        expect(out.steps).toBe(0);
    });
});

describe('drag bounds', () => {
    it('never previews past 5 columns, and reacts at once on the way back', () => {
        const start = { rows: 2, columns: 4 };
        // Far past the maximum...
        expect(dragTo(start, 'column', 50, [500]).dimensions).toEqual({
            rows: 2,
            columns: 5,
        });
        // ...and coming back past the boundary shrinks it straight away,
        // because the STEPS are clamped too: the drag does not have to retrace
        // the 500px it was never allowed to use.
        expect(dragTo(start, 'column', 50, [500, 10]).dimensions).toEqual({
            rows: 2,
            columns: 4,
        });
        // Still beyond the grid's own right edge: nothing moves yet.
        expect(dragTo(start, 'column', 50, [500, 40]).dimensions).toEqual({
            rows: 2,
            columns: 5,
        });
    });

    it('never previews below 1 row / 1 column', () => {
        expect(
            dragTo({ rows: 3, columns: 3 }, 'row', 58, [-900]).dimensions
        ).toEqual({ rows: 1, columns: 3 });
        expect(
            dragTo({ rows: 3, columns: 3 }, 'column', 50, [-900]).dimensions
        ).toEqual({ rows: 3, columns: 1 });
    });

    it('clamps a single step request to the reachable range', () => {
        expect(clampResizeSteps({ rows: 5, columns: 5 }, 'column', 3)).toBe(0);
        expect(clampResizeSteps({ rows: 1, columns: 1 }, 'row', -3)).toBe(0);
        expect(clampResizeSteps({ rows: 2, columns: 2 }, 'column', 9)).toBe(3);
    });
});

describe('click versus drag', () => {
    it('treats travel below the threshold as a click', () => {
        expect(isResizeDragGesture(RESIZE_DRAG_THRESHOLD_PX - 1, false)).toBe(false);
        expect(isResizeDragGesture(-(RESIZE_DRAG_THRESHOLD_PX - 1), false)).toBe(false);
    });

    it('treats travel at or beyond the threshold as a drag', () => {
        expect(isResizeDragGesture(RESIZE_DRAG_THRESHOLD_PX, false)).toBe(true);
        expect(isResizeDragGesture(-40, false)).toBe(true);
    });

    it('latches: a drag that returns to the origin stays a drag', () => {
        // Otherwise releasing back at the start would ALSO fire the handle's
        // click action and add a column the user just dragged away.
        expect(isResizeDragGesture(0, true)).toBe(true);
        const out = dragTo({ rows: 1, columns: 3 }, 'column', 50, [120, 0]);
        expect(out.dragging).toBe(true);
        expect(out.dimensions).toEqual({ rows: 1, columns: 3 });
    });

    it('a click is exactly one step of the shared resize math', () => {
        expect(applyResizeSteps({ rows: 1, columns: 3 }, 'column', 1)).toEqual({
            rows: 1,
            columns: 4,
        });
        expect(applyResizeSteps({ rows: 2, columns: 3 }, 'row', 1)).toEqual({
            rows: 3,
            columns: 3,
        });
        // At the maximum a click cannot add anything.
        expect(applyResizeSteps({ rows: 5, columns: 5 }, 'column', 1)).toEqual({
            rows: 5,
            columns: 5,
        });
    });
});

describe('preview is read-only', () => {
    it('shows the resized grid without touching the source', () => {
        const category = staticGrid(fill(2, 3), { rows: 2, columns: 3 });
        const snapshot = JSON.parse(JSON.stringify(category)) as CategoryConfig;
        const view = resolveGridViewForVariant(category, null);

        expect(layout(previewResizedSlots(view, { rows: 2, columns: 4 }))).toEqual([
            'r0c0', 'r0c1', 'r0c2', null,
            'r1c0', 'r1c1', 'r1c2', null,
        ]);
        expect(category).toEqual(snapshot);
    });

    it('hides the tools a shrink would cut, but only visually', () => {
        const category = staticGrid(fill(2, 4), { rows: 2, columns: 4 });
        const view = resolveGridViewForVariant(category, null);

        expect(layout(previewResizedSlots(view, { rows: 2, columns: 3 }))).toEqual([
            'r0c0', 'r0c1', 'r0c2',
            'r1c0', 'r1c1', 'r1c2',
        ]);
        // The tools are still in the data — nothing was persisted.
        expect(category.buttons.map((b) => b.id)).toContain('r0c3');
        expect(category.buttons.map((b) => b.id)).toContain('r1c3');
    });

    it('previews exactly what the commit produces', () => {
        const category = staticGrid(fill(3, 4), { rows: 3, columns: 4 });
        const to = { rows: 3, columns: 2 };
        const preview = previewResizedSlots(resolveGridViewForVariant(category, null), to);
        const plan = planGridResize(category, null, to)!;
        expect(layout(preview)).toEqual(
            layout(resolveGridViewForVariant(plan.category, null).slots)
        );
    });
});

describe('committing a dragged size (same core as the buttons)', () => {
    it('commits a multi-column shrink as ONE plan', () => {
        const category = staticGrid(fill(2, 5), { rows: 2, columns: 5 });
        const plan = planGridResize(category, null, { rows: 2, columns: 2 })!;

        expect(plan.from).toEqual({ rows: 2, columns: 5 });
        expect(plan.to).toEqual({ rows: 2, columns: 2 });
        // Three columns disappear at once, six tools in total.
        expect(plan.removed.map((b) => b.id)).toEqual([
            'r0c2', 'r0c3', 'r0c4', 'r1c2', 'r1c3', 'r1c4',
        ]);
        expect(layout(resolveGridViewForVariant(plan.category, null).slots)).toEqual([
            'r0c0', 'r0c1',
            'r1c0', 'r1c1',
        ]);
    });

    it('commits a multi-row shrink as ONE plan', () => {
        const category = staticGrid(fill(5, 2), { rows: 5, columns: 2 });
        const plan = planGridResize(category, null, { rows: 2, columns: 2 })!;

        expect(plan.removed.map((b) => b.id)).toEqual([
            'r2c0', 'r2c1', 'r3c0', 'r3c1', 'r4c0', 'r4c1',
        ]);
        expect(plan.category.buttons.map((b) => b.id)).toEqual([
            'r0c0', 'r0c1', 'r1c0', 'r1c1',
        ]);
    });

    it('reports nothing to confirm when the cut stripes are empty', () => {
        const category = staticGrid([button('a', 0, 0)], { rows: 4, columns: 4 });
        const plan = planGridResize(category, null, { rows: 1, columns: 1 })!;
        expect(plan.removed).toEqual([]);
        expect(plan.category.buttons.map((b) => [b.id, b.slot])).toEqual([['a', 0]]);
    });

    it('cancelling changes nothing, because the plan is never stored', () => {
        const category = staticGrid(fill(3, 3), { rows: 3, columns: 3 });
        const snapshot = JSON.parse(JSON.stringify(category)) as CategoryConfig;

        const plan = planGridResize(category, null, { rows: 1, columns: 1 })!;
        expect(plan.removed).toHaveLength(8);
        // The caller simply drops `plan.category` on Cancel.
        expect(category).toEqual(snapshot);
        expect(readGridDimensions(category)).toEqual({ rows: 3, columns: 3 });
    });

    it('confirming commits exactly the dragged size', () => {
        const category = staticGrid(fill(3, 3), { rows: 3, columns: 3 });
        const plan = planGridResize(category, null, { rows: 1, columns: 2 })!;
        expect(readGridDimensions(plan.category)).toEqual({ rows: 1, columns: 2 });
        expect(layout(resolveGridViewForVariant(plan.category, null).slots)).toEqual([
            'r0c0', 'r0c1',
        ]);
    });

    it('a dragged size lands only on the edited variant', () => {
        const other = variant('v2', [button('x', 0, 0)], { rows: 4, columns: 4 });
        const category: CategoryConfig = {
            id: 'cat',
            name: 'Cat',
            order: 0,
            layout: 'grid',
            buttons: [],
            variants: [variant('v1', fill(2, 3), { rows: 2, columns: 3 }), other],
        };

        const plan = planGridResize(category, 'v1', { rows: 2, columns: 5 })!;
        expect(gridDimensionsOf(plan.category, 'v1')).toEqual({ rows: 2, columns: 5 });
        expect(plan.category.variants![1]).toBe(other);
        expect(gridDimensionsOf(plan.category, 'v2')).toEqual({ rows: 4, columns: 4 });
    });
});
