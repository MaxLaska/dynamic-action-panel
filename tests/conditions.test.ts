import { describe, expect, it } from 'vitest';
import {
    collectContextHiddenButtonIds,
    collectContextHiddenCategoryIds,
    evaluateCondition,
    filterCategoriesByContext,
    isButtonVisibleInContext,
    isCategoryVisibleInContext,
    isValidCondition,
    projectCategoriesForContext,
} from '@/context/conditions';
import { buildContextSnapshot, EMPTY_OCAP_CONTEXT } from '@/context/OCAPContext';
import type { ButtonCondition } from '@/types/conditions';
import type { ButtonConfig, CategoryConfig } from '@/types/settings';

const markdownContext = buildContextSnapshot({
    viewType: 'markdown',
    filePath: 'Projects/OCAP/Notes.md',
    cache: {
        frontmatter: {
            status: 'In Progress',
            priority: 2,
            done: false,
            empty: null,
            aliases: ['alias-a', 'alias-b'],
        },
        tags: [{ tag: '#project/ocap' }, { tag: '#Review' }],
    },
});

const pdfContext = buildContextSnapshot({
    viewType: 'pdf',
    filePath: 'Papers/Study.pdf',
    cache: null,
});

function makeButton(id: string, conditions?: ButtonCondition): ButtonConfig {
    const button: ButtonConfig = { id, name: id, actions: [], order: 0 };
    if (conditions !== undefined) {
        button.conditions = conditions;
    }
    return button;
}

function makeCategory(
    id: string,
    buttons: ButtonConfig[],
    conditions?: ButtonCondition
): CategoryConfig {
    const category: CategoryConfig = { id, name: id, order: 0, buttons };
    if (conditions !== undefined) {
        category.conditions = conditions;
    }
    return category;
}

describe('isValidCondition', () => {
    it('accepts atomic rules', () => {
        expect(isValidCondition({ rule: 'viewType', value: 'markdown' })).toBe(true);
        expect(isValidCondition({ rule: 'path', op: 'startsWith', value: 'a/' })).toBe(true);
        expect(isValidCondition({ rule: 'folder', op: 'equals', value: 'a' })).toBe(true);
        expect(isValidCondition({ rule: 'extension', value: 'md' })).toBe(true);
        expect(isValidCondition({ rule: 'property', key: 'status', op: 'exists' })).toBe(true);
        expect(
            isValidCondition({ rule: 'property', key: 'status', op: 'equals', value: 'done' })
        ).toBe(true);
        expect(isValidCondition({ rule: 'tag', value: 'project' })).toBe(true);
    });

    it('accepts groups and nesting', () => {
        expect(
            isValidCondition({
                all: [
                    { rule: 'viewType', value: 'markdown' },
                    { any: [{ rule: 'tag', value: 'a' }, { not: { rule: 'extension', value: 'pdf' } }] },
                ],
            })
        ).toBe(true);
        expect(isValidCondition({ all: [] })).toBe(true);
        expect(isValidCondition({ any: [] })).toBe(true);
    });

    it('rejects invalid data', () => {
        expect(isValidCondition(null)).toBe(false);
        expect(isValidCondition(undefined)).toBe(false);
        expect(isValidCondition('viewType')).toBe(false);
        expect(isValidCondition(42)).toBe(false);
        expect(isValidCondition([])).toBe(false);
        expect(isValidCondition({})).toBe(false);
        expect(isValidCondition({ rule: 'unknown', value: 'x' })).toBe(false);
        expect(isValidCondition({ rule: 'viewType' })).toBe(false);
        expect(isValidCondition({ rule: 'viewType', value: 7 })).toBe(false);
        expect(isValidCondition({ rule: 'path', op: 'matches', value: 'a' })).toBe(false);
        expect(isValidCondition({ rule: 'folder', op: 'contains', value: 'a' })).toBe(false);
        expect(isValidCondition({ rule: 'property', key: '', op: 'exists' })).toBe(false);
        expect(isValidCondition({ rule: 'property', key: 'k', op: 'equals' })).toBe(false);
        expect(
            isValidCondition({ rule: 'property', key: 'k', op: 'exists', value: 'stray' })
        ).toBe(false);
        expect(isValidCondition({ all: [{ rule: 'nope' }] })).toBe(false);
        expect(isValidCondition({ all: 'not-an-array' })).toBe(false);
        expect(isValidCondition({ not: null })).toBe(false);
        expect(isValidCondition({ all: [], any: [] })).toBe(false);
        expect(isValidCondition({ all: [], rule: 'viewType', value: 'x' })).toBe(false);
    });

    it('rejects self-referential structures instead of overflowing', () => {
        const cyclic: Record<string, unknown> = { not: null };
        cyclic['not'] = cyclic;
        expect(isValidCondition(cyclic)).toBe(false);
    });
});

