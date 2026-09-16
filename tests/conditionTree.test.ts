import { describe, expect, it } from 'vitest';
import {
    addChildAtPath,
    conditionDepth,
    convertRuleKind,
    createDefaultRule,
    getConditionKind,
    getGroupChildren,
    getNodeAtPath,
    isConditionGroup,
    removeNodeAtPath,
    replaceNodeAtPath,
    setGroupKindAtPath,
} from '@/context/conditionTree';
import { isValidCondition } from '@/context/conditions';
import type { ButtonCondition, ConditionRule } from '@/types/conditions';

const ruleA: ConditionRule = { rule: 'viewType', value: 'markdown' };
const ruleB: ConditionRule = { rule: 'tag', value: 'project' };
const ruleC: ConditionRule = { rule: 'extension', value: 'md' };

describe('conditionTree basics', () => {
    it('classifies nodes', () => {
        expect(getConditionKind({ all: [] })).toBe('all');
        expect(getConditionKind({ any: [] })).toBe('any');
        expect(getConditionKind({ not: ruleA })).toBe('not');
        expect(getConditionKind(ruleA)).toBe('rule');
        expect(isConditionGroup(ruleA)).toBe(false);
        expect(isConditionGroup({ not: ruleA })).toBe(true);
    });

    it('exposes not-children as a single-element list', () => {
        expect(getGroupChildren({ not: ruleA })).toEqual([ruleA]);
        expect(getGroupChildren({ all: [ruleA, ruleB] })).toEqual([ruleA, ruleB]);
    });

    it('resolves nodes by path', () => {
        const tree: ButtonCondition = { all: [ruleA, { any: [ruleB, { not: ruleC }] }] };
        expect(getNodeAtPath(tree, [])).toBe(tree);
        expect(getNodeAtPath(tree, [0])).toBe(ruleA);
        expect(getNodeAtPath(tree, [1, 1])).toEqual({ not: ruleC });
        expect(getNodeAtPath(tree, [1, 1, 0])).toBe(ruleC);
        expect(getNodeAtPath(tree, [5])).toBeUndefined();
        expect(getNodeAtPath(tree, [0, 0])).toBeUndefined();
    });

    it('creates valid default rules for every kind except the intentionally incomplete property rule', () => {
        for (const kind of ['viewType', 'path', 'folder', 'extension', 'tag'] as const) {
            expect(isValidCondition(createDefaultRule(kind))).toBe(true);
        }
        // The default property rule starts with an empty key the user must
        // fill in; ConditionEditor.getResult blocks saving it while invalid.
        expect(isValidCondition(createDefaultRule('property'))).toBe(false);
        expect(createDefaultRule('property')).toEqual({
            rule: 'property',
            key: '',
            op: 'exists',
        });
    });
});

describe('conditionTree mutations are immutable', () => {
    it('replaceNodeAtPath returns a new tree and keeps the original intact', () => {
        const tree: ButtonCondition = { all: [ruleA, { any: [ruleB] }] };
        const snapshot = JSON.parse(JSON.stringify(tree)) as ButtonCondition;
        const next = replaceNodeAtPath(tree, [1, 0], ruleC);
        expect(next).not.toBe(tree);
        expect(getNodeAtPath(next, [1, 0])).toBe(ruleC);
        // Untouched siblings keep their identity.
        expect(getNodeAtPath(next, [0])).toBe(ruleA);
        expect(tree).toEqual(snapshot);
    });

    it('replaceNodeAtPath at the root returns the replacement', () => {
        expect(replaceNodeAtPath(ruleA, [], ruleB)).toBe(ruleB);
    });

    it('addChildAtPath appends to all/any groups', () => {
        const tree: ButtonCondition = { all: [ruleA] };
        const next = addChildAtPath(tree, [], ruleB);
        expect(next).toEqual({ all: [ruleA, ruleB] });
        expect(tree).toEqual({ all: [ruleA] });

        const nested: ButtonCondition = { all: [{ any: [] }] };
        expect(addChildAtPath(nested, [0], ruleC)).toEqual({ all: [{ any: [ruleC] }] });
    });

    it('addChildAtPath rejects not groups and rules', () => {
        expect(() => addChildAtPath({ not: ruleA }, [], ruleB)).toThrow();
        expect(() => addChildAtPath({ all: [ruleA] }, [0], ruleB)).toThrow();
    });

    it('removeNodeAtPath removes children and dissolves the root', () => {
        const tree: ButtonCondition = { all: [ruleA, ruleB] };
        expect(removeNodeAtPath(tree, [0])).toEqual({ all: [ruleB] });
        expect(removeNodeAtPath(tree, [])).toBeUndefined();
        expect(tree).toEqual({ all: [ruleA, ruleB] });
    });

    it('removing the single child of a not removes the not itself', () => {
        const tree: ButtonCondition = { all: [ruleA, { not: ruleB }] };
        expect(removeNodeAtPath(tree, [1, 0])).toEqual({ all: [ruleA] });
        // A root-level not dissolves entirely.
        expect(removeNodeAtPath({ not: ruleA }, [0])).toBeUndefined();
    });
});

