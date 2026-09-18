// The v5 write operations: tool registry + placements + the GC lifecycle.
//
// Guarantees under test (audit F1/F2 + task A.5/A.6):
// - create/copy register a definition AND a placement in one step;
// - edit changes only the definition (every placement shows it);
// - copy/duplicate NEVER share definitions (fresh ids, deep copies);
// - a move/swap rewrites placements only — the registry is untouched and a
//   cross-category move can never lose a definition;
// - GC runs ONLY in explicit remove/delete operations: a non-library tool
//   disappears with its last placement, a library tool survives with zero
//   placements, a tool still placed elsewhere survives any single removal;
// - resize cuts exactly the outer stripe's placements and collects exactly
//   the cut tools (library-protected).

import { describe, expect, it } from 'vitest';
import type { StoredCategory } from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import {
    addVariantToCategory,
    applyFlowIdsToStoredCategory,
    applySlotIdsToStoredCategory,
    applyStoredCategoryLayout,
    commitStoredGridResize,
    convertStoredStaticGridToDynamic,
    copyToolInCategory,
    createToolInCategory,
    deleteCategoryFromState,
    duplicateCategoryInState,
    duplicateVariantInState,
    planStoredGridResize,
    removeToolFromCategory,
    removeVariantFromState,
    updateToolDefinition,
    type ToolState,
} from '@/domain/categoryOps';
import {
    collectReferencedToolIds,
    findToolVariantId,
    gcTools,
    materializeButtons,
    materializeCategory,
} from '@/domain/tools';
import { findVariant, getCategoryVariants } from '@/utils/categoryVariants';
import {
    p,
    registryOf,
    stateOf,
    storedDynamic,
    storedFlow,
    storedGrid,
    storedVariant,
    tool,
} from './helpers/stored';

const SOURCE: ButtonCondition = { rule: 'property', op: 'equals', key: 'type', value: 'Source' };
const TOPIC: ButtonCondition = { rule: 'property', op: 'equals', key: 'type', value: 'Topic' };

function draft(id: string, name = id) {
    return { id, name, actions: [], order: 0 };
}

function snapshot(state: ToolState): unknown {
    return JSON.parse(JSON.stringify(state));
}

describe('createToolInCategory', () => {
    it('registers the definition and places it in the pointed-at grid slot', () => {
        const state = stateOf(registryOf(tool('a')), storedGrid([p('a', 0)]));
        const next = createToolInCategory(state, 'cat', null, draft('new'), 5)!;
        expect(next.tools['new']).toMatchObject({ id: 'new', name: 'new' });
        expect(next.categories[0]!.placements).toEqual([p('a', 0), p('new', 5)]);
    });

    it('falls back to the lowest free slot when the target is taken', () => {
        const state = stateOf(registryOf(tool('a')), storedGrid([p('a', 0)]));
        const next = createToolInCategory(state, 'cat', null, draft('new'), 0)!;
        expect(next.categories[0]!.placements).toEqual([p('a', 0), p('new', 1)]);
    });

    it('creates in the addressed variant only; siblings keep identity', () => {
        const state = stateOf(
            registryOf(tool('a'), tool('b')),
            storedDynamic([
                storedVariant('source', SOURCE, [p('a', 0)]),
                storedVariant('topic', TOPIC, [p('b', 0)]),
            ])
        );
        const next = createToolInCategory(state, 'cat', 'topic', draft('new'), 3)!;
        expect(findVariant(next.categories[0]!, 'topic')!.placements).toEqual([
            p('b', 0),
            p('new', 3),
        ]);
        expect(findVariant(next.categories[0]!, 'source')).toBe(
            findVariant(state.categories[0]!, 'source')
        );
    });

    it('defaults to the first variant of a dynamic category without a target', () => {
        const state = stateOf(
            registryOf(tool('a')),
            storedDynamic([storedVariant('source', SOURCE, [p('a', 0)])])
        );
        const next = createToolInCategory(state, 'cat', null, draft('new'))!;
        expect(findToolVariantId(next.categories[0]!, 'new')).toBe('source');
    });

    it('refuses a full grid without touching anything', () => {
        const full = storedGrid(
            Array.from({ length: 16 }, (_, i) => p(`b${i}`, i))
        );
        const tools = registryOf(...Array.from({ length: 16 }, (_, i) => tool(`b${i}`)));
        const state = stateOf(tools, full);
        expect(createToolInCategory(state, 'cat', null, draft('x'))).toBeNull();
    });

    it('appends to a flow category (array order = flow order)', () => {
        const state = stateOf(registryOf(tool('a')), storedFlow([p('a')]));
        const next = createToolInCategory(state, 'cat', null, draft('new'))!;
        expect(next.categories[0]!.placements).toEqual([p('a'), p('new')]);
    });

    it('never mutates its input', () => {
        const state = stateOf(registryOf(tool('a')), storedGrid([p('a', 0)]));
        const before = snapshot(state);
        createToolInCategory(state, 'cat', null, draft('new'), 1);
        expect(snapshot(state)).toEqual(before);
    });
});

