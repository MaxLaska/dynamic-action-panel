// Slot stability under dynamic visibility.
//
// This is the load-bearing product guarantee of the palette: a tool that is
// not part of the layer resolved for the current context leaves its slot
// EMPTY, and every other tool stays on exactly the slot it had. These tests
// drive the real projection (projectCategoriesForContext) and the real
// placement (placeButtonsOnGrid) together, because that pair is what the
// renderer actually uses.
//
// Since version 2 a palette expresses contextuality through its context
// profiles, not through per-button conditions — the guarantee is unchanged,
// the mechanism is the layer.

import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig, ContextProfile } from '@/types/settings';
import type { ButtonCondition } from '@/types/conditions';
import type { OCAPContextSnapshot } from '@/context/OCAPContext';
import { hasConditions } from '@/context/conditions';
import { projectCategoriesForContext } from '@/context/panelProjection';
import { placeButtonsOnGrid } from '@/utils/categoryGrid';
import { BASE_LAYER_ID } from '@/utils/paletteLayers';

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

function profile(
    id: string,
    conditions: ButtonCondition | undefined,
    buttons: ButtonConfig[]
): ContextProfile {
    const p: ContextProfile = { id, name: id, buttons };
    if (conditions) p.conditions = conditions;
    return p;
}

function gridCategory(
    buttons: ButtonConfig[],
    conditions?: ButtonCondition,
    contextProfiles?: ContextProfile[]
): CategoryConfig {
    const c: CategoryConfig = {
        id: 'palette',
        name: 'Palette',
        order: 0,
        buttons,
        layout: 'grid',
    };
    if (conditions) c.conditions = conditions;
    if (contextProfiles) c.contextProfiles = contextProfiles;
    return c;
}

/** Slot ids as the renderer would see them for a given projection. */
function renderedSlots(categories: CategoryConfig[], categoryId = 'palette'): (string | null)[] {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return [];
    return placeButtonsOnGrid(category.buttons).slots.map((b) => b?.id ?? null);
}

