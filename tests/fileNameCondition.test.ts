import { describe, expect, it } from 'vitest';
import { evaluateCondition, isValidCondition } from '@/context/conditions';
import { convertRuleKind, createDefaultRule } from '@/context/conditionTree';
import { EMPTY_WORKSPACE_CONTEXT, type WorkspaceContextSnapshot } from '@/context/workspaceContext';
import type { FileNameConditionOp } from '@/types/conditions';

/**
 * The `fileName` rule matches the file's name INCLUDING its extension — the
 * name the user sees in the tab and in the file explorer. It is deliberately
 * the only name rule: "starts with" already covers matching the stem, so there
 * is no second "base name" rule to choose between.
 */
function context(fileName: string | null): WorkspaceContextSnapshot {
    return {
        ...EMPTY_WORKSPACE_CONTEXT,
        viewType: 'markdown',
        filePath: fileName === null ? null : `notes/${fileName}`,
        fileName,
        fileBaseName: fileName === null ? null : fileName.replace(/\.[^.]+$/, ''),
        fileExtension: fileName === null ? null : (fileName.split('.').pop() ?? null),
        folderPath: fileName === null ? null : 'notes',
    };
}

const rule = (op: FileNameConditionOp, value: string) =>
    ({ rule: 'fileName', op, value }) as const;

describe('fileName condition rule', () => {
    describe('validation', () => {
        it('accepts every supported operator', () => {
            for (const op of ['equals', 'startsWith', 'contains', 'endsWith'] as const) {
                expect(isValidCondition(rule(op, 'x'))).toBe(true);
            }
        });

        it('rejects an unknown operator and a non-string value', () => {
            expect(isValidCondition({ rule: 'fileName', op: 'matches', value: 'x' })).toBe(
                false
            );
            expect(isValidCondition({ rule: 'fileName', op: 'equals', value: 7 })).toBe(false);
            expect(isValidCondition({ rule: 'fileName', value: 'x' })).toBe(false);
        });
    });

    describe('evaluation', () => {
        it('matches the full name including the extension', () => {
            expect(evaluateCondition(rule('equals', 'Test_A.md'), context('Test_A.md'))).toBe(
                true
            );
            // The stem alone is NOT the file name.
            expect(evaluateCondition(rule('equals', 'Test_A'), context('Test_A.md'))).toBe(
                false
            );
        });

        it('supports the prefix workflow this rule exists for', () => {
            expect(
                evaluateCondition(rule('startsWith', 'SRC_'), context('SRC_Note.md'))
            ).toBe(true);
            expect(evaluateCondition(rule('startsWith', 'SRC_'), context('B_Note.md'))).toBe(
                false
            );
        });

        it('supports contains and endsWith', () => {
            expect(evaluateCondition(rule('contains', 'note'), context('SRC_Note.md'))).toBe(
                true
            );
            expect(evaluateCondition(rule('endsWith', '.md'), context('SRC_Note.md'))).toBe(
                true
            );
            expect(evaluateCondition(rule('endsWith', '.pdf'), context('SRC_Note.md'))).toBe(
                false
            );
        });

        it('compares case-insensitively and ignores surrounding whitespace', () => {
            expect(evaluateCondition(rule('startsWith', ' src_ '), context('SRC_Note.md'))).toBe(
                true
            );
            expect(evaluateCondition(rule('equals', 'test_a.MD'), context('Test_A.md'))).toBe(
                true
            );
        });

        it('never matches without an active file', () => {
            for (const op of ['equals', 'startsWith', 'contains', 'endsWith'] as const) {
                expect(evaluateCondition(rule(op, 'x'), context(null))).toBe(false);
            }
        });

        it('an unfilled rule matches nothing instead of everything', () => {
            // A half-typed `startsWith ''` would otherwise select every file
            // and silently shadow the variants below it.
            expect(evaluateCondition(rule('startsWith', ''), context('Any.md'))).toBe(false);
            expect(evaluateCondition(rule('contains', '   '), context('Any.md'))).toBe(false);
        });
    });

    describe('editor integration', () => {
        it('the default rule is a valid, non-matching prefix rule', () => {
            const created = createDefaultRule('fileName');
            expect(created).toEqual({ rule: 'fileName', op: 'startsWith', value: '' });
            expect(isValidCondition(created)).toBe(true);
        });

        it('keeps the typed value when switching a rule to or from fileName', () => {
            const fromPath = convertRuleKind(
                { rule: 'path', op: 'startsWith', value: 'SRC_' },
                'fileName'
            );
            expect(fromPath).toEqual({ rule: 'fileName', op: 'startsWith', value: 'SRC_' });

            const toFolder = convertRuleKind(rule('contains', 'SRC_'), 'folder');
            expect(toFolder).toEqual({ rule: 'folder', op: 'startsWith', value: 'SRC_' });
        });
    });
});