/**
 * `replaceOccupied` — the file-drop case.
 *
 * A file aimed at a particular cell means THAT cell, occupied or not: the drop
 * is already the deliberate act, so it replaces without asking. Every other
 * entry point (the `+`, the modal, a copy) means "put this somewhere" and must
 * keep the old, non-destructive fallback — which is why this is opt-in.
 *
 * The displaced tool is collected by the ORDINARY rule, not deleted on sight:
 * it goes only when nothing else references it and it is not a library tool.
 */
describe('createToolInCategory with replaceOccupied', () => {
    it('takes the addressed slot instead of dodging to a free one', () => {
        const state = stateOf(registryOf(tool('a')), storedGrid([p('a', 0)]));
        const next = createToolInCategory(state, 'cat', null, draft('new'), 0, {
            replaceOccupied: true,
        })!;
        expect(next.categories[0]!.placements).toEqual([p('new', 0)]);
    });

    it('collects the definition the replacement displaced', () => {
        const state = stateOf(registryOf(tool('a')), storedGrid([p('a', 0)]));
        const next = createToolInCategory(state, 'cat', null, draft('new'), 0, {
            replaceOccupied: true,
        })!;
        expect(next.tools['a']).toBeUndefined();
        expect(next.tools['new']).toMatchObject({ id: 'new' });
    });

    it('KEEPS the displaced definition when another placement still uses it', () => {
        // The same tool placed in a second variant must survive losing one
        // placement — the pre-v5 behaviour, and the reason GC is a rule rather
        // than a delete.
        const state = stateOf(
            registryOf(tool('a'), tool('b')),
            storedDynamic([
                storedVariant('source', SOURCE, [p('a', 0)]),
                storedVariant('topic', TOPIC, [p('a', 1), p('b', 0)]),
            ])
        );
        const next = createToolInCategory(state, 'cat', 'source', draft('new'), 0, {
            replaceOccupied: true,
        })!;
        expect(next.tools['a']).toBeDefined();
        expect(findVariant(next.categories[0]!, 'source')!.placements).toEqual([
            p('new', 0),
        ]);
        expect(findVariant(next.categories[0]!, 'topic')!.placements).toEqual([
            p('a', 1),
            p('b', 0),
        ]);
    });

    it('KEEPS a displaced library tool, which has a life of its own', () => {
        const state = stateOf(
            registryOf({ ...tool('a'), library: true }),
            storedGrid([p('a', 0)])
        );
        const next = createToolInCategory(state, 'cat', null, draft('new'), 0, {
            replaceOccupied: true,
        })!;
        expect(next.tools['a']).toMatchObject({ library: true });
        expect(next.categories[0]!.placements).toEqual([p('new', 0)]);
    });

    it('removes only the placement on the target cell, not the tool elsewhere', () => {
        // The same tool placed twice in ONE grid: replacing cell 0 must leave
        // the copy on cell 3 exactly where it is.
        const state = stateOf(
            registryOf({ ...tool('a'), library: true }),
            storedGrid([p('a', 0), p('a', 3)])
        );
        const next = createToolInCategory(state, 'cat', null, draft('new'), 0, {
            replaceOccupied: true,
        })!;
        expect(next.categories[0]!.placements).toEqual([p('a', 3), p('new', 0)]);
        expect(next.tools['a']).toBeDefined();
    });

    it('still fills an EMPTY addressed cell without collecting anything', () => {
        const state = stateOf(registryOf(tool('a')), storedGrid([p('a', 0)]));
        const next = createToolInCategory(state, 'cat', null, draft('new'), 5, {
            replaceOccupied: true,
        })!;
        expect(next.categories[0]!.placements).toEqual([p('a', 0), p('new', 5)]);
        expect(next.tools['a']).toBeDefined();
    });

    it('fills a full grid instead of refusing, because it replaces', () => {
        const full = storedGrid(Array.from({ length: 16 }, (_, i) => p(`b${i}`, i)));
        const tools = registryOf(...Array.from({ length: 16 }, (_, i) => tool(`b${i}`)));
        const state = stateOf(tools, full);
        const next = createToolInCategory(state, 'cat', null, draft('x'), 7, {
            replaceOccupied: true,
        })!;
        expect(next).not.toBeNull();
        expect(next.tools['b7']).toBeUndefined();
        expect(next.categories[0]!.placements).toHaveLength(16);
    });

    it('is OFF by default, so every other entry point is unchanged', () => {
        const state = stateOf(registryOf(tool('a')), storedGrid([p('a', 0)]));
        const next = createToolInCategory(state, 'cat', null, draft('new'), 0)!;
        expect(next.categories[0]!.placements).toEqual([p('a', 0), p('new', 1)]);
        expect(next.tools['a']).toBeDefined();
    });

    it('never mutates its input', () => {
        const state = stateOf(registryOf(tool('a')), storedGrid([p('a', 0)]));
        const before = snapshot(state);
        createToolInCategory(state, 'cat', null, draft('new'), 0, {
            replaceOccupied: true,
        });
        expect(snapshot(state)).toEqual(before);
    });
});