describe('evaluateCondition – atomic rules', () => {
    it('viewType matches case-insensitively', () => {
        expect(
            evaluateCondition({ rule: 'viewType', value: 'markdown' }, markdownContext)
        ).toBe(true);
        expect(
            evaluateCondition({ rule: 'viewType', value: 'Markdown' }, markdownContext)
        ).toBe(true);
        expect(evaluateCondition({ rule: 'viewType', value: 'pdf' }, markdownContext)).toBe(
            false
        );
        expect(evaluateCondition({ rule: 'viewType', value: 'pdf' }, pdfContext)).toBe(true);
    });

    it('viewType is false for the empty context', () => {
        expect(
            evaluateCondition({ rule: 'viewType', value: 'markdown' }, EMPTY_OCAP_CONTEXT)
        ).toBe(false);
    });

    it('path equals / startsWith / contains (case-insensitive, slash-tolerant)', () => {
        expect(
            evaluateCondition(
                { rule: 'path', op: 'equals', value: 'projects/ocap/notes.md' },
                markdownContext
            )
        ).toBe(true);
        expect(
            evaluateCondition(
                { rule: 'path', op: 'startsWith', value: '/Projects/' },
                markdownContext
            )
        ).toBe(true);
        expect(
            evaluateCondition({ rule: 'path', op: 'contains', value: 'OCAP' }, markdownContext)
        ).toBe(true);
        expect(
            evaluateCondition({ rule: 'path', op: 'startsWith', value: 'Papers' }, markdownContext)
        ).toBe(false);
    });

    it('path rules are false without a file', () => {
        expect(
            evaluateCondition({ rule: 'path', op: 'contains', value: '' }, EMPTY_OCAP_CONTEXT)
        ).toBe(false);
    });

    it('folder equals and segment-aware startsWith', () => {
        expect(
            evaluateCondition(
                { rule: 'folder', op: 'equals', value: 'Projects/OCAP' },
                markdownContext
            )
        ).toBe(true);
        expect(
            evaluateCondition({ rule: 'folder', op: 'startsWith', value: 'Projects' }, markdownContext)
        ).toBe(true);
        // Segment-aware: 'Proj' must not match 'Projects'.
        expect(
            evaluateCondition({ rule: 'folder', op: 'startsWith', value: 'Proj' }, markdownContext)
        ).toBe(false);
        // Empty prefix matches everything with a file.
        expect(
            evaluateCondition({ rule: 'folder', op: 'startsWith', value: '' }, markdownContext)
        ).toBe(true);
        expect(
            evaluateCondition({ rule: 'folder', op: 'equals', value: '' }, markdownContext)
        ).toBe(false);
    });

    it('folder rules are false without a file', () => {
        expect(
            evaluateCondition({ rule: 'folder', op: 'startsWith', value: '' }, EMPTY_OCAP_CONTEXT)
        ).toBe(false);
    });

    it('extension matches with or without leading dot, case-insensitive', () => {
        expect(evaluateCondition({ rule: 'extension', value: 'md' }, markdownContext)).toBe(true);
        expect(evaluateCondition({ rule: 'extension', value: '.MD' }, markdownContext)).toBe(true);
        expect(evaluateCondition({ rule: 'extension', value: 'pdf' }, markdownContext)).toBe(false);
        expect(evaluateCondition({ rule: 'extension', value: 'pdf' }, pdfContext)).toBe(true);
    });

    it('property exists', () => {
        expect(
            evaluateCondition({ rule: 'property', key: 'status', op: 'exists' }, markdownContext)
        ).toBe(true);
        // Present-but-empty properties still exist.
        expect(
            evaluateCondition({ rule: 'property', key: 'empty', op: 'exists' }, markdownContext)
        ).toBe(true);
        expect(
            evaluateCondition({ rule: 'property', key: 'missing', op: 'exists' }, markdownContext)
        ).toBe(false);
        expect(
            evaluateCondition({ rule: 'property', key: 'status', op: 'exists' }, EMPTY_OCAP_CONTEXT)
        ).toBe(false);
    });

    it('property equals with loose scalar comparison', () => {
        expect(
            evaluateCondition(
                { rule: 'property', key: 'status', op: 'equals', value: 'in progress' },
                markdownContext
            )
        ).toBe(true);
        expect(
            evaluateCondition(
                { rule: 'property', key: 'priority', op: 'equals', value: 2 },
                markdownContext
            )
        ).toBe(true);
        expect(
            evaluateCondition(
                { rule: 'property', key: 'priority', op: 'equals', value: '2' },
                markdownContext
            )
        ).toBe(true);
        expect(
            evaluateCondition(
                { rule: 'property', key: 'done', op: 'equals', value: false },
                markdownContext
            )
        ).toBe(true);
        expect(
            evaluateCondition(
                { rule: 'property', key: 'status', op: 'equals', value: 'done' },
                markdownContext
            )
        ).toBe(false);
        expect(
            evaluateCondition(
                { rule: 'property', key: 'missing', op: 'equals', value: 'x' },
                markdownContext
            )
        ).toBe(false);
        // Null-valued properties never equal a scalar.
        expect(
            evaluateCondition(
                { rule: 'property', key: 'empty', op: 'equals', value: 'null' },
                markdownContext
            )
        ).toBe(false);
    });

    it('property equals matches any entry of list properties', () => {
        expect(
            evaluateCondition(
                { rule: 'property', key: 'aliases', op: 'equals', value: 'alias-b' },
                markdownContext
            )
        ).toBe(true);
        expect(
            evaluateCondition(
                { rule: 'property', key: 'aliases', op: 'equals', value: 'alias-c' },
                markdownContext
            )
        ).toBe(false);
    });

    it('tag matches case-insensitively including nested tags and leading #', () => {
        expect(evaluateCondition({ rule: 'tag', value: 'review' }, markdownContext)).toBe(true);
        expect(evaluateCondition({ rule: 'tag', value: '#Review' }, markdownContext)).toBe(true);
        expect(evaluateCondition({ rule: 'tag', value: 'project' }, markdownContext)).toBe(true);
        expect(evaluateCondition({ rule: 'tag', value: 'project/ocap' }, markdownContext)).toBe(
            true
        );
        expect(evaluateCondition({ rule: 'tag', value: 'project/other' }, markdownContext)).toBe(
            false
        );
        // Prefix must be segment-aware: 'proj' is not 'project'.
        expect(evaluateCondition({ rule: 'tag', value: 'proj' }, markdownContext)).toBe(false);
        expect(evaluateCondition({ rule: 'tag', value: 'review' }, EMPTY_OCAP_CONTEXT)).toBe(
            false
        );
        expect(evaluateCondition({ rule: 'tag', value: '  ' }, markdownContext)).toBe(false);
    });
});

