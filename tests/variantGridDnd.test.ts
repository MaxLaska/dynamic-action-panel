// Variant-grid DnD robustness (2026-09-17 polish round).
//
// Live root cause fixed in this round: empty-slot droppables used to mount
// and unmount per variant switch, so a drag started right after a switch
// could race their registration/measurement — the drop fell through to the
// container zone and was silently ignored. Every grid cell is now a
// PERMANENT droppable (filled or empty), keyed by its slot, so the 16 cell
// nodes and their dnd-kit registrations survive every variant switch.
//
// These tests pin down the pure semantics that model relies on:
// - a slot droppable id over an OCCUPIED cell behaves exactly like hovering
//   the button (move/swap; flow -> occupied refused);
// - the collision ranking prefers the button over its own cell, and the cell
//   over every area zone, so the whole cell is a drop target;
// - variant switching (A -> B -> A) always rebuilds the exact drag state of
//   the on-screen variant, duplicates stay id-disjoint, and the quick A/B
//   selection state can never point at a deleted variant.

import { describe, expect, it } from 'vitest';
import type { ClientRect } from '@dnd-kit/core';
import type { ButtonConfig, CategoryConfig, CategoryVariant } from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import type { OCAPContextSnapshot } from '@/context/OCAPContext';
import {
    applyDragOverToItems,
    buildButtonDragItems,
    buildContainerLayouts,
    resolveGridDropOutcome,
    slotDroppableId,
    type ButtonDragItems,
} from '@/utils/buttonDragItems';
import { buttonDragCollisionDetection } from '@/utils/buttonDragCollision';
import { resolveGridViewForVariant } from '@/utils/categoryVariants';
import { duplicateVariantInState } from '@/domain/categoryOps';
import { materializeCategoriesForRuntime } from '@/domain/tools';
import { p, registryOf, stateOf, storedVariant, tool } from './helpers/stored';
import {
    selectedVariantOf,
    type VariantSelectionState,
} from '@/contexts/CategoryVariantContext';

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

const IN_NOTES: ButtonCondition = { rule: 'folder', op: 'startsWith', value: 'notes' };
const IN_OTHER: ButtonCondition = { rule: 'folder', op: 'startsWith', value: 'other' };

function button(id: string, order: number, slot?: number): ButtonConfig {
    const b: ButtonConfig = { id, name: id, actions: [], order };
    if (slot !== undefined) b.slot = slot;
    return b;
}

function variant(
    id: string,
    trigger: ButtonCondition | undefined,
    buttons: ButtonConfig[],
    fallback = false
): CategoryVariant {
    const v: CategoryVariant = { id, name: id, buttons };
    if (fallback) v.fallback = true;
    else if (trigger) v.trigger = trigger;
    return v;
}

function makeDynamic(): CategoryConfig {
    return {
        id: 'dyn',
        name: 'Dyn',
        order: 0,
        layout: 'grid',
        buttons: [],
        variants: [
            variant('va', IN_NOTES, [button('a1', 0, 0), button('a2', 1, 1)]),
            variant('vb', IN_OTHER, [button('b1', 0, 0), button('b2', 1, 3)]),
            variant('vz', undefined, [button('z1', 0, 2)], true),
        ],
    };
}

function itemsFor(
    categories: CategoryConfig[],
    selected: Record<string, string>
): ButtonDragItems {
    const gridViews = new Map(
        categories
            .filter((c) => c.layout === 'grid')
            .map((c) => [c.id, resolveGridViewForVariant(c, selected[c.id] ?? null)])
    );
    return buildButtonDragItems(categories, gridViews);
}

// ---------------------------------------------------------------------------
// Slot droppables on occupied cells (every cell is a droppable now)