describe('updateToolDefinition (edit)', () => {
    it('changes the definition and leaves every placement untouched', () => {
        const state = stateOf(
            registryOf(tool('a', { name: 'Old' })),
            storedGrid([p('a', 3)])
        );
        const next = updateToolDefinition(state, {
            id: 'a',
            name: 'New',
            icon: 'star',
            actions: [],
            order: 99,
            slot: 99,
        });
        expect(next.tools['a']).toMatchObject({ name: 'New', icon: 'star' });
        // Positional view fields never leak into the definition.
        expect(next.tools['a']).not.toHaveProperty('order');
        expect(next.tools['a']).not.toHaveProperty('slot');
        expect(next.categories).toBe(state.categories);
    });

    it('preserves the stored library flag across a view-shaped edit', () => {
        const state = stateOf(
            registryOf(tool('a', { library: true })),
            storedGrid([p('a', 0)])
        );
        const next = updateToolDefinition(state, draft('a', 'Renamed'));
        expect(next.tools['a']!.library).toBe(true);
    });
});

describe('copyToolInCategory', () => {
    it('creates a NEW definition (fresh id, deep-copied actions) and a new placement', () => {
        const source = tool('a', {
            actions: [{ type: 'file', parameters: { filePath: 'x.md' } }],
        });
        const state = stateOf(registryOf(source), storedGrid([p('a', 0)]));
        const next = copyToolInCategory(state, 'cat', 'a', 'a-copy')!;
        expect(next.tools['a-copy']).toMatchObject({ id: 'a-copy', name: 'a' });
        expect(next.tools['a-copy']!.actions[0]).not.toBe(source.actions[0]);
        expect(next.categories[0]!.placements).toEqual([p('a', 0), p('a-copy', 1)]);
        // The source definition is untouched.
        expect(next.tools['a']).toBe(source);
    });

    it('copies into the variant the source occupies', () => {
        const state = stateOf(
            registryOf(tool('a'), tool('b')),
            storedDynamic([
                storedVariant('source', SOURCE, [p('a', 0)]),
                storedVariant('topic', TOPIC, [p('b', 0)]),
            ])
        );
        const next = copyToolInCategory(state, 'cat', 'b', 'b2')!;
        expect(findToolVariantId(next.categories[0]!, 'b2')).toBe('topic');
    });

    it('a copy of a library tool starts as an ad-hoc tool', () => {
        const state = stateOf(
            registryOf(tool('a', { library: true })),
            storedGrid([p('a', 0)])
        );
        const next = copyToolInCategory(state, 'cat', 'a', 'a2')!;
        expect(next.tools['a2']!.library).toBeUndefined();
    });
});

