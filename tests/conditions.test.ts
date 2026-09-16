import { describe, expect, it } from 'vitest';
import {
    collectContextHiddenButtonIds,
    evaluateCondition,
    filterCategoriesByContext,
    isButtonVisibleInContext,
    isValidCondition,
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

    it('keeps a category whose buttons are all hidden', () => {
        const onlyPdf: CategoryConfig[] = [
            { id: 'c', name: 'C', order: 0, buttons: [pdfButton] },
        ];
        const result = filterCategoriesByContext(onlyPdf, markdownContext);
        expect(result).toHaveLength(1);
        expect(result[0]!.buttons).toEqual([]);
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