describe('evaluateCondition – groups', () => {
    const isMarkdown: ButtonCondition = { rule: 'viewType', value: 'markdown' };
    const isPdf: ButtonCondition = { rule: 'viewType', value: 'pdf' };

    it('all', () => {
        expect(
            evaluateCondition(
                { all: [isMarkdown, { rule: 'tag', value: 'review' }] },
                markdownContext
            )
        ).toBe(true);
        expect(evaluateCondition({ all: [isMarkdown, isPdf] }, markdownContext)).toBe(false);
        // Empty all holds.
        expect(evaluateCondition({ all: [] }, markdownContext)).toBe(true);
    });

    it('any', () => {
        expect(evaluateCondition({ any: [isPdf, isMarkdown] }, markdownContext)).toBe(true);
        expect(
            evaluateCondition({ any: [isPdf, { rule: 'tag', value: 'nope' }] }, markdownContext)
        ).toBe(false);
        // Empty any does not hold.
        expect(evaluateCondition({ any: [] }, markdownContext)).toBe(false);
    });

    it('not', () => {
        expect(evaluateCondition({ not: isPdf }, markdownContext)).toBe(true);
        expect(evaluateCondition({ not: isMarkdown }, markdownContext)).toBe(false);
    });

    it('nested groups', () => {
        const nested: ButtonCondition = {
            all: [
                isMarkdown,
                {
                    any: [
                        { rule: 'folder', op: 'startsWith', value: 'Archive' },
                        { not: { rule: 'property', key: 'status', op: 'equals', value: 'done' } },
                    ],
                },
            ],
        };
        expect(evaluateCondition(nested, markdownContext)).toBe(true);
        expect(evaluateCondition(nested, pdfContext)).toBe(false);
    });
});

