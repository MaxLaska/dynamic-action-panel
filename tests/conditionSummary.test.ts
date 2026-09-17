import { describe, expect, it } from 'vitest';
import { summarizeCondition, summarizeVariantTrigger } from '@/utils/conditionSummary';
import type { ButtonCondition } from '@/types/conditions';

/**
 * The summary is what a user reads instead of opening the condition editor,
 * so it has to stay a single short line for every tree the editor can produce
 * — including the degenerate ones (no trigger, invalid data, always-true).
 */
describe('summarizeCondition', () => {
    it('renders the atomic rules the way the UI states them', () => {
        expect(
            summarizeCondition({ rule: 'fileName', op: 'startsWith', value: 'SRC_' })
        ).toBe('File name starts with SRC_');
        expect(summarizeCondition({ rule: 'fileName', op: 'equals', value: 'Test_A.md' })).toBe(
            'File name equals Test_A.md'
        );
        expect(summarizeCondition({ rule: 'folder', op: 'startsWith', value: 'Nodes' })).toBe(
            'Folder starts with Nodes'
        );
        expect(summarizeCondition({ rule: 'path', op: 'contains', value: 'draft' })).toBe(
            'File path contains draft'
        );
        expect(
            summarizeCondition({ rule: 'property', key: 'type', op: 'equals', value: 'Source' })
        ).toBe('Property type = Source');
        expect(summarizeCondition({ rule: 'property', key: 'type', op: 'exists' })).toBe(
            'Property type exists'
        );
        expect(summarizeCondition({ rule: 'tag', value: '#literature' })).toBe(
            'Tag #literature'
        );
        expect(summarizeCondition({ rule: 'extension', value: '.md' })).toBe('Extension .md');
        expect(summarizeCondition({ rule: 'viewType', value: 'canvas' })).toBe(
            'View type canvas'
        );
    });

    it('unwraps a single-child group — it adds no meaning', () => {
        expect(summarizeCondition({ all: [{ rule: 'tag', value: 'x' }] })).toBe('Tag #x');
        expect(summarizeCondition({ any: [{ rule: 'tag', value: 'x' }] })).toBe('Tag #x');
    });

    it('joins ALL with + and ANY with /', () => {
        const all: ButtonCondition = {
            all: [
                { rule: 'property', key: 'type', op: 'equals', value: 'Source' },
                { rule: 'tag', value: 'literature' },
            ],
        };
        expect(summarizeCondition(all)).toBe(
            'ALL: Property type = Source + Tag #literature'
        );

        const any: ButtonCondition = {
            any: [
                { rule: 'extension', value: 'md' },
                { rule: 'extension', value: 'pdf' },
            ],
        };
        expect(summarizeCondition(any)).toBe('ANY: Extension .md / Extension .pdf');
    });

    it('negates and nests without inventing a full syntax', () => {
        expect(summarizeCondition({ not: { rule: 'tag', value: 'draft' } })).toBe(
            'NOT Tag #draft'
        );
        expect(
            summarizeCondition({
                all: [
                    { rule: 'viewType', value: 'markdown' },
                    { any: [{ rule: 'tag', value: 'a' }, { rule: 'tag', value: 'b' }] },
                ],
            })
        ).toBe('ALL: View type markdown + ANY: Tag #a / Tag #b');
    });

    it('collapses a long child list instead of growing without bound', () => {
        const many: ButtonCondition = {
            all: [
                { rule: 'tag', value: 'a' },
                { rule: 'tag', value: 'b' },
                { rule: 'tag', value: 'c' },
                { rule: 'tag', value: 'd' },
                { rule: 'tag', value: 'e' },
            ],
        };
        expect(summarizeCondition(many)).toBe('ALL: Tag #a + Tag #b + Tag #c + +2 more');
    });

    it('stays one short line even for a pathological value', () => {
        const summary = summarizeCondition({
            rule: 'path',
            op: 'contains',
            value: 'x'.repeat(500),
        });
        expect(summary.length).toBeLessThanOrEqual(120);
        expect(summary.endsWith('…')).toBe(true);
    });

    it('names an empty value rather than rendering nothing', () => {
        expect(summarizeCondition({ rule: 'fileName', op: 'startsWith', value: '' })).toBe(
            'File name starts with (empty)'
        );
    });

    it('states the two empty groups by their actual semantics', () => {
        expect(summarizeCondition({ all: [] })).toBe('Always matches');
        expect(summarizeCondition({ any: [] })).toBe('Never matches');
    });
});

describe('summarizeVariantTrigger', () => {
    it('describes the fallback without pretending it has a rule', () => {
        const result = summarizeVariantTrigger({ fallback: true });
        expect(result.state).toBe('fallback');
        expect(result.broken).toBe(false);
    });

    it('flags a variant that can never be selected', () => {
        expect(summarizeVariantTrigger({}).state).toBe('missing');
        expect(summarizeVariantTrigger({}).broken).toBe(true);

        const invalid = summarizeVariantTrigger({
            trigger: { rule: 'property' } as unknown as ButtonCondition,
        });
        expect(invalid.state).toBe('invalid');
        expect(invalid.broken).toBe(true);
    });

    it('separates the explicit always-true trigger from a real rule', () => {
        expect(summarizeVariantTrigger({ trigger: { all: [] } }).state).toBe('always');

        const real = summarizeVariantTrigger({
            trigger: { all: [{ rule: 'fileName', op: 'startsWith', value: 'A_' }] },
        });
        expect(real.state).toBe('rule');
        expect(real.summary).toBe('File name starts with A_');
        expect(real.broken).toBe(false);
    });

    it('a fallback flag wins over any trigger data left on the variant', () => {
        const result = summarizeVariantTrigger({
            fallback: true,
            trigger: { rule: 'tag', value: 'x' },
        });
        expect(result.state).toBe('fallback');
    });
});
