// DnD against dynamic category variants.
//
// The drag state mirrors exactly the ONE grid on screen (the selected
// variant), so a drag in "Source" can never see, let alone move, "Topic".
// These tests drive the real pieces the provider uses: buildButtonDragItems
// (from the resolved grid view), applyDragOverToItems / moveIdToSlotWithinGrid
// (live drag semantics), resolveGridDropOutcome (release classification) and
// applySlotIdsToGridCategory (write-back).

import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig, CategoryVariant } from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import {
    applyDragOverToItems,
    buildButtonDragItems,
    buildContainerLayouts,
    resolveGridDropOutcome,
    slotDroppableId,
    type ButtonDragItems,
} from '@/utils/buttonDragItems';
import { findVariant, resolveGridViewForVariant } from '@/utils/categoryVariants';
import { applySlotIdsToStoredCategory } from '@/domain/categoryOps';
import { materializeCategory } from '@/domain/tools';
import type { StoredCategory, ToolRegistry } from '@/types/settings';
import { p, registryOf, storedVariant, tool } from './helpers/stored';

const SOURCE: ButtonCondition = { rule: 'property', op: 'equals', key: 'type', value: 'Source' };
const TOPIC: ButtonCondition = { rule: 'property', op: 'equals', key: 'type', value: 'Topic' };

function button(id: string, order: number, slot?: number): ButtonConfig {
    const b: ButtonConfig = { id, name: id, actions: [], order };
    if (slot !== undefined) b.slot = slot;
    return b;
}

function variant(
    id: string,
    trigger: ButtonCondition,
    buttons: ButtonConfig[]
): CategoryVariant {
    return { id, name: id, trigger, buttons };
}

function makeDynamic(): CategoryConfig {
    return {
        id: 'dyn',
        name: 'Node Tools',
        order: 0,
        layout: 'grid',
        buttons: [],
        variants: [
            variant('source', SOURCE, [button('s1', 0, 0), button('s2', 1, 1)]),
            variant('topic', TOPIC, [button('t1', 0, 0), button('t2', 1, 5)]),
        ],
    };
}