describe('isButtonVisibleInContext', () => {
    it('buttons without conditions are always visible (static behavior)', () => {
        expect(isButtonVisibleInContext(makeButton('b'), markdownContext)).toBe(true);
        expect(isButtonVisibleInContext(makeButton('b'), EMPTY_OCAP_CONTEXT)).toBe(true);
    });

    it('applies valid conditions', () => {
        const button = makeButton('b', { rule: 'viewType', value: 'markdown' });
        expect(isButtonVisibleInContext(button, markdownContext)).toBe(true);
        expect(isButtonVisibleInContext(button, pdfContext)).toBe(false);
    });

    it('fails open for invalid condition data', () => {
        const button = makeButton('b');
        (button as unknown as Record<string, unknown>)['conditions'] = {
            rule: 'no-such-rule',
        };
        expect(isButtonVisibleInContext(button, markdownContext)).toBe(true);

        (button as unknown as Record<string, unknown>)['conditions'] = 'garbage';
        expect(isButtonVisibleInContext(button, markdownContext)).toBe(true);

        (button as unknown as Record<string, unknown>)['conditions'] = null;
        expect(isButtonVisibleInContext(button, markdownContext)).toBe(true);
    });
});

describe('filterCategoriesByContext', () => {
    const staticButton = makeButton('static');
    const mdButton = makeButton('md-only', { rule: 'viewType', value: 'markdown' });
    const pdfButton = makeButton('pdf-only', { rule: 'viewType', value: 'pdf' });

    const categories: CategoryConfig[] = [
        { id: 'c1', name: 'Mixed', order: 0, buttons: [staticButton, mdButton, pdfButton] },
        { id: 'c2', name: 'Static only', order: 1, buttons: [staticButton] },
    ];

    it('filters context-hidden buttons and keeps static ones', () => {
        const result = filterCategoriesByContext(categories, markdownContext);
        expect(result[0]!.buttons.map((b) => b.id)).toEqual(['static', 'md-only']);
        expect(result[1]!.buttons.map((b) => b.id)).toEqual(['static']);
    });

    it('preserves array and category identity when nothing is filtered', () => {
        const allStatic: CategoryConfig[] = [
            { id: 'c', name: 'C', order: 0, buttons: [staticButton] },
        ];
        expect(filterCategoriesByContext(allStatic, EMPTY_OCAP_CONTEXT)).toBe(allStatic);

        // With conditions matching, category objects stay identical too.
        const result = filterCategoriesByContext(categories, markdownContext);
        expect(result[1]).toBe(categories[1]);
        expect(result[0]).not.toBe(categories[0]);
    });

    it('drops a category whose buttons are all hidden (phase 3 semantics)', () => {
        const onlyPdf: CategoryConfig[] = [
            { id: 'c', name: 'C', order: 0, buttons: [pdfButton] },
        ];
        expect(filterCategoriesByContext(onlyPdf, markdownContext)).toHaveLength(0);
    });

    it('drops a category without any buttons in locked mode', () => {
        const empty: CategoryConfig[] = [makeCategory('c', [])];
        expect(filterCategoriesByContext(empty, markdownContext)).toHaveLength(0);
    });

    it('drops a category whose own condition does not hold, even with visible buttons', () => {
        const cats: CategoryConfig[] = [
            makeCategory('c', [staticButton], { rule: 'viewType', value: 'pdf' }),
        ];
        expect(filterCategoriesByContext(cats, markdownContext)).toHaveLength(0);
        // Same category matches in the pdf context.
        expect(filterCategoriesByContext(cats, pdfContext)).toHaveLength(1);
    });

    it('keeps a matching category with at least one visible button', () => {
        const cats: CategoryConfig[] = [
            makeCategory('c', [pdfButton, staticButton], {
                rule: 'viewType',
                value: 'markdown',
            }),
        ];
        const result = filterCategoriesByContext(cats, markdownContext);
        expect(result).toHaveLength(1);
        expect(result[0]!.buttons.map((b) => b.id)).toEqual(['static']);
    });

    it('drops a matching category whose buttons are all hidden', () => {
        const cats: CategoryConfig[] = [
            makeCategory('c', [pdfButton], { rule: 'viewType', value: 'markdown' }),
        ];
        expect(filterCategoriesByContext(cats, markdownContext)).toHaveLength(0);
    });

    it('applies nested category conditions', () => {
        const nested: ButtonCondition = {
            all: [
                { rule: 'viewType', value: 'markdown' },
                { any: [{ rule: 'tag', value: 'project' }, { rule: 'tag', value: 'nope' }] },
                { not: { rule: 'property', key: 'status', op: 'equals', value: 'done' } },
            ],
        };
        const cats: CategoryConfig[] = [makeCategory('c', [staticButton], nested)];
        expect(filterCategoriesByContext(cats, markdownContext)).toHaveLength(1);
        expect(filterCategoriesByContext(cats, pdfContext)).toHaveLength(0);
    });

    it('keeps static categories with static buttons untouched (identity preserved)', () => {
        const cats: CategoryConfig[] = [
            makeCategory('a', [staticButton]),
            makeCategory('b', [makeButton('other')]),
        ];
        expect(filterCategoriesByContext(cats, markdownContext)).toBe(cats);
        expect(filterCategoriesByContext(cats, EMPTY_OCAP_CONTEXT)).toBe(cats);
    });

    it('fails open for invalid category condition data', () => {
        const category = makeCategory('c', [staticButton]);
        (category as unknown as Record<string, unknown>)['conditions'] = {
            rule: 'no-such-rule',
        };
        expect(filterCategoriesByContext([category], markdownContext)).toHaveLength(1);
    });
});

