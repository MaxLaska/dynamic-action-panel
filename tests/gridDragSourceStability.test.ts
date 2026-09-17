// Source-slot stability during a grid drag (2026-09-17).
//
// Live root cause: between any two cells the pointer crosses the 4px gap, and
// there the only droppable containing it is the category container zone. A
// container/title/tab target carries no addressable cell, and
// `applyDragOverToItems` signals "nothing to do" by returning its input —
// which during a drag IS the drag-start baseline. Applying that return value
// as the next preview put the dragged tool back on its source slot for a
// frame or two, so the grid flickered while the pointer moved from one target
// to the next.
//
// The fix classifies the target with `resolveGridDropOutcome` first and only
// applies a preview for a target that names a cell. These tests pin that
// classification and the trap behind it.

import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig } from '@/types/settings';
import {
    applyDragOverToItems,
    buildButtonDragItems,
    buildContainerLayouts,
    containerDroppableId,
    resolveGridDropOutcome,
    slotDroppableId,
    tabDroppableId,
    titleDroppableId,
} from '@/utils/buttonDragItems';

function button(id: string, order: number, slot?: number): ButtonConfig {
    const b: ButtonConfig = { id, name: id, actions: [], order };
    if (slot !== undefined) b.slot = slot;
    return b;
}

const GRID: CategoryConfig = {
    id: 'g',
    name: 'Grid',
    order: 0,
    layout: 'grid',
    buttons: [button('src', 0, 0), button('other', 1, 5)],
};
const FLOW: CategoryConfig = {
    id: 'f',
    name: 'Flow',
    order: 1,
    buttons: [button('f1', 0)],
};

const categories = [GRID, FLOW];
const layouts = buildContainerLayouts(categories);
/** Drag-start baseline: 'src' still sits on its source slot 0. */
const baseline = buildButtonDragItems(categories);

describe('targets without an addressable cell', () => {
    const noCellTargets = [
        containerDroppableId('g'),
        titleDroppableId('g'),
        tabDroppableId('g'),
    ];

    it.each(noCellTargets)('%s is classified as no-cell', (overId) => {
        expect(resolveGridDropOutcome(baseline, 'src', overId, layouts)).toBe('no-cell');
    });

    it.each(noCellTargets)(
        'recomputing %s from the baseline hands the source slot back',
        (overId) => {
            // This is the trap: the call reports "no change" by returning its
            // input, and the input is the drag-start baseline. A caller that
            // treats the result as the next preview therefore restores the
            // dragged tool to its source slot mid-drag.
            const next = applyDragOverToItems(baseline, 'src', overId, layouts);
            expect(next).toBe(baseline);
            expect(next['g']![0]).toBe('src');
        }
    );
});

describe('every grid cell stays addressable', () => {
    it('an empty cell accepts', () => {
        expect(
            resolveGridDropOutcome(baseline, 'src', slotDroppableId('g', 9), layouts)
        ).toBe('accept');
    });

    it('an occupied cell accepts (swap)', () => {
        expect(
            resolveGridDropOutcome(baseline, 'src', slotDroppableId('g', 5), layouts)
        ).toBe('accept');
    });

    it('the button on an occupied cell accepts (swap)', () => {
        expect(resolveGridDropOutcome(baseline, 'src', 'other', layouts)).toBe('accept');
    });

    it('an accepted cell really vacates the source slot', () => {
        const next = applyDragOverToItems(
            baseline,
            'src',
            slotDroppableId('g', 9),
            layouts
        );
        expect(next['g']![0]).toBeNull();
        expect(next['g']![9]).toBe('src');
    });
});

describe('flow containers are unaffected by the classification', () => {
    it('a flow container zone still accepts (append to the end)', () => {
        expect(
            resolveGridDropOutcome(baseline, 'src', containerDroppableId('f'), layouts)
        ).toBe('accept');
        const next = applyDragOverToItems(
            baseline,
            'src',
            containerDroppableId('f'),
            layouts
        );
        expect(next['f']).toEqual(['f1', 'src']);
        // Leaving a grid leaves a hole behind, it never collapses the grid.
        expect(next['g']![0]).toBeNull();
    });

    it('a flow tool aimed at an occupied cell stays blocked', () => {
        expect(
            resolveGridDropOutcome(baseline, 'f1', slotDroppableId('g', 0), layouts)
        ).toBe('blocked');
    });
});