function makeFlow(): CategoryConfig {
    return {
        id: 'flow',
        name: 'Flow',
        order: 1,
        buttons: [button('f1', 0), button('f2', 1)],
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

describe('drag state mirrors the selected variant', () => {
    it('contains only the on-screen variant of a dynamic category', () => {
        const items = itemsFor([makeDynamic(), makeFlow()], { dyn: 'source' });
        expect(items['dyn']).toHaveLength(16);
        expect(items['dyn']![0]).toBe('s1');
        expect(items['dyn']![1]).toBe('s2');
        expect(items['dyn']!.includes('t1')).toBe(false);
        expect(items['flow']).toEqual(['f1', 'f2']);
    });

    it('switching the selection switches the drag state', () => {
        const items = itemsFor([makeDynamic()], { dyn: 'topic' });
        expect(items['dyn']![0]).toBe('t1');
        expect(items['dyn']![5]).toBe('t2');
        expect(items['dyn']!.includes('s1')).toBe(false);
    });
});

describe('drags inside one variant', () => {
    const categories = [makeDynamic(), makeFlow()];
    const layouts = buildContainerLayouts(categories);

    it('moves onto an empty slot and leaves a hole', () => {
        const items = itemsFor(categories, { dyn: 'source' });
        const next = applyDragOverToItems(items, 's1', slotDroppableId('dyn', 7), layouts);
        expect(next['dyn']![7]).toBe('s1');
        expect(next['dyn']![0]).toBeNull();
        expect(next['dyn']![1]).toBe('s2');
    });

    it('swaps with an occupied slot', () => {
        const items = itemsFor(categories, { dyn: 'source' });
        const next = applyDragOverToItems(items, 's1', 's2', layouts);
        expect(next['dyn']![0]).toBe('s2');
        expect(next['dyn']![1]).toBe('s1');
    });

    it('write-back changes only the dragged variant; the other stays identical', () => {
        const { stored, tools } = makeStoredDynamic();
        const view = materializeCategory(stored, tools);
        const items = itemsFor([view], { dyn: 'source' });
        const dragged = applyDragOverToItems(
            items,
            's1',
            slotDroppableId('dyn', 7),
            buildContainerLayouts([view])
        );
        const next = applySlotIdsToStoredCategory(
            stored,
            dragged['dyn']!,
            tools,
            'source',
            new Set(dragged['dyn']!.filter((id): id is string => id !== null))
        );
        expect(
            findVariant(next, 'source')!
                .placements.map((placement) => [placement.toolId, placement.slot])
                .sort()
        ).toEqual([
            ['s1', 7],
            ['s2', 1],
        ]);
        // Topic is untouched, identity included.
        expect(findVariant(next, 'topic')).toBe(findVariant(stored, 'topic'));
    });
});

/** The stored (v5) twin of makeDynamic, plus its registry. */
function makeStoredDynamic(): { stored: StoredCategory; tools: ToolRegistry } {
    return {
        stored: {
            id: 'dyn',
            name: 'Node Tools',
            order: 0,
            layout: 'grid',
            placements: [],
            variants: [
                storedVariant('source', SOURCE, [p('s1', 0), p('s2', 1)]),
                storedVariant('topic', TOPIC, [p('t1', 0), p('t2', 5)]),
            ],
        },
        tools: registryOf(tool('s1'), tool('s2'), tool('t1'), tool('t2'), tool('f1')),
    };
}

describe('flow <-> grid interaction under variants', () => {
    const categories = [makeDynamic(), makeFlow()];
    const layouts = buildContainerLayouts(categories);

    it('flow -> occupied slot is refused (blocked outcome, state unchanged)', () => {
        const items = itemsFor(categories, { dyn: 'source' });
        expect(resolveGridDropOutcome(items, 'f1', 's1', layouts)).toBe('blocked');
        expect(applyDragOverToItems(items, 'f1', 's1', layouts)).toBe(items);
    });

    it('flow -> empty slot is accepted and lands in the selected variant on write-back', () => {
        const items = itemsFor(categories, { dyn: 'source' });
        const target = slotDroppableId('dyn', 9);
        expect(resolveGridDropOutcome(items, 'f1', target, layouts)).toBe('accept');
        const dragged = applyDragOverToItems(items, 'f1', target, layouts);
        expect(dragged['dyn']![9]).toBe('f1');
        expect(dragged['flow']).toEqual(['f2']);

        const { stored, tools } = makeStoredDynamic();
        const claimed = new Set<string>();
        for (const ids of Object.values(dragged)) {
            for (const id of ids) if (id !== null) claimed.add(id);
        }
        const next = applySlotIdsToStoredCategory(
            stored,
            dragged['dyn']!,
            tools,
            'source',
            claimed
        );
        const sourcePlacements = findVariant(next, 'source')!.placements;
        expect(
            sourcePlacements.find((placement) => placement.toolId === 'f1')!.slot
        ).toBe(9);
        expect(findVariant(next, 'topic')).toBe(findVariant(stored, 'topic'));
    });

    it('an area zone over a grid resolves to no-cell', () => {
        const items = itemsFor(categories, { dyn: 'source' });
        expect(resolveGridDropOutcome(items, 'f1', 'container:dyn', layouts)).toBe('no-cell');
    });
});

describe('persistence round-trip', () => {
    it('reloading the written category reproduces the same grid', () => {
        const { stored, tools } = makeStoredDynamic();
        const viewCategory = materializeCategory(stored, tools);
        const items = itemsFor([viewCategory], { dyn: 'topic' });
        const dragged = applyDragOverToItems(
            items,
            't2',
            slotDroppableId('dyn', 15),
            buildContainerLayouts([viewCategory])
        );
        const next = applySlotIdsToStoredCategory(
            stored,
            dragged['dyn']!,
            tools,
            'topic',
            new Set(dragged['dyn']!.filter((id): id is string => id !== null))
        );
        const reloaded = JSON.parse(JSON.stringify(next)) as StoredCategory;
        const view = resolveGridViewForVariant(
            materializeCategory(reloaded, tools),
            'topic'
        );
        expect(view.slots[15]?.id).toBe('t2');
        expect(view.slots[0]?.id).toBe('t1');
        expect(view.slots[5]).toBeNull();
    });
});