describe('Case A: pinned base tools plus one context profile', () => {
    // Base holds slots 0 and 2; the profile contributes slot 1.
    const category = gridCategory(
        [button('static-1', 0, 0), button('static-2', 1, 2)],
        undefined,
        [profile('md', MARKDOWN_ONLY, [button('dynamic', 0, 1)])]
    );

    it('shows all three when the profile matches', () => {
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(renderedSlots(projection.categories).slice(0, 3)).toEqual([
            'static-1',
            'dynamic',
            'static-2',
        ]);
    });

    it('leaves the contextual slot EMPTY when no profile matches', () => {
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

    it('does not move the pinned neighbours when the profile stops matching', () => {
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

    it('restores the tool to its exact original slot when the context returns', () => {
        const before = renderedSlots(
            projectCategoriesForContext([category], context(), 'locked').categories
        );
        projectCategoriesForContext([category], context({ viewType: 'pdf' }), 'locked');
        const after = renderedSlots(
            projectCategoriesForContext([category], context(), 'locked').categories
        );

        expect(after).toEqual(before);
        expect(after.indexOf('dynamic')).toBe(1);
    });

    it('keeps the grid at 16 cells regardless of which profile matches', () => {
        for (const view of ['markdown', 'pdf', 'canvas']) {
            const projection = projectCategoriesForContext(
                [category],
                context({ viewType: view }),
                'locked'
            );
            expect(renderedSlots(projection.categories)).toHaveLength(16);
        }
    });

    it('keeps holes stable across two competing profiles', () => {
        const mixed = gridCategory(
            [button('a', 0, 0), button('b', 1, 2), button('c', 2, 4)],
            undefined,
            [
                profile('md', MARKDOWN_ONLY, [button('md', 0, 1)]),
                profile('pdf', PDF_ONLY, [button('pdf', 0, 3)]),
            ]
        );

        expect(
            renderedSlots(
                projectCategoriesForContext([mixed], context(), 'locked').categories
            ).slice(0, 5)
        ).toEqual(['a', 'md', 'b', null, 'c']);

        expect(
            renderedSlots(
                projectCategoriesForContext([mixed], context({ viewType: 'pdf' }), 'locked')
                    .categories
            ).slice(0, 5)
        ).toEqual(['a', null, 'b', 'pdf', 'c']);
    });
});

describe('Case B: palette visibility condition', () => {
    it('removes the whole palette in locked mode when its rule fails', () => {
        const category = gridCategory([button('a', 0, 0)], PDF_ONLY);
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(projection.categories).toEqual([]);
    });

    it('renders the palette when its rule matches', () => {
        const category = gridCategory([button('a', 0, 0)], MARKDOWN_ONLY);
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(projection.categories).toHaveLength(1);
        expect(renderedSlots(projection.categories)[0]).toBe('a');
    });

    it('keeps a palette with pinned base tools visible when NO profile matches', () => {
        // The core §10 guarantee: profiles decide the contextual slots, never
        // whether the palette itself exists.
        const category = gridCategory([button('home', 0, 0)], undefined, [
            profile('pdf', PDF_ONLY, [button('pdf-tool', 0, 1)]),
        ]);
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(projection.categories).toHaveLength(1);
        expect(renderedSlots(projection.categories).slice(0, 2)).toEqual(['home', null]);
    });

    it('hides a palette that has nothing at all to offer right now', () => {
        const category = gridCategory([], undefined, [
            profile('pdf', PDF_ONLY, [button('pdf-tool', 0, 1)]),
        ]);
        expect(
            projectCategoriesForContext([category], context(), 'locked').categories
        ).toEqual([]);
    });
});

describe('Case C: palette condition plus context profiles', () => {
    const category = gridCategory([button('always', 0, 0)], MARKDOWN_ONLY, [
        profile('md', MARKDOWN_ONLY, [button('md-only', 0, 2)]),
        profile('pdf', PDF_ONLY, [button('pdf-only', 0, 3)]),
    ]);

    it('applies the first matching profile inside a visible palette', () => {
        const projection = projectCategoriesForContext([category], context(), 'locked');
        expect(renderedSlots(projection.categories).slice(0, 4)).toEqual([
            'always',
            null,
            'md-only',
            null,
        ]);
    });

    it('drops everything when the palette rule fails, whatever the profiles say', () => {
        const projection = projectCategoriesForContext(
            [category],
            context({ viewType: 'pdf' }),
            'locked'
        );
        expect(projection.categories).toEqual([]);
    });
});

describe('management modes keep the full configuration', () => {
    const category = gridCategory(
        [button('static-1', 0, 0), button('static-2', 1, 2)],
        undefined,
        [profile('pdf', PDF_ONLY, [button('dynamic', 0, 1)])]
    );

    for (const mode of ['sort', 'edit'] as const) {
        it(`${mode} mode renders the base layer by default`, () => {
            const projection = projectCategoriesForContext([category], context(), mode);

            expect(projection.categories).toHaveLength(1);
            // Identity is preserved: management modes never hand out copies.
            expect(projection.categories[0]).toBe(category);
            const palette = projection.palettes.get('palette')!;
            expect(palette.activeProfileId).toBeNull();
            expect(palette.slots.map((s) => s.button?.id ?? null).slice(0, 3)).toEqual([
                'static-1',
                null,
                'static-2',
            ]);
        });

        it(`${mode} mode shows the selected profile on top of the pinned base`, () => {
            const projection = projectCategoriesForContext([category], context(), mode, {
                selectedLayers: { palette: 'pdf' },
            });
            const palette = projection.palettes.get('palette')!;
            expect(palette.activeProfileId).toBe('pdf');
            expect(palette.slots.map((s) => s.button?.id ?? null).slice(0, 3)).toEqual([
                'static-1',
                'dynamic',
                'static-2',
            ]);
            expect(palette.slots[0]!.pinned).toBe(true);
            expect(palette.slots[1]!.pinned).toBe(false);
        });

        it(`${mode} mode does not mark palette tools via button conditions`, () => {
            expect([
                ...projectCategoriesForContext([category], context(), mode).hiddenButtonIds,
            ]).toEqual([]);
        });

        it(`${mode} mode keeps a palette with a failing visibility rule manageable`, () => {
            const conditioned = gridCategory([button('a', 0, 0)], PDF_ONLY);
            const projection = projectCategoriesForContext([conditioned], context(), mode);

            expect(projection.categories).toHaveLength(1);
            expect([...projection.hiddenCategoryIds]).toEqual(['palette']);
        });

        it(`${mode} mode falls back to the base layer for an unknown selection`, () => {
            const projection = projectCategoriesForContext([category], context(), mode, {
                selectedLayers: { palette: 'deleted-profile' },
            });
            expect(projection.palettes.get('palette')!.layerId).toBe(BASE_LAYER_ID);
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

    it('still marks per-button conditions in management modes', () => {
        const projection = projectCategoriesForContext([legacy], context(), 'sort');
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
        const category = gridCategory(
            [button('a', 0, 0), button('b', 1, 7)],
            undefined,
            [profile('md', MARKDOWN_ONLY, [button('c', 0, 15)])]
        );

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
        expect(reloaded.buttons.map((b) => b.slot)).toEqual([0, 7]);
        expect(reloaded.contextProfiles![0]!.buttons[0]!.slot).toBe(15);
    });

    it('carries no functions, so the whole palette stays JSON-serializable', () => {
        const category = gridCategory([button('a', 0, 0)], MARKDOWN_ONLY, [
            profile('md', MARKDOWN_ONLY, [button('c', 0, 15)]),
        ]);
        expect(JSON.parse(JSON.stringify(category))).toEqual(category);
    });
});
