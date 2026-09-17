// Dynamic category variants — the pure core (read side + shape-generic ops).
//
// Product guarantees under test (see docs/ocap/DECISIONS.md):
// - a variant is a COMPLETE, independent grid: no inheritance, no sharing;
// - runtime picks exactly one variant: first matching trigger in priority
//   order, else the fallback, else none;
// - the fallback is modelled explicitly and can never shadow a trigger;
// - every operation is pure and immutable.
//
// Since v5 the WRITE operations (create/copy/remove tools, duplicate
// variants, conversions) live in src/domain/categoryOps.ts and are covered by
// tests/categoryOps.test.ts; this file keeps the runtime resolution (which
// consumes the materialized view shape) and the shape-generic variant
// metadata operations.

import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig, CategoryVariant } from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import type { OCAPContextSnapshot } from '@/context/OCAPContext';
import {
    allCategoryButtons,
    composeFullVariant,
    convertCategoryToGrid,
    effectiveGridButtons,
    filterCategoryButtonsDeep,
    findButtonVariantId,
    findFallbackVariant,
    findVariant,
    getCategoryVariants,
    isDynamicCategory,
    isStaticGridCategory,
    liftButtonConditions,
    moveVariant,
    removeVariant,
    resolveDynamicCategoryVariant,
    resolveGridViewForContext,
    resolveGridViewForVariant,
    updateVariant,
    variantTriggerMatches,
} from '@/utils/categoryVariants';

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

const SOURCE: ButtonCondition = { rule: 'property', op: 'equals', key: 'type', value: 'Source' };
const TOPIC: ButtonCondition = { rule: 'property', op: 'equals', key: 'type', value: 'Topic' };
const sourceContext = () => context({ properties: { type: 'Source' } });
const topicContext = () => context({ properties: { type: 'Topic' } });

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
    else if (trigger !== undefined) v.trigger = trigger;
    return v;
}

function dynamicCategory(variants: CategoryVariant[]): CategoryConfig {
    return { id: 'cat', name: 'Node Tools', order: 0, buttons: [], layout: 'grid', variants };
}

function staticGrid(buttons: ButtonConfig[]): CategoryConfig {
    return { id: 'cat', name: 'Tools', order: 0, buttons, layout: 'grid' };
}

describe('category kind', () => {
    it('distinguishes static grid, dynamic grid and flow', () => {
        expect(isStaticGridCategory(staticGrid([]))).toBe(true);
        expect(isDynamicCategory(staticGrid([]))).toBe(false);
        expect(isDynamicCategory(dynamicCategory([]))).toBe(true);
        expect(isStaticGridCategory(dynamicCategory([]))).toBe(false);
        const flow: CategoryConfig = { id: 'f', name: 'F', order: 0, buttons: [] };
        expect(isDynamicCategory(flow)).toBe(false);
        expect(isStaticGridCategory(flow)).toBe(false);
    });

    it('accepts stored-shape variants (placements) as valid too', () => {
        const stored = {
            id: 'cat',
            layout: 'grid',
            variants: [{ id: 'v', name: 'v', placements: [] }],
        };
        expect(isDynamicCategory(stored as never)).toBe(true);
        expect(getCategoryVariants(stored).map((v) => v.id)).toEqual(['v']);
    });

    it('normalizes malformed variants defensively', () => {
        const category = {
            ...dynamicCategory([variant('ok', SOURCE, [])]),
            variants: [
                variant('ok', SOURCE, []),
                null,
                42,
                { id: 7, buttons: [] },
                { id: 'no-buttons' },
            ],
        } as unknown as CategoryConfig;
        expect(getCategoryVariants(category).map((v) => v.id)).toEqual(['ok']);
    });
});

describe('trigger matching', () => {
    it('matches a valid trigger against the context', () => {
        expect(variantTriggerMatches(variant('s', SOURCE, []), sourceContext())).toBe(true);
        expect(variantTriggerMatches(variant('s', SOURCE, []), topicContext())).toBe(false);
    });

    it('never matches the fallback as a trigger', () => {
        expect(
            variantTriggerMatches(variant('f', undefined, [], true), sourceContext())
        ).toBe(false);
    });

    it('never matches an absent trigger (always-match must be explicit)', () => {
        expect(variantTriggerMatches(variant('x', undefined, []), sourceContext())).toBe(
            false
        );
    });

    it('matches the explicit always-true trigger', () => {
        expect(variantTriggerMatches(variant('x', { all: [] }, []), context())).toBe(true);
    });

    it('does not match a structurally invalid trigger (no shadowing)', () => {
        const broken = { rule: 'nonsense' } as unknown as ButtonCondition;
        expect(variantTriggerMatches(variant('x', broken, []), sourceContext())).toBe(false);
    });
});

