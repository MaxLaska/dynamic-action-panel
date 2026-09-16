// Slot stability under dynamic visibility.
//
// This is the load-bearing product guarantee of the palette: a button hidden
// by its context rule must leave its slot EMPTY, and every other button must
// stay on exactly the slot it had. These tests drive the real projection
// (projectCategoriesForContext) and the real placement (placeButtonsOnGrid)
// together, because that pair is what the renderer actually uses.

import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig } from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import type { OCAPContextSnapshot } from '@/context/OCAPContext';
import {
    hasConditions,
    projectCategoriesForContext,
} from '@/context/conditions';
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

function button(
    id: string,
    order: number,
    slot: number,
    conditions?: ButtonCondition
): ButtonConfig {
    const b: ButtonConfig = { id, name: id, actions: [], order, slot };
    if (conditions) b.conditions = conditions;
    return b;
}

const MARKDOWN_ONLY: ButtonCondition = { rule: 'viewType', value: 'markdown' };
const PDF_ONLY: ButtonCondition = { rule: 'viewType', value: 'pdf' };

function gridCategory(buttons: ButtonConfig[], conditions?: ButtonCondition): CategoryConfig {
    const c: CategoryConfig = {
        id: 'palette',
        name: 'Palette',
        order: 0,
        buttons,
        layout: 'grid',
    };
    if (conditions) c.conditions = conditions;
    return c;
}

/** Slot ids as the renderer would see them for a given projection. */
function renderedSlots(categories: CategoryConfig[], categoryId = 'palette'): (string | null)[] {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return [];
    return placeButtonsOnGrid(category.buttons).slots.map((b) => b?.id ?? null);
}

describe('Case A: static category, one dynamic button among static ones', () => {
    // Slot 0 static, slot 1 dynamic, slot 2 static.
    const category = gridCategory([
        button('static-1', 0, 0),
        button('dynamic', 1, 1, MARKDOWN_ONLY),
        button('static-2', 2, 2),
    ]);

    it('shows all three when the rule matches', () => {
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(renderedSlots(projection.categories).slice(0, 3)).toEqual([
            'static-1',
            'dynamic',
            'static-2',
        ]);
    });

    it('leaves the dynamic button slot EMPTY when the rule fails', () => {
        const projection = projectCategoriesForContext(
            [category],
            context({ viewType: 'pdf' }),
            'locked'
        );
        expect(renderedSlots(projection.categories).slice(0, 3)).toEqual([
            'static-1',
            null,
            'static-2',
        ]);
    });

    it('does not move the neighbours when the dynamic button disappears', () => {
        const visible = renderedSlots(
            projectCategoriesForContext([category], context(), 'locked').categories
        );
        const hidden = renderedSlots(
            projectCategoriesForContext([category], context({ viewType: 'pdf' }), 'locked')
                .categories
        );

        expect(hidden.indexOf('static-1')).toBe(visible.indexOf('static-1'));
        expect(hidden.indexOf('static-2')).toBe(visible.indexOf('static-2'));
    });

    it('restores the button to its exact original slot when the context returns', () => {
        const before = renderedSlots(
            projectCategoriesForContext([category], context(), 'locked').categories
        );
        // hide ...
        projectCategoriesForContext([category], context({ viewType: 'pdf' }), 'locked');
        // ... and come back
        const after = renderedSlots(
            projectCategoriesForContext([category], context(), 'locked').categories
        );

        expect(after).toEqual(before);
        expect(after.indexOf('dynamic')).toBe(1);
    });

    it('keeps the grid at 16 cells regardless of how many buttons are hidden', () => {
        for (const view of ['markdown', 'pdf', 'canvas']) {
            const projection = projectCategoriesForContext(
                [category],
                context({ viewType: view }),
                'locked'
            );
            expect(renderedSlots(projection.categories)).toHaveLength(16);
        }
    });

    it('keeps holes stable with several dynamic buttons', () => {
        const mixed = gridCategory([
            button('a', 0, 0),
            button('md', 1, 1, MARKDOWN_ONLY),
            button('b', 2, 2),
            button('pdf', 3, 3, PDF_ONLY),
            button('c', 4, 4),
        ]);

        const projection = projectCategoriesForContext([mixed], context(), 'locked');
        expect(renderedSlots(projection.categories).slice(0, 5)).toEqual([
            'a',
            'md',
            'b',
            null,
            'c',
        ]);
    });
});