describe('removeToolFromCategory + GC', () => {
    it('last placement removed -> non-library definition disappears', () => {
        const state = stateOf(registryOf(tool('a'), tool('b')), storedGrid([p('a', 0), p('b', 1)]));
        const next = removeToolFromCategory(state, 'cat', 'a');
        expect(next.categories[0]!.placements).toEqual([p('b', 1)]);
        expect(next.tools['a']).toBeUndefined();
        expect(next.tools['b']).toBeDefined();
    });

    it('a library tool survives with zero placements', () => {
        const state = stateOf(
            registryOf(tool('a', { library: true })),
            storedGrid([p('a', 0)])
        );
        const next = removeToolFromCategory(state, 'cat', 'a');
        expect(next.categories[0]!.placements).toEqual([]);
        expect(next.tools['a']).toBeDefined();
    });

    it('a tool still placed elsewhere survives removing one placement', () => {
        const other: StoredCategory = { ...storedGrid([p('a', 0)]), id: 'other' };
        const state = stateOf(registryOf(tool('a')), storedGrid([p('a', 0)]), other);
        const next = removeToolFromCategory(state, 'cat', 'a');
        expect(next.tools['a']).toBeDefined();
        expect(next.categories[1]!.placements).toEqual([p('a', 0)]);
    });

    it('removes from whichever variant holds the tool; siblings untouched', () => {
        const state = stateOf(
            registryOf(tool('a'), tool('b')),
            storedDynamic([
                storedVariant('source', SOURCE, [p('a', 0)]),
                storedVariant('topic', TOPIC, [p('b', 0)]),
            ])
        );
        const next = removeToolFromCategory(state, 'cat', 'b');
        expect(findVariant(next.categories[0]!, 'topic')!.placements).toEqual([]);
        expect(findVariant(next.categories[0]!, 'source')).toBe(
            findVariant(state.categories[0]!, 'source')
        );
        expect(next.tools['b']).toBeUndefined();
    });
});

describe('drag write-back (placements only, never GC)', () => {
    const tools = registryOf(tool('a'), tool('b'), tool('x'), tool('y'), tool('foreign'));

    it('writes new slots into the on-screen variant only', () => {
        const category = storedDynamic([
            storedVariant('source', SOURCE, [p('a', 0), p('b', 1)]),
            storedVariant('topic', TOPIC, [p('x', 0), p('y', 5)]),
        ]);
        const slotIds = new Array<string | null>(16).fill(null);
        slotIds[7] = 'a';
        slotIds[1] = 'b';
        const next = applySlotIdsToStoredCategory(
            category,
            slotIds,
            tools,
            'source',
            new Set(['a', 'b'])
        );
        expect(findVariant(next, 'source')!.placements).toEqual([p('b', 1), p('a', 7)]);
        // Topic is byte-identical (same reference).
        expect(findVariant(next, 'topic')).toBe(findVariant(category, 'topic'));
    });

    it('a cross-category move keeps the definition (registry is not consulted for GC)', () => {
        const from = storedGrid([p('a', 0)], { id: 'from' });
        const to = storedGrid([], { id: 'to' });
        const placed = new Set(['a']);
        const nextFrom = applySlotIdsToStoredCategory(
            from,
            new Array<string | null>(16).fill(null),
            tools,
            null,
            placed
        );
        const targetIds = new Array<string | null>(16).fill(null);
        targetIds[4] = 'a';
        const nextTo = applySlotIdsToStoredCategory(to, targetIds, tools, null, placed);
        expect(nextFrom.placements).toEqual([]);
        expect(nextTo.placements).toEqual([p('a', 4)]);
        // The definition is exactly where it was: in the registry.
        expect(tools['a']).toBeDefined();
        expect(
            collectReferencedToolIds([nextFrom, nextTo]).has('a')
        ).toBe(true);
    });

    it('a placement the drag never carried stays where it is (overflow safety)', () => {
        const category = storedGrid([p('a', 0), p('b', 1)]);
        const slotIds = new Array<string | null>(16).fill(null);
        slotIds[0] = 'a';
        const next = applySlotIdsToStoredCategory(
            category,
            slotIds,
            tools,
            null,
            new Set(['a']) // b unknown to the drag
        );
        expect(next.placements.map((placement) => placement.toolId).sort()).toEqual([
            'a',
            'b',
        ]);
    });

    it('flow rewrite: id order becomes placement order, unclaimed placements stay', () => {
        const category = storedFlow([p('a'), p('b'), p('x')]);
        const next = applyFlowIdsToStoredCategory(
            category,
            ['b', 'a'],
            tools,
            new Set(['a', 'b'])
        );
        expect(next.placements).toEqual([p('b'), p('a'), p('x')]);
    });
});