describe('runtime resolution', () => {
    const source = variant('source', SOURCE, [button('fundstelle', 0, 0)]);
    const topic = variant('topic', TOPIC, [button('argument', 0, 0)]);
    const fallback = variant('default', undefined, [button('home', 0, 0)], true);

    it('resolves Source for a Source note and Topic for a Topic note', () => {
        const category = dynamicCategory([source, topic]);
        expect(resolveDynamicCategoryVariant(category, sourceContext())).toEqual({
            variant: source,
            reason: 'trigger',
        });
        expect(resolveDynamicCategoryVariant(category, topicContext())).toEqual({
            variant: topic,
            reason: 'trigger',
        });
    });

    it('lets the FIRST matching variant win when several match', () => {
        const also = variant('also-source', SOURCE, []);
        const category = dynamicCategory([source, also]);
        expect(
            resolveDynamicCategoryVariant(category, sourceContext()).variant?.id
        ).toBe('source');
    });

    it('reordering changes the winner (order IS priority)', () => {
        const also = variant('also-source', SOURCE, []);
        const category = dynamicCategory([source, also]);
        const reordered = moveVariant(category, 'also-source', -1);
        expect(
            resolveDynamicCategoryVariant(reordered, sourceContext()).variant?.id
        ).toBe('also-source');
    });

    it('falls back to the fallback variant when nothing matches', () => {
        const category = dynamicCategory([source, topic, fallback]);
        expect(resolveDynamicCategoryVariant(category, context())).toEqual({
            variant: fallback,
            reason: 'fallback',
        });
    });

    it('resolves to none without a fallback', () => {
        const category = dynamicCategory([source, topic]);
        expect(resolveDynamicCategoryVariant(category, context())).toEqual({
            variant: null,
            reason: 'none',
        });
    });

    it('never picks the fallback before a matching trigger, wherever it sits', () => {
        const category = dynamicCategory([fallback, source]);
        expect(resolveDynamicCategoryVariant(category, sourceContext())).toEqual({
            variant: source,
            reason: 'trigger',
        });
    });

    it('skips a broken variant instead of letting it shadow the rest', () => {
        const broken = variant(
            'broken',
            { rule: 'nonsense' } as unknown as ButtonCondition,
            []
        );
        const category = dynamicCategory([broken, source]);
        expect(
            resolveDynamicCategoryVariant(category, sourceContext()).variant?.id
        ).toBe('source');
    });
});

describe('resolved grid views', () => {
    it('a static grid resolves to its own buttons', () => {
        const category = staticGrid([button('a', 0, 0), button('b', 1, 7)]);
        const view = resolveGridViewForContext(category, context());
        expect(view.reason).toBe('static');
        expect(view.variantId).toBeNull();
        expect(view.slots[0]?.id).toBe('a');
        expect(view.slots[7]?.id).toBe('b');
        expect(view.slots).toHaveLength(16);
    });

    it('the same slot can hold a different button per variant', () => {
        const category = dynamicCategory([
            variant('source', SOURCE, [button('zotero', 0, 3)]),
            variant('topic', TOPIC, [button('link-source', 0, 3)]),
        ]);
        expect(
            resolveGridViewForContext(category, sourceContext()).slots[3]?.id
        ).toBe('zotero');
        expect(
            resolveGridViewForContext(category, topicContext()).slots[3]?.id
        ).toBe('link-source');
    });

    it('no match without fallback yields an empty view', () => {
        const category = dynamicCategory([variant('source', SOURCE, [button('x', 0, 0)])]);
        const view = resolveGridViewForContext(category, topicContext());
        expect(view.reason).toBe('none');
        expect(view.slots.every((slot) => slot === null)).toBe(true);
        expect(effectiveGridButtons(view)).toEqual([]);
    });

    it('management view shows the selected variant, whatever the context', () => {
        const category = dynamicCategory([
            variant('source', SOURCE, [button('a', 0, 0)]),
            variant('topic', TOPIC, [button('b', 0, 0)]),
        ]);
        const view = resolveGridViewForVariant(category, 'topic');
        expect(view.reason).toBe('selected');
        expect(view.variantId).toBe('topic');
        expect(view.slots[0]?.id).toBe('b');
    });

    it('an unknown selection falls back to the first variant', () => {
        const category = dynamicCategory([variant('source', SOURCE, [button('a', 0, 0)])]);
        const view = resolveGridViewForVariant(category, 'deleted');
        expect(view.variantId).toBe('source');
    });

    it('a button on slot 15 with everything before it empty stays on slot 15', () => {
        const category = dynamicCategory([variant('v', { all: [] }, [button('last', 0, 15)])]);
        const view = resolveGridViewForContext(category, context());
        expect(view.slots[15]?.id).toBe('last');
        expect(view.slots.slice(0, 15).every((slot) => slot === null)).toBe(true);
    });
});

