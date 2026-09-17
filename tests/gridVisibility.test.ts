// Slot stability and category visibility under dynamic variants.
//
// This is the load-bearing product guarantee of the grid: a slot that is
// empty in the active variant stays EMPTY, and every tool sits on exactly the
// slot its variant stores. These tests drive the real projection
// (projectCategoriesForContext) and the real placement (placeButtonsOnGrid)
// together, because that pair is what the renderer actually uses.
//
// Since version 3 a grid category is either STATIC (one grid) or DYNAMIC
// (complete variants, first matching trigger wins, explicit fallback).

import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig, CategoryVariant } from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import type { OCAPContextSnapshot } from '@/context/OCAPContext';
import { hasConditions } from '@/context/conditions';
import { projectCategoriesForContext } from '@/context/panelProjection';
import { placeButtonsOnGrid } from '@/utils/categoryGrid';

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

function button(id: string, order: number, slot: number): ButtonConfig {
    return { id, name: id, actions: [], order, slot };
}

const MARKDOWN_ONLY: ButtonCondition = { rule: 'viewType', value: 'markdown' };
const PDF_ONLY: ButtonCondition = { rule: 'viewType', value: 'pdf' };

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

function dynamicCategory(
    variants: CategoryVariant[],
    conditions?: ButtonCondition
): CategoryConfig {
    const c: CategoryConfig = {
        id: 'grid',
        name: 'Grid',
        order: 0,
        buttons: [],
        layout: 'grid',
        variants,
    };
    if (conditions) c.conditions = conditions;
    return c;
}

function staticGrid(buttons: ButtonConfig[], conditions?: ButtonCondition): CategoryConfig {
    const c: CategoryConfig = { id: 'grid', name: 'Grid', order: 0, buttons, layout: 'grid' };
    if (conditions) c.conditions = conditions;
    return c;
}

/** Slot ids as the renderer would see them for a given projection. */
function renderedSlots(categories: CategoryConfig[], categoryId = 'grid'): (string | null)[] {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return [];
    return placeButtonsOnGrid(category.buttons).slots.map((b) => b?.id ?? null);
}

describe('Case A: static grid category', () => {
    const category = staticGrid([button('a', 0, 0), button('b', 1, 2)]);

    it('always shows the same grid, whatever the context', () => {
        for (const view of ['markdown', 'pdf', 'canvas']) {
            const projection = projectCategoriesForContext(
                [category],
                context({ viewType: view }),
                'locked'
            );
            expect(renderedSlots(projection.categories).slice(0, 3)).toEqual([
                'a',
                null,
                'b',
            ]);
        }
    });

    it('preserves identity when nothing changes', () => {
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(projection.categories[0]).toBe(category);
    });
});

describe('Case B: dynamic category runtime', () => {
    const category = dynamicCategory([
        variant('md', MARKDOWN_ONLY, [button('md-1', 0, 0), button('md-2', 1, 3)]),
        variant('pdf', PDF_ONLY, [button('pdf-1', 0, 0), button('pdf-2', 1, 5)]),
        variant('default', undefined, [button('home', 0, 0)], true),
    ]);

    it('renders the first matching variant as the full grid', () => {
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(renderedSlots(projection.categories).slice(0, 6)).toEqual([
            'md-1', null, null, 'md-2', null, null,
        ]);
    });

    it('the same slot holds a different tool per variant, positions stable', () => {
        const md = renderedSlots(
            projectCategoriesForContext([category], context(), 'locked').categories
        );
        const pdf = renderedSlots(
            projectCategoriesForContext([category], context({ viewType: 'pdf' }), 'locked')
                .categories
        );
        expect(md[0]).toBe('md-1');
        expect(pdf[0]).toBe('pdf-1');
        expect(pdf[5]).toBe('pdf-2');
        expect(pdf[3]).toBeNull();
        expect(md).toHaveLength(16);
        expect(pdf).toHaveLength(16);
    });

    it('falls back to the fallback grid when nothing matches', () => {
        const projection = projectCategoriesForContext(
            [category],
            context({ viewType: 'canvas' }),
            'locked'
        );
        expect(renderedSlots(projection.categories).slice(0, 2)).toEqual(['home', null]);
        expect(projection.gridViews.get('grid')!.reason).toBe('fallback');
    });

    it('switching back restores the exact original grid', () => {
        const before = renderedSlots(
            projectCategoriesForContext([category], context(), 'locked').categories
        );
        projectCategoriesForContext([category], context({ viewType: 'pdf' }), 'locked');
        const after = renderedSlots(
            projectCategoriesForContext([category], context(), 'locked').categories
        );
        expect(after).toEqual(before);
    });

    it('hides the category when nothing matches and no fallback exists', () => {
        const noFallback = dynamicCategory([
            variant('md', MARKDOWN_ONLY, [button('md-1', 0, 0)]),
        ]);
        const projection = projectCategoriesForContext(
            [noFallback],
            context({ viewType: 'pdf' }),
            'locked'
        );
        expect(projection.categories).toEqual([]);
        expect(projection.gridViews.get('grid')!.reason).toBe('none');
    });
});

describe('Case C: category visibility condition', () => {
    it('removes the whole category in locked mode when its rule fails', () => {
        const category = staticGrid([button('a', 0, 0)], PDF_ONLY);
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(projection.categories).toEqual([]);
    });

    it('hides a dynamic category whose own rule fails even when a variant matches', () => {
        const category = dynamicCategory(
            [variant('md', MARKDOWN_ONLY, [button('a', 0, 0)])],
            PDF_ONLY
        );
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(projection.categories).toEqual([]);
    });

    it('hides a dynamic category whose active variant is empty', () => {
        const category = dynamicCategory([variant('md', MARKDOWN_ONLY, [])]);
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(projection.categories).toEqual([]);
    });
});