describe('resize (plan + commit + GC)', () => {
    const tools = registryOf(tool('a', { name: 'Alpha' }), tool('edge', { name: 'Edge' }));

    it('grow keeps every logical row/column (coordinate-aware)', () => {
        // 2x3: a at (0,0)=0, edge at (1,2)=5. +1 column -> 2x4: 0 and 6.
        const category = storedGrid([p('a', 0), p('edge', 5)], { rows: 2, columns: 3 });
        const plan = planStoredGridResize(category, null, { rows: 2, columns: 4 }, tools)!;
        expect(plan.removedToolIds).toEqual([]);
        expect(plan.category.placements).toEqual([p('a', 0), p('edge', 6)]);
    });

    it('shrink cuts exactly the outer stripe and names its tools', () => {
        const category = storedGrid([p('a', 0), p('edge', 2)], { rows: 1, columns: 3 });
        const plan = planStoredGridResize(category, null, { rows: 1, columns: 2 }, tools)!;
        expect(plan.removedToolIds).toEqual(['edge']);
        expect(plan.removedNames).toEqual(['Edge']);
        expect(plan.category.placements).toEqual([p('a', 0)]);
        expect(plan.category.rows).toBe(1);
        expect(plan.category.columns).toBe(2);
    });

    it('the plan alone changes nothing; the commit collects exactly the cut tools', () => {
        const category = storedGrid([p('a', 0), p('edge', 2)], { rows: 1, columns: 3 });
        const state = stateOf(tools, category);
        const before = snapshot(state);
        const plan = planStoredGridResize(category, null, { rows: 1, columns: 2 }, tools)!;
        expect(snapshot(state)).toEqual(before); // cancel = nothing happened

        const committed = commitStoredGridResize(state, plan);
        expect(committed.tools['edge']).toBeUndefined();
        expect(committed.tools['a']).toBeDefined();
    });

    it('a library tool on the cut stripe loses its placement but keeps its definition', () => {
        const libTools = registryOf(tool('a'), tool('edge', { library: true }));
        const category = storedGrid([p('a', 0), p('edge', 2)], { rows: 1, columns: 3 });
        const plan = planStoredGridResize(category, null, { rows: 1, columns: 2 }, libTools)!;
        const committed = commitStoredGridResize(stateOf(libTools, category), plan);
        expect(committed.tools['edge']).toBeDefined();
        expect(committed.categories[0]!.placements).toEqual([p('a', 0)]);
    });

    it('resizes the addressed variant only', () => {
        const category = storedDynamic([
            storedVariant('v1', SOURCE, [p('a', 0)], false, { rows: 2, columns: 2 }),
            storedVariant('v2', TOPIC, [p('edge', 0)], false, { rows: 2, columns: 2 }),
        ]);
        const plan = planStoredGridResize(category, 'v1', { rows: 2, columns: 3 }, tools)!;
        expect(findVariant(plan.category, 'v1')!.columns).toBe(3);
        expect(findVariant(plan.category, 'v2')).toBe(findVariant(category, 'v2'));
    });
});