describe('setGroupKindAtPath', () => {
    it('is a no-op for the same kind', () => {
        const tree: ButtonCondition = { all: [ruleA] };
        expect(setGroupKindAtPath(tree, [], 'all')).toBe(tree);
    });

    it('converts all <-> any keeping children', () => {
        expect(setGroupKindAtPath({ all: [ruleA, ruleB] }, [], 'any')).toEqual({
            any: [ruleA, ruleB],
        });
        expect(setGroupKindAtPath({ any: [ruleA] }, [], 'all')).toEqual({ all: [ruleA] });
    });

    it('converts to not: single child kept, several children wrapped, empty gets a default rule', () => {
        expect(setGroupKindAtPath({ all: [ruleA] }, [], 'not')).toEqual({ not: ruleA });
        expect(setGroupKindAtPath({ any: [ruleA, ruleB] }, [], 'not')).toEqual({
            not: { any: [ruleA, ruleB] },
        });
        const fromEmpty = setGroupKindAtPath({ all: [] }, [], 'not');
        expect(isValidCondition(fromEmpty)).toBe(true);
        expect(getConditionKind(fromEmpty)).toBe('not');
    });

    it('converts not back to all/any, unwrapping a matching child group', () => {
        expect(setGroupKindAtPath({ not: { any: [ruleA, ruleB] } }, [], 'any')).toEqual({
            any: [ruleA, ruleB],
        });
        expect(setGroupKindAtPath({ not: ruleA }, [], 'all')).toEqual({ all: [ruleA] });
        // Non-matching child group becomes the single element.
        expect(setGroupKindAtPath({ not: { any: [ruleA] } }, [], 'all')).toEqual({
            all: [{ any: [ruleA] }],
        });
    });

    it('round-trips all -> not -> all', () => {
        const tree: ButtonCondition = { all: [ruleA, ruleB] };
        const negated = setGroupKindAtPath(tree, [], 'not');
        expect(setGroupKindAtPath(negated, [], 'all')).toEqual(tree);
    });

    it('operates on nested groups', () => {
        const tree: ButtonCondition = { all: [ruleA, { any: [ruleB] }] };
        expect(setGroupKindAtPath(tree, [1], 'not')).toEqual({
            all: [ruleA, { not: ruleB }],
        });
    });

    it('rejects rules as targets', () => {
        expect(() => setGroupKindAtPath({ all: [ruleA] }, [0], 'any')).toThrow();
    });
});

describe('convertRuleKind', () => {
    it('returns the same rule for the same kind', () => {
        expect(convertRuleKind(ruleA, 'viewType')).toBe(ruleA);
    });

    it('carries a non-empty value string across kinds with a value', () => {
        const converted = convertRuleKind({ rule: 'viewType', value: 'notes' }, 'path');
        expect(converted).toEqual({ rule: 'path', op: 'startsWith', value: 'notes' });
        expect(convertRuleKind({ rule: 'path', op: 'contains', value: 'x' }, 'tag')).toEqual({
            rule: 'tag',
            value: 'x',
        });
    });

    it('never carries values into property rules', () => {
        expect(convertRuleKind({ rule: 'tag', value: 'x' }, 'property')).toEqual({
            rule: 'property',
            key: '',
            op: 'exists',
        });
    });

    it('produces structurally valid rules for every conversion (property stays incomplete until keyed)', () => {
        const kinds = ['viewType', 'path', 'folder', 'extension', 'property', 'tag'] as const;
        for (const from of kinds) {
            for (const to of kinds) {
                const converted = convertRuleKind(createDefaultRule(from), to);
                if (to === 'property') {
                    // Empty key: incomplete by design, save is blocked instead.
                    expect(converted).toEqual({ rule: 'property', key: '', op: 'exists' });
                } else {
                    expect(isValidCondition(converted)).toBe(true);
                }
            }
        }
    });
});

describe('conditionDepth', () => {
    it('measures nesting depth', () => {
        expect(conditionDepth(ruleA)).toBe(0);
        expect(conditionDepth({ all: [] })).toBe(1);
        expect(conditionDepth({ all: [ruleA] })).toBe(1);
        expect(conditionDepth({ all: [{ any: [{ not: ruleA }] }] })).toBe(3);
    });
});