describe('Case B: dynamic category', () => {
    it('removes the whole category in locked mode when its rule fails', () => {
        const category = gridCategory([button('a', 0, 0)], PDF_ONLY);
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(projection.categories).toEqual([]);
    });

    it('renders the category when its rule matches', () => {
        const category = gridCategory([button('a', 0, 0)], MARKDOWN_ONLY);
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(projection.categories).toHaveLength(1);
        expect(renderedSlots(projection.categories)[0]).toBe('a');
    });
});

describe('Case C: dynamic category plus dynamic buttons', () => {
    const category = gridCategory(
        [
            button('always', 0, 0),
            button('md-only', 1, 2, MARKDOWN_ONLY),
            button('pdf-only', 2, 3, PDF_ONLY),
        ],
        MARKDOWN_ONLY
    );

    it('applies the button rules inside a visible category', () => {
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(renderedSlots(projection.categories).slice(0, 4)).toEqual([
            'always',
            null,
            'md-only',
            null,
        ]);
    });

    it('drops everything when the category rule fails, whatever the buttons say', () => {
        const projection = projectCategoriesForContext(
            [category],
            context({ viewType: 'pdf' }),
            'locked'
        );
        expect(projection.categories).toEqual([]);
    });
});

describe('management modes keep the full configuration', () => {
    const category = gridCategory([
        button('static-1', 0, 0),
        button('dynamic', 1, 1, PDF_ONLY),
        button('static-2', 2, 2),
    ]);

    for (const mode of ['sort', 'edit'] as const) {
        it(`${mode} mode renders every configured button on its slot`, () => {
            const projection = projectCategoriesForContext([category], context(), mode);

            expect(projection.categories).toHaveLength(1);
            expect(renderedSlots(projection.categories).slice(0, 3)).toEqual([
                'static-1',
                'dynamic',
                'static-2',
            ]);
        });

        it(`${mode} mode marks the non-matching button instead of hiding it`, () => {
            const projection = projectCategoriesForContext([category], context(), mode);
            expect([...projection.hiddenButtonIds]).toEqual(['dynamic']);
        });

        it(`${mode} mode keeps a category with a failing rule manageable`, () => {
            const conditioned = gridCategory([button('a', 0, 0)], PDF_ONLY);
            const projection = projectCategoriesForContext([conditioned], context(), mode);

            expect(projection.categories).toHaveLength(1);
            expect([...projection.hiddenCategoryIds]).toEqual(['palette']);
        });
    }
});

describe('hasConditions marker semantics', () => {
    it('reports persistent for an element without conditions', () => {
        expect(hasConditions(button('a', 0, 0))).toBe(false);
        expect(hasConditions(gridCategory([]))).toBe(false);
    });

    it('reports contextual for an element with conditions', () => {
        expect(hasConditions(button('a', 0, 0, MARKDOWN_ONLY))).toBe(true);
        expect(hasConditions(gridCategory([], MARKDOWN_ONLY))).toBe(true);
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

describe('legacy flow categories are untouched by the palette', () => {
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
        const category = gridCategory([
            button('a', 0, 0),
            button('b', 1, 7),
            button('c', 2, 15, MARKDOWN_ONLY),
        ]);

        const before = renderedSlots([category]);
        const reloaded = JSON.parse(JSON.stringify(category)) as CategoryConfig;

        expect(renderedSlots([reloaded])).toEqual(before);
        expect(reloaded.layout).toBe('grid');
        expect(reloaded.buttons.map((b) => b.slot)).toEqual([0, 7, 15]);
    });
});