describe('variant metadata operations (shape-generic)', () => {
    const base = () =>
        dynamicCategory([
            variant('source', SOURCE, [button('a', 0, 0)]),
            variant('topic', TOPIC, [button('b', 0, 0)]),
        ]);
    const withFallback = () =>
        dynamicCategory([
            variant('source', SOURCE, [button('a', 0, 0)]),
            variant('topic', TOPIC, [button('b', 0, 0)]),
            variant('f1', undefined, [], true),
        ]);

    it('refuses to crown a second fallback', () => {
        const category = withFallback();
        const refused = updateVariant(category, 'source', {
            name: 'Source',
            trigger: undefined,
            fallback: true,
        });
        expect(refused).toBe(category);
    });

    it('updateVariant renames, retriggers and can clear the fallback flag', () => {
        const next = updateVariant(withFallback(), 'f1', {
            name: 'Now triggered',
            trigger: TOPIC,
            fallback: false,
        });
        const changed = findVariant(next, 'f1')!;
        expect(changed.name).toBe('Now triggered');
        expect(changed.trigger).toEqual(TOPIC);
        expect(changed.fallback).toBeUndefined();
        // The fallback role is free again.
        expect(findFallbackVariant(next)).toBeNull();
    });

    it('updateVariant keeps the grid content untouched (buttons AND placements shapes)', () => {
        const category = base();
        const next = updateVariant(category, 'source', {
            name: 'Renamed',
            trigger: TOPIC,
            fallback: false,
        });
        expect(findVariant(next, 'source')!.buttons).toEqual(
            findVariant(category, 'source')!.buttons
        );

        const stored = {
            id: 'cat',
            layout: 'grid' as const,
            variants: [
                { id: 'v', name: 'v', trigger: SOURCE, placements: [{ toolId: 't', slot: 2 }] },
            ],
        };
        const nextStored = updateVariant(stored, 'v', {
            name: 'Renamed',
            trigger: undefined,
            fallback: false,
        });
        expect(nextStored.variants[0]!.placements).toEqual([{ toolId: 't', slot: 2 }]);
        expect(nextStored.variants[0]!.trigger).toBeUndefined();
    });

    it('updateVariant clears a cleared trigger (no stale rule survives)', () => {
        const next = updateVariant(base(), 'source', {
            name: 'Source',
            trigger: undefined,
            fallback: false,
        });
        expect(findVariant(next, 'source')!.trigger).toBeUndefined();
    });

    it('removeVariant removes exactly one variant', () => {
        const next = removeVariant(base(), 'source');
        expect(getCategoryVariants(next).map((v) => v.id)).toEqual(['topic']);
    });

    it('moveVariant refuses to move the fallback', () => {
        const category = withFallback();
        expect(moveVariant(category, 'f1', -1)).toBe(category);
    });

    it('operations never mutate the input', () => {
        const category = base();
        const snapshot = JSON.parse(JSON.stringify(category)) as unknown;
        updateVariant(category, 'source', { name: 'Y', trigger: TOPIC, fallback: false });
        removeVariant(category, 'topic');
        moveVariant(category, 'topic', -1);
        expect(category).toEqual(snapshot);
    });
});