describe('variant operations (stored)', () => {
    const base = () =>
        storedDynamic([
            storedVariant('source', SOURCE, [p('a', 0)], false, { rows: 2, columns: 2 }),
        ]);

    it('addVariantToCategory appends an empty variant at the grid current size', () => {
        const next = addVariantToCategory(base(), {
            id: 'new',
            name: 'New',
            trigger: { all: [] },
        });
        const added = findVariant(next, 'new')!;
        expect(added.placements).toEqual([]);
        expect(added.rows).toBe(2);
        expect(added.columns).toBe(2);
    });

    it('addVariantToCategory refuses a second fallback', () => {
        const withFallback = addVariantToCategory(base(), {
            id: 'f1',
            name: 'F1',
            fallback: true,
        });
        expect(
            addVariantToCategory(withFallback, { id: 'f2', name: 'F2', fallback: true })
        ).toBe(withFallback);
    });

    it('duplicateVariantInState copies the tools instead of sharing them (F2)', () => {
        const rich = tool('tool-1', {
            name: 'Fundstelle',
            icon: 'star',
            actions: [{ type: 'command', parameters: { commandId: 'x' } }],
            customCss: 'color: red',
            executionMode: 'parallel',
        });
        const state = stateOf(
            registryOf(rich, tool('tool-2')),
            storedDynamic([
                storedVariant('source', SOURCE, [p('tool-1', 5), p('tool-2', 9)], false, {
                    rows: 4,
                    columns: 4,
                }),
            ])
        );
        const next = duplicateVariantInState(
            state,
            'cat',
            'source',
            { id: 'topic', name: 'Topic', trigger: TOPIC },
            (index) => `new-${index}`
        );
        const copy = findVariant(next.categories[0]!, 'topic')!;
        expect(copy.placements).toEqual([p('new-0', 5), p('new-1', 9)]);
        expect(copy.rows).toBe(4);
        expect(next.tools['new-0']).toMatchObject({
            name: 'Fundstelle',
            icon: 'star',
            customCss: 'color: red',
            executionMode: 'parallel',
        });
        // Deep copies: editing the copy's definition can never leak back.
        expect(next.tools['new-0']!.actions[0]).not.toBe(rich.actions[0]);
        expect(next.tools['tool-1']).toBe(rich);
        // Inserted directly below its source.
        expect(getCategoryVariants(next.categories[0]!).map((v) => v.id)).toEqual([
            'source',
            'topic',
        ]);
    });

    it('editing the copy never changes the original (independent definitions)', () => {
        const state = stateOf(
            registryOf(tool('t1', { name: 'Original' })),
            storedDynamic([storedVariant('source', SOURCE, [p('t1', 0)])])
        );
        const dup = duplicateVariantInState(
            state,
            'cat',
            'source',
            { id: 'copy', name: 'Copy', trigger: TOPIC },
            () => 'copy-tool'
        );
        const edited = updateToolDefinition(dup, draft('copy-tool', 'Changed'));
        expect(edited.tools['t1']!.name).toBe('Original');
        expect(edited.tools['copy-tool']!.name).toBe('Changed');
    });

    it('removeVariantFromState garbage-collects the variant tools', () => {
        const state = stateOf(
            registryOf(tool('a'), tool('b'), tool('kept', { library: true })),
            storedDynamic([
                storedVariant('source', SOURCE, [p('a', 0), p('kept', 1)]),
                storedVariant('topic', TOPIC, [p('b', 0)]),
            ])
        );
        const next = removeVariantFromState(state, 'cat', 'source');
        expect(getCategoryVariants(next.categories[0]!).map((v) => v.id)).toEqual(['topic']);
        expect(next.tools['a']).toBeUndefined(); // only home was the variant
        expect(next.tools['kept']).toBeDefined(); // library-protected
        expect(next.tools['b']).toBeDefined(); // untouched sibling
    });
});