describe('isCategoryVisibleInContext', () => {
    it('categories without conditions are always visible', () => {
        expect(isCategoryVisibleInContext(makeCategory('c', []), markdownContext)).toBe(true);
        expect(isCategoryVisibleInContext(makeCategory('c', []), EMPTY_OCAP_CONTEXT)).toBe(
            true
        );
    });

    it('applies valid conditions', () => {
        const category = makeCategory('c', [], { rule: 'viewType', value: 'markdown' });
        expect(isCategoryVisibleInContext(category, markdownContext)).toBe(true);
        expect(isCategoryVisibleInContext(category, pdfContext)).toBe(false);
    });

    it('fails open for invalid condition data', () => {
        const category = makeCategory('c', []);
        (category as unknown as Record<string, unknown>)['conditions'] = 'garbage';
        expect(isCategoryVisibleInContext(category, markdownContext)).toBe(true);
        (category as unknown as Record<string, unknown>)['conditions'] = null;
        expect(isCategoryVisibleInContext(category, markdownContext)).toBe(true);
    });
});

describe('collectContextHiddenCategoryIds', () => {
    it('collects exactly the categories whose own condition fails', () => {
        const categories: CategoryConfig[] = [
            makeCategory('static', [makeButton('b1')]),
            makeCategory('md', [makeButton('b2')], { rule: 'viewType', value: 'markdown' }),
            makeCategory('pdf', [makeButton('b3')], { rule: 'viewType', value: 'pdf' }),
            // All buttons hidden, but own condition holds: not marked.
            makeCategory('empty-by-buttons', [
                makeButton('b4', { rule: 'viewType', value: 'pdf' }),
            ]),
        ];
        const hidden = collectContextHiddenCategoryIds(categories, markdownContext);
        expect([...hidden]).toEqual(['pdf']);
    });
});