describe('buttons across the category (view world)', () => {
    const category = dynamicCategory([
        variant('source', SOURCE, [button('a', 0, 0)]),
        variant('topic', TOPIC, [button('b', 0, 0), button('c', 1, 1)]),
    ]);

    it('finds the variant a button lives in', () => {
        expect(findButtonVariantId(category, 'a')).toBe('source');
        expect(findButtonVariantId(category, 'c')).toBe('topic');
        expect(findButtonVariantId(category, 'nope')).toBeNull();
    });

    it('collects and filters buttons across every variant', () => {
        expect(allCategoryButtons(category).map((b) => b.id)).toEqual(['a', 'b', 'c']);
        const filtered = filterCategoryButtonsDeep(category, (b) => b.id !== 'b');
        expect(findVariant(filtered, 'topic')!.buttons.map((b) => b.id)).toEqual(['c']);
        expect(filterCategoryButtonsDeep(category, () => true)).toBe(category);
    });
});

describe('liftButtonConditions (legacy flow data)', () => {
    it('groups buttons by identical condition, key order ignored', () => {
        const c1 = { rule: 'property', op: 'equals', key: 'type', value: 'A' };
        const c2 = { value: 'A', key: 'type', op: 'equals', rule: 'property' };
        const { base, groups } = liftButtonConditions([
            { ...button('plain', 0) },
            { ...button('x', 1), conditions: c1 as ButtonCondition },
            { ...button('y', 2), conditions: c2 as ButtonCondition },
        ]);
        expect(base.map((b) => b.id)).toEqual(['plain']);
        expect(groups).toHaveLength(1);
        expect(groups[0]!.buttons.map((b) => b.id)).toEqual(['x', 'y']);
        expect(groups[0]!.buttons.every((b) => b.conditions === undefined)).toBe(true);
    });

    it('keeps invalid conditions on the base button untouched', () => {
        const broken = { rule: 'nonsense' } as unknown as ButtonCondition;
        const { base, groups } = liftButtonConditions([
            { ...button('a', 0), conditions: broken },
        ]);
        expect(groups).toEqual([]);
        expect(base[0]!.conditions).toEqual(broken);
    });
});

describe('composeFullVariant (migration composition rule)', () => {
    const base = [button('home', 0, 0), button('search', 1, 2)];

    it('reproduces the old effective grid: base slots + overlay on free slots', () => {
        const composed = composeFullVariant(
            base,
            [button('fundstelle', 0, 1)],
            'v-source',
            'Source',
            SOURCE
        );
        const slots = new Map(composed.buttons.map((b) => [b.slot, b.name]));
        expect(slots.get(0)).toBe('home');
        expect(slots.get(2)).toBe('search');
        expect(slots.get(1)).toBe('fundstelle');
    });

    it('relocates an overlay tool whose slot collides with the base', () => {
        const composed = composeFullVariant(
            base,
            [button('clash', 0, 0)],
            'v',
            'V',
            SOURCE
        );
        const clash = composed.buttons.find((b) => b.name === 'clash')!;
        expect(clash.slot).toBe(1); // lowest free unblocked slot
    });

    it('derives unique ids for base copies and keeps overlay ids', () => {
        const composed = composeFullVariant(
            base,
            [button('own', 0, 1)],
            'v-source',
            'Source',
            SOURCE
        );
        expect(composed.buttons.map((b) => b.id).sort()).toEqual([
            'own',
            'v-source--home',
            'v-source--search',
        ]);
    });

    it('shares nothing with its inputs', () => {
        const overlay = [button('own', 0, 1)];
        const composed = composeFullVariant(base, overlay, 'v', 'V', SOURCE);
        for (const b of composed.buttons) {
            expect(base.includes(b)).toBe(false);
            expect(overlay.includes(b)).toBe(false);
        }
    });
});

describe('flow -> grid conversion is JSON-safe', () => {
    it('the produced dynamic category serializes losslessly', () => {
        const flow: CategoryConfig = {
            id: 'cat',
            name: 'Cat',
            order: 0,
            buttons: [
                button('plain', 0),
                { ...button('cond', 1), conditions: SOURCE },
            ],
        };
        const result = convertCategoryToGrid(flow);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(JSON.parse(JSON.stringify(result.category))).toEqual(result.category);
    });
});