describe('slot droppable over an occupied cell', () => {
    const dyn = makeDynamic();
    const flow: CategoryConfig = {
        id: 'flow',
        name: 'Flow',
        order: 1,
        buttons: [button('f1', 0)],
    };
    const categories = [dyn, flow];
    const layouts = buildContainerLayouts(categories);
    const items = itemsFor(categories, { dyn: 'va' });

    it('within one grid: dropping on the occupied cell id swaps', () => {
        const next = applyDragOverToItems(
            items,
            'a1',
            slotDroppableId('dyn', 1),
            layouts
        );
        expect(next['dyn']![1]).toBe('a1');
        expect(next['dyn']![0]).toBe('a2');
    });

    it('release classification accepts an occupied cell for a grid tool', () => {
        expect(
            resolveGridDropOutcome(items, 'a1', slotDroppableId('dyn', 1), layouts)
        ).toBe('accept');
    });

    it('flow -> occupied cell id is refused (blocked), empty cell accepted', () => {
        expect(
            resolveGridDropOutcome(items, 'f1', slotDroppableId('dyn', 1), layouts)
        ).toBe('blocked');
        expect(
            resolveGridDropOutcome(items, 'f1', slotDroppableId('dyn', 4), layouts)
        ).toBe('accept');
    });
});

// ---------------------------------------------------------------------------
// Collision ranking: the whole cell is a target, the button stays preferred

function rect(left: number, top: number, width: number, height: number): ClientRect {
    return { left, top, width, height, right: left + width, bottom: top + height };
}

function collisionArgs(
    droppables: Record<string, ClientRect>,
    pointer: { x: number; y: number }
) {
    const droppableContainers = Object.keys(droppables).map((id) => ({
        id,
        disabled: false,
    }));
    return {
        active: { id: 'a1' },
        collisionRect: rect(pointer.x, pointer.y, 1, 1),
        droppableRects: new Map(Object.entries(droppables)),
        droppableContainers,
        pointerCoordinates: pointer,
    } as unknown as Parameters<typeof buttonDragCollisionDetection>[0];
}

describe('collision ranking on grid cells', () => {
    // one cell (the slot droppable) containing a smaller button droppable,
    // both inside the category container zone
    const cell = rect(100, 100, 90, 56);
    const buttonRect = rect(110, 105, 70, 46);
    const containerRect = rect(0, 0, 400, 400);

    it('pointer over the button prefers the button over its own cell', () => {
        const hits = buttonDragCollisionDetection(
            collisionArgs(
                {
                    'container:dyn': containerRect,
                    [slotDroppableId('dyn', 1)]: cell,
                    b9: buttonRect,
                },
                { x: 120, y: 120 }
            )
        );
        expect(hits.map((h) => String(h.id))).toEqual(['b9']);
    });

    it('pointer in the cell padding (outside the button) hits the cell', () => {
        const hits = buttonDragCollisionDetection(
            collisionArgs(
                {
                    'container:dyn': containerRect,
                    [slotDroppableId('dyn', 1)]: cell,
                    b9: buttonRect,
                },
                { x: 102, y: 102 }
            )
        );
        expect(hits.map((h) => String(h.id))).toEqual([slotDroppableId('dyn', 1)]);
    });

    it('a cell outranks the container zone', () => {
        const hits = buttonDragCollisionDetection(
            collisionArgs(
                {
                    'container:dyn': containerRect,
                    [slotDroppableId('dyn', 4)]: cell,
                },
                { x: 105, y: 110 }
            )
        );
        expect(hits.map((h) => String(h.id))).toEqual([slotDroppableId('dyn', 4)]);
    });

    it('the active draggable itself never counts as a hit', () => {
        const hits = buttonDragCollisionDetection(
            collisionArgs(
                {
                    'container:dyn': containerRect,
                    [slotDroppableId('dyn', 1)]: cell,
                    a1: buttonRect,
                },
                { x: 120, y: 120 }
            )
        );
        expect(hits.map((h) => String(h.id))).toEqual([slotDroppableId('dyn', 1)]);
    });
});

// ---------------------------------------------------------------------------
// Variant switching rebuilds exact drag state; duplicates stay disjoint