describe('projectCategoriesForContext', () => {
    const staticButton = makeButton('static');
    const pdfButton = makeButton('pdf-only', { rule: 'viewType', value: 'pdf' });
    const categories: CategoryConfig[] = [
        makeCategory('plain', [staticButton, pdfButton]),
        makeCategory('pdf-cat', [makeButton('x')], { rule: 'viewType', value: 'pdf' }),
    ];

    it('locked mode filters and marks nothing', () => {
        const projection = projectCategoriesForContext(
            categories,
            markdownContext,
            'locked'
        );
        expect(projection.categories.map((c) => c.id)).toEqual(['plain']);
        expect(projection.categories[0]!.buttons.map((b) => b.id)).toEqual(['static']);
        expect(projection.hiddenButtonIds.size).toBe(0);
        expect(projection.hiddenCategoryIds.size).toBe(0);
    });

    it('sort mode keeps everything (same reference) and marks hidden elements', () => {
        const projection = projectCategoriesForContext(categories, markdownContext, 'sort');
        expect(projection.categories).toBe(categories);
        expect([...projection.hiddenButtonIds]).toEqual(['pdf-only']);
        expect([...projection.hiddenCategoryIds]).toEqual(['pdf-cat']);
    });

    it('edit mode behaves like sort mode', () => {
        const projection = projectCategoriesForContext(categories, markdownContext, 'edit');
        expect(projection.categories).toBe(categories);
        expect([...projection.hiddenButtonIds]).toEqual(['pdf-only']);
        expect([...projection.hiddenCategoryIds]).toEqual(['pdf-cat']);
    });

    it('is fully static-compatible: phase-2 settings without category conditions', () => {
        const legacy: CategoryConfig[] = [
            makeCategory('a', [staticButton]),
            makeCategory('b', [makeButton('md', { rule: 'viewType', value: 'markdown' })]),
        ];
        const locked = projectCategoriesForContext(legacy, markdownContext, 'locked');
        expect(locked.categories).toBe(legacy);
        const sort = projectCategoriesForContext(legacy, markdownContext, 'sort');
        expect(sort.categories).toBe(legacy);
        expect(sort.hiddenButtonIds.size).toBe(0);
        expect(sort.hiddenCategoryIds.size).toBe(0);
    });
});

describe('collectContextHiddenButtonIds', () => {
    it('collects exactly the hidden ids', () => {
        const categories: CategoryConfig[] = [
            {
                id: 'c1',
                name: 'C1',
                order: 0,
                buttons: [
                    makeButton('static'),
                    makeButton('md-only', { rule: 'viewType', value: 'markdown' }),
                    makeButton('pdf-only', { rule: 'viewType', value: 'pdf' }),
                ],
            },
        ];
        const hidden = collectContextHiddenButtonIds(categories, markdownContext);
        expect([...hidden]).toEqual(['pdf-only']);
    });
});