describe('category-level operations', () => {
    it('duplicateCategoryInState copies variants AND tools with fresh ids', () => {
        let n = 0;
        const newId = () => `fresh-${(n += 1)}`;
        const state = stateOf(
            registryOf(tool('a'), tool('b')),
            storedDynamic([
                storedVariant('v1', SOURCE, [p('a', 3)]),
                storedVariant('v2', undefined, [p('b', 0)], true),
            ])
        );
        const result = duplicateCategoryInState(state, 'cat', 7, newId)!;
        expect(result.category.order).toBe(7);
        expect(result.category.id).not.toBe('cat');
        const variants = getCategoryVariants(result.category);
        expect(variants).toHaveLength(2);
        expect(variants[1]!.fallback).toBe(true);
        // Every copied placement references a copied definition.
        for (const variant of variants) {
            for (const placement of variant.placements) {
                expect(placement.toolId.startsWith('fresh-')).toBe(true);
                expect(result.state.tools[placement.toolId]).toBeDefined();
            }
        }
        // Slots are preserved.
        expect(variants[0]!.placements[0]!.slot).toBe(3);
        // Originals untouched.
        expect(result.state.tools['a']).toBeDefined();
        expect(result.state.categories[0]).toBe(state.categories[0]);
    });

    it('deleteCategoryFromState removes the category, renumbers immutably and GCs', () => {
        const other = storedGrid([p('shared', 0)], { id: 'other', order: 1 });
        const state = stateOf(
            registryOf(tool('own'), tool('shared'), tool('lib', { library: true })),
            storedGrid([p('own', 0), p('shared', 1), p('lib', 2)], { id: 'cat', order: 0 }),
            other
        );
        const next = deleteCategoryFromState(state, 'cat');
        expect(next.categories.map((c) => [c.id, c.order])).toEqual([['other', 0]]);
        expect(next.tools['own']).toBeUndefined();
        expect(next.tools['shared']).toBeDefined(); // still placed in `other`
        expect(next.tools['lib']).toBeDefined(); // library-protected
        // The surviving category was renumbered into a NEW object.
        expect(next.categories[0]).not.toBe(other);
        expect(other.order).toBe(1);
    });

    it('convertStoredStaticGridToDynamic moves grid and size into the first variant', () => {
        const grid = storedGrid([p('a', 0), p('b', 9)], { rows: 3, columns: 4 });
        const dynamic = convertStoredStaticGridToDynamic(grid, {
            id: 'v1',
            name: 'Source',
            trigger: SOURCE,
        });
        expect(dynamic.placements).toEqual([]);
        expect(dynamic.rows).toBeUndefined();
        expect(dynamic.columns).toBeUndefined();
        const v = findVariant(dynamic, 'v1')!;
        expect(v.trigger).toEqual(SOURCE);
        expect(v.rows).toBe(3);
        expect(v.columns).toBe(4);
        expect(v.placements).toEqual([p('a', 0), p('b', 9)]);
    });

    it('a legacy static grid without size fields stays size-field-free after conversion', () => {
        const dynamic = convertStoredStaticGridToDynamic(storedGrid([p('a', 0)]), {
            id: 'v1',
            name: 'V',
            trigger: SOURCE,
        });
        const v = findVariant(dynamic, 'v1')!;
        expect(v.rows).toBeUndefined();
        expect(v.columns).toBeUndefined();
    });
});