describe('variant switches and the drag state', () => {
    it('A -> B -> A reproduces the exact original state', () => {
        const categories = [makeDynamic()];
        const a1 = itemsFor(categories, { dyn: 'va' });
        const b = itemsFor(categories, { dyn: 'vb' });
        const a2 = itemsFor(categories, { dyn: 'va' });
        expect(b['dyn']![0]).toBe('b1');
        expect(b['dyn']![3]).toBe('b2');
        expect(a2['dyn']).toEqual(a1['dyn']);
    });

    it('a switch never carries a foreign variant tool into the state', () => {
        const items = itemsFor([makeDynamic()], { dyn: 'vb' });
        const ids = items['dyn']!.filter((id) => id !== null);
        expect(ids.every((id) => id.startsWith('b'))).toBe(true);
    });

    it('a duplicated variant is id-disjoint from its source but slot-identical', () => {
        // v5: the duplicate op works on the stored shape + registry.
        const stored = {
            id: 'dyn',
            name: 'Dyn',
            order: 0,
            layout: 'grid' as const,
            placements: [],
            variants: [
                storedVariant('va', IN_NOTES, [p('a1', 0), p('a2', 1)]),
                storedVariant('vb', IN_OTHER, [p('b1', 0), p('b2', 3)]),
            ],
        };
        const state = stateOf(
            registryOf(tool('a1'), tool('a2'), tool('b1'), tool('b2')),
            stored
        );
        const next = duplicateVariantInState(
            state,
            'dyn',
            'va',
            { id: 'va-copy', name: 'va copy', trigger: IN_NOTES },
            (index) => `copy-btn-${index}`
        );
        const withCopy = materializeCategoriesForRuntime(
            next.categories,
            next.tools
        )[0]!;
        const copy = withCopy.variants!.find((v) => v.id === 'va-copy')!;
        const source = itemsFor([withCopy], { dyn: 'va' });
        const dup = itemsFor([withCopy], { dyn: copy.id });
        const sourceIds = new Set(source['dyn']!.filter((id) => id !== null));
        const dupIds = dup['dyn']!.filter((id) => id !== null);
        expect(dupIds.length).toBe(sourceIds.size);
        expect(dupIds.some((id) => sourceIds.has(id))).toBe(false);
        // same occupied slots
        expect(dup['dyn']!.map((id) => id !== null)).toEqual(
            source['dyn']!.map((id) => id !== null)
        );
    });
});

// ---------------------------------------------------------------------------
// Quick A/B selection state (the ⇄ flip): normalization invariants

describe('selectedVariantOf: quick-switch selection state', () => {
    const cat = makeDynamic();
    const inNotes = context(); // matches va's trigger
    const nowhere = context({ folderPath: 'elsewhere', filePath: 'elsewhere/x.md' });

    it('an explicit pick that exists wins', () => {
        const selection: VariantSelectionState = {
            dyn: { current: 'vb', previous: 'va' },
        };
        expect(selectedVariantOf(cat, selection, inNotes)).toEqual({
            current: 'vb',
            previous: 'va',
        });
    });

    it('without a pick the runtime-active variant is preselected', () => {
        expect(selectedVariantOf(cat, {}, inNotes)).toEqual({
            current: 'va',
            previous: null,
        });
        // nothing matches -> fallback variant
        expect(selectedVariantOf(cat, {}, nowhere)).toEqual({
            current: 'vz',
            previous: null,
        });
    });

    it('a pick pointing at a deleted variant falls back to the runtime variant', () => {
        const selection: VariantSelectionState = {
            dyn: { current: 'gone', previous: 'va' },
        };
        const entry = selectedVariantOf(cat, selection, inNotes);
        expect(entry!.current).toBe('va');
    });

    it('a deleted previous target is dropped, never offered as flip target', () => {
        const selection: VariantSelectionState = {
            dyn: { current: 'vb', previous: 'gone' },
        };
        expect(selectedVariantOf(cat, selection, inNotes)).toEqual({
            current: 'vb',
            previous: null,
        });
    });

    it('previous equal to current is dropped', () => {
        const selection: VariantSelectionState = {
            dyn: { current: 'vb', previous: 'vb' },
        };
        expect(selectedVariantOf(cat, selection, inNotes)).toEqual({
            current: 'vb',
            previous: null,
        });
    });

    it('a non-dynamic category has no selection', () => {
        const flow: CategoryConfig = {
            id: 'flow',
            name: 'Flow',
            order: 1,
            buttons: [button('f1', 0)],
        };
        expect(selectedVariantOf(flow, {}, inNotes)).toBeNull();
    });
});