describe('management modes keep the full configuration', () => {
    const category = dynamicCategory([
        variant('md', MARKDOWN_ONLY, [button('md-1', 0, 0)]),
        variant('pdf', PDF_ONLY, [button('pdf-1', 0, 1)]),
    ]);

    for (const mode of ['edit'] as const) {
        it(`${mode} mode renders the first variant when nothing is selected`, () => {
            const projection = projectCategoriesForContext([category], context(), mode);

            expect(projection.categories).toHaveLength(1);
            // Identity is preserved: management modes never hand out copies.
            expect(projection.categories[0]).toBe(category);
            const view = projection.gridViews.get('grid')!;
            expect(view.reason).toBe('selected');
            expect(view.variantId).toBe('md');
            expect(view.slots[0]?.id).toBe('md-1');
        });

        it(`${mode} mode shows the SELECTED variant, whatever the context`, () => {
            const projection = projectCategoriesForContext([category], context(), mode, {
                selectedVariants: { grid: 'pdf' },
            });
            const view = projection.gridViews.get('grid')!;
            expect(view.variantId).toBe('pdf');
            expect(view.slots[1]?.id).toBe('pdf-1');
            expect(view.slots[0]).toBeNull();
        });

        it(`${mode} mode does not mark grid tools via button conditions`, () => {
            expect([
                ...projectCategoriesForContext([category], context(), mode).hiddenButtonIds,
            ]).toEqual([]);
        });

        it(`${mode} mode keeps a category with a failing visibility rule manageable`, () => {
            const conditioned = staticGrid([button('a', 0, 0)], PDF_ONLY);
            const projection = projectCategoriesForContext([conditioned], context(), mode);

            expect(projection.categories).toHaveLength(1);
            expect([...projection.hiddenCategoryIds]).toEqual(['grid']);
        });

        it(`${mode} mode falls back to the first variant for an unknown selection`, () => {
            const projection = projectCategoriesForContext([category], context(), mode, {
                selectedVariants: { grid: 'deleted-variant' },
            });
            expect(projection.gridViews.get('grid')!.variantId).toBe('md');
        });
    }
});

describe('hasConditions marker semantics', () => {
    it('reports persistent for an element without conditions', () => {
        expect(hasConditions(button('a', 0, 0))).toBe(false);
        expect(hasConditions(staticGrid([]))).toBe(false);
    });

    it('reports contextual for an element with conditions', () => {
        expect(hasConditions(staticGrid([], MARKDOWN_ONLY))).toBe(true);
    });

    it('reports contextual for configured-but-invalid conditions', () => {
        // Fails open at runtime (stays visible), but the user did configure a
        // rule, so the management UI must surface it for correction.
        const broken = { conditions: { rule: 'nonsense' } as unknown as ButtonCondition };
        expect(hasConditions(broken)).toBe(true);
    });

    it('treats an explicit null as no condition', () => {
        expect(hasConditions({ conditions: null })).toBe(false);
    });
});

describe('legacy flow categories are untouched by the grid model', () => {
    const legacy: CategoryConfig = {
        id: 'legacy',
        name: 'Legacy',
        order: 0,
        buttons: [
            { id: 'a', name: 'a', actions: [], order: 0 },
            { id: 'b', name: 'b', actions: [], order: 1, conditions: PDF_ONLY },
            { id: 'c', name: 'c', actions: [], order: 2 },
        ],
    };

    it('still closes the gap when a button is hidden (flow semantics)', () => {
        const projection = projectCategoriesForContext([legacy], context(), 'locked');
        const category = projection.categories[0]!;
        expect(category.buttons.map((b) => b.id)).toEqual(['a', 'c']);
        expect(category.layout).toBeUndefined();
    });

    it('still marks per-button conditions in management modes', () => {
        const projection = projectCategoriesForContext([legacy], context(), 'edit');
        expect([...projection.hiddenButtonIds]).toEqual(['b']);
    });

    it('preserves category identity when nothing is filtered', () => {
        const allVisible: CategoryConfig = {
            ...legacy,
            buttons: legacy.buttons.filter((b) => b.id !== 'b'),
        };
        const projection = projectCategoriesForContext([allVisible], context(), 'locked');
        expect(projection.categories[0]).toBe(allVisible);
    });
});

describe('serialization round-trip keeps slots', () => {
    it('reload reproduces exactly the same grid', () => {
        const category = dynamicCategory([
            variant('md', MARKDOWN_ONLY, [button('a', 0, 0), button('b', 1, 15)]),
            variant('default', undefined, [button('home', 0, 7)], true),
        ]);

        const before = renderedSlots(
            projectCategoriesForContext([category], context(), 'locked').categories
        );
        const reloaded = JSON.parse(JSON.stringify(category)) as CategoryConfig;

        expect(
            renderedSlots(
                projectCategoriesForContext([reloaded], context(), 'locked').categories
            )
        ).toEqual(before);
        expect(reloaded.layout).toBe('grid');
        expect(reloaded.variants![0]!.buttons.map((b) => b.slot)).toEqual([0, 15]);
    });

    it('carries no functions, so the whole category stays JSON-serializable', () => {
        const category = dynamicCategory(
            [variant('md', MARKDOWN_ONLY, [button('a', 0, 0)])],
            MARKDOWN_ONLY
        );
        expect(JSON.parse(JSON.stringify(category))).toEqual(category);
    });
});