describe('layout conversion (stored)', () => {
    it('flow -> grid without conditions becomes a static grid, definitions kept', () => {
        const state = stateOf(
            registryOf(tool('a'), tool('b')),
            storedFlow([p('a'), p('b')])
        );
        const result = applyStoredCategoryLayout(state, 'cat', 'grid');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const category = result.state.categories[0]!;
        expect(category.layout).toBe('grid');
        expect(category.rows).toBe(1);
        expect(category.columns).toBe(3);
        expect(category.placements).toEqual([p('a', 0), p('b', 1)]);
        expect(result.state.tools['a']).toBeDefined();
    });

    it('flow -> grid with conditions composes full variants (lifted conditions)', () => {
        const state = stateOf(
            registryOf(tool('plain'), tool('cond', { conditions: SOURCE })),
            storedFlow([p('plain'), p('cond')])
        );
        const result = applyStoredCategoryLayout(state, 'cat', 'grid');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const category = result.state.categories[0]!;
        const variants = getCategoryVariants(category);
        expect(variants.length).toBe(2); // one triggered + the Default fallback
        // Every placement of every variant resolves to a definition.
        for (const variant of variants) {
            for (const placement of variant.placements) {
                expect(result.state.tools[placement.toolId]).toBeDefined();
            }
        }
        // The lifted condition no longer sits on the grouped tool's definition.
        const triggered = variants.find((v) => v.fallback !== true)!;
        const condPlacement = triggered.placements.find(
            (placement) => result.state.tools[placement.toolId]!.name === 'cond'
        )!;
        expect(result.state.tools[condPlacement.toolId]!.conditions).toBeUndefined();
        // Materialization round-trips: every placement yields a view button.
        const view = materializeCategory(category, result.state.tools);
        view.variants!.forEach((viewVariant, index) => {
            expect(viewVariant.buttons.length).toBe(variants[index]!.placements.length);
        });
    });

    it('grid -> flow keeps the spatial reading order and drops slots/size', () => {
        const state = stateOf(
            registryOf(tool('a'), tool('b')),
            storedGrid([p('b', 5)], { rows: 2, columns: 3 })
        );
        const withA = stateOf(
            state.tools,
            storedGrid([p('b', 5), p('a', 0)], { rows: 2, columns: 3 })
        );
        const result = applyStoredCategoryLayout(withA, 'cat', 'flow');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const category = result.state.categories[0]!;
        expect(category.layout).toBe('flow');
        expect(category.rows).toBeUndefined();
        expect(category.placements).toEqual([p('a'), p('b')]);
        expect(result.state.tools).toBe(withA.tools); // registry untouched
    });

    it('a dynamic category refuses the switch to flow', () => {
        const state = stateOf(
            registryOf(tool('a')),
            storedDynamic([storedVariant('v', SOURCE, [p('a', 0)])])
        );
        const result = applyStoredCategoryLayout(state, 'cat', 'flow');
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('dynamic_category');
    });
});

describe('gcTools (the rule itself)', () => {
    it('collects only unreferenced non-library candidates', () => {
        const tools = registryOf(
            tool('gone'),
            tool('placed'),
            tool('lib', { library: true })
        );
        const categories = [storedGrid([p('placed', 0)])];
        const next = gcTools(tools, categories, ['gone', 'placed', 'lib', 'unknown']);
        expect(Object.keys(next).sort()).toEqual(['lib', 'placed']);
    });

    it('returns the same registry object when nothing is removable', () => {
        const tools = registryOf(tool('placed'));
        const categories = [storedGrid([p('placed', 0)])];
        expect(gcTools(tools, categories, ['placed'])).toBe(tools);
        expect(gcTools(tools, categories, [])).toBe(tools);
    });
});

describe('materialization', () => {
    it('joins definitions and placements into the view shape', () => {
        const buttons = materializeButtons(
            [p('a', 3), p('b')],
            registryOf(tool('a', { icon: 'star' }), tool('b'))
        );
        expect(buttons).toEqual([
            { id: 'a', name: 'a', icon: 'star', actions: [], order: 0, slot: 3 },
            { id: 'b', name: 'b', actions: [], order: 1 },
        ]);
    });

    it('skips placements whose definition is missing instead of crashing', () => {
        const buttons = materializeButtons([p('ghost', 0), p('a', 1)], registryOf(tool('a')));
        expect(buttons.map((b) => b.id)).toEqual(['a']);
    });

    it('never leaks the library flag into the view shape', () => {
        const buttons = materializeButtons(
            [p('a', 0)],
            registryOf(tool('a', { library: true }))
        );
        expect(buttons[0]).not.toHaveProperty('library');
    });
});
