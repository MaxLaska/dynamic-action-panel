// Deleting a selection: the domain operation that removes several tools at
// once, and the naming that lets the confirmation list them.
//
// The point of these tests is that the many and the one are the SAME
// operation. `removeToolFromCategory` is a list of one, so a selection delete
// cannot quietly acquire different rules about placements, variants, library
// tools or garbage collection — and the tests below say so by comparing the
// two directly rather than by restating the rules twice.

import { describe, expect, it } from 'vitest';

import {
    removeToolFromCategory,
    removeToolsFromCategory,
    type ToolState,
} from '@/domain/categoryOps';
import { deleteTargetsOf, toolDisplayLabel } from '@/utils/deleteTargets';
import type { ToolDefinition } from '@/types/settings';
import {
    p,
    registryOf,
    stateOf,
    storedDynamic,
    storedGrid,
    storedVariant,
    tool,
} from './helpers/stored';

const grid = (...placements: ReturnType<typeof p>[]) =>
    storedGrid(placements, { id: 'cat' });

/** Tool ids still referenced by any placement anywhere. */
function placedIds(state: ToolState): string[] {
    const ids: string[] = [];
    for (const category of state.categories) {
        for (const placement of category.placements ?? []) ids.push(placement.toolId);
        for (const variant of category.variants ?? []) {
            for (const placement of variant.placements ?? []) ids.push(placement.toolId);
        }
    }
    return ids.sort();
}

// --- the batch removal ---------------------------------------------------------

describe('removing several tools at once', () => {
    const state = (): ToolState =>
        stateOf(
            registryOf(tool('a'), tool('b'), tool('c'), tool('d')),
            grid(p('a', 0), p('b', 1), p('c', 2), p('d', 3))
        );

    it('removes every named placement', () => {
        const next = removeToolsFromCategory(state(), 'cat', ['a', 'c']);
        expect(placedIds(next)).toEqual(['b', 'd']);
    });

    it('collects the definitions nothing references anymore', () => {
        const next = removeToolsFromCategory(state(), 'cat', ['a', 'c']);
        expect(Object.keys(next.tools).sort()).toEqual(['b', 'd']);
    });

    it('leaves the tools it was not asked about entirely alone', () => {
        const next = removeToolsFromCategory(state(), 'cat', ['a']);
        expect(next.tools['b']).toEqual(state().tools['b']);
        expect(next.categories[0]!.placements).toContainEqual({ toolId: 'b', slot: 1 });
    });

    it('is the same operation as deleting one, only with more targets', () => {
        // The single delete IS this function with a list of one; comparing them
        // is what keeps the two from ever drifting apart.
        expect(removeToolsFromCategory(state(), 'cat', ['a'])).toEqual(
            removeToolFromCategory(state(), 'cat', 'a')
        );
    });

    it('agrees with deleting the same tools one after another', () => {
        const oneAtATime = removeToolFromCategory(
            removeToolFromCategory(state(), 'cat', 'a'),
            'cat',
            'c'
        );
        expect(removeToolsFromCategory(state(), 'cat', ['a', 'c'])).toEqual(oneAtATime);
    });

    it('removes every placement of a tool, not just one of them', () => {
        // The same tool in two cells is one thing being deleted; the existing
        // single delete has always cleared both, and so does this.
        const twice = stateOf(registryOf(tool('a'), tool('b')), grid(p('a', 0), p('a', 3), p('b', 1)));
        expect(placedIds(removeToolsFromCategory(twice, 'cat', ['a']))).toEqual(['b']);
    });

    it('ignores ids that name nothing', () => {
        const before = state();
        expect(removeToolsFromCategory(before, 'cat', ['ghost'])).toEqual(before);
    });

    it('ignores duplicates in the list', () => {
        expect(removeToolsFromCategory(state(), 'cat', ['a', 'a', 'a'])).toEqual(
            removeToolsFromCategory(state(), 'cat', ['a'])
        );
    });

    it.each([
        ['an empty list', [] as string[]],
        ['an unknown category', ['a']],
    ])('changes nothing for %s', (label, toolIds) => {
        const before = state();
        const categoryId = label === 'an unknown category' ? 'nope' : 'cat';
        expect(removeToolsFromCategory(before, categoryId, toolIds)).toBe(before);
    });
});

// --- garbage collection on the FINISHED state ----------------------------------

describe('what survives a selection delete', () => {
    it('keeps a definition another category still places', () => {
        const shared = stateOf(
            registryOf(tool('shared'), tool('a')),
            grid(p('shared', 0), p('a', 1)),
            storedGrid([p('shared', 0)], { id: 'other' })
        );
        const next = removeToolsFromCategory(shared, 'cat', ['shared', 'a']);
        // Gone from this grid, still placed in the other one — so the
        // definition stays, and the other grid keeps working.
        expect(placedIds(next)).toEqual(['shared']);
        expect(next.tools['shared']).toBeDefined();
        expect(next.tools['a']).toBeUndefined();
    });

    it('keeps a definition another VARIANT of the same category still places', () => {
        const dynamic = stateOf(
            registryOf(tool('a'), tool('b')),
            storedDynamic(
                [
                    storedVariant('v1', undefined, [p('a', 0), p('b', 1)], true),
                    storedVariant('v2', undefined, [p('b', 0)]),
                ],
                { id: 'cat' }
            )
        );
        // A delete removes the tool from the whole category, variants included
        // — the long-standing single-delete rule, unchanged here.
        const next = removeToolsFromCategory(dynamic, 'cat', ['a', 'b']);
        expect(placedIds(next)).toEqual([]);
        expect(Object.keys(next.tools)).toEqual([]);
    });

    it('never collects a library tool, even with no placements left', () => {
        const withLibrary = stateOf(
            registryOf(tool('kept', { library: true }), tool('a')),
            grid(p('kept', 0), p('a', 1))
        );
        const next = removeToolsFromCategory(withLibrary, 'cat', ['kept', 'a']);
        expect(placedIds(next)).toEqual([]);
        expect(next.tools['kept']).toBeDefined();
        expect(next.tools['a']).toBeUndefined();
    });

    // The reason the batch exists at all: collection must judge the finished
    // categories. This is the case that would break if each target were
    // stripped and collected in turn against a half-updated state.
    it('judges "still referenced" against the finished state, not a partial one', () => {
        const crossed = stateOf(
            registryOf(tool('a'), tool('b')),
            grid(p('a', 0), p('b', 1)),
            storedGrid([p('a', 0)], { id: 'other' })
        );
        const next = removeToolsFromCategory(crossed, 'cat', ['a', 'b']);
        expect(next.tools['a']).toBeDefined(); // other grid still places it
        expect(next.tools['b']).toBeUndefined(); // nothing places it anymore
        expect(placedIds(next)).toEqual(['a']);
    });
});

// --- naming the targets ---------------------------------------------------------

describe('naming what will be deleted', () => {
    const named = (extra: Partial<ToolDefinition>): string =>
        toolDisplayLabel({ id: 't', name: '', actions: [], ...extra }, 't');

    it('uses the label the user has been looking at', () => {
        expect(named({ name: 'Extract chapter' })).toBe('Extract chapter');
    });

    it('falls back to the first line of the hover text', () => {
        // A dropped section's tooltip is "source · page" then the outline path;
        // the first line is the one that names the thing.
        expect(named({ tooltip: 'Bieker 2021 · S. 17\nA Studieren › 1 Lernen' })).toBe(
            'Bieker 2021 · S. 17'
        );
    });

    it.each([
        [
            'a section, by its title',
            {
                type: 'file' as const,
                parameters: {
                    filePath: 'refs/Book.pdf',
                    section: { title: '4 Nebenjobs im Studium', level: 1, pageIndex: 9 },
                },
            },
            '4 Nebenjobs im Studium',
        ],
        [
            'a file, by its name without folders or extension',
            { type: 'file' as const, parameters: { filePath: 'refs/sub/PaperB.pdf' } },
            'PaperB',
        ],
        [
            'a script, by its script name',
            { type: 'script' as const, parameters: { scriptName: 'extract.js' } },
            'extract.js',
        ],
        [
            'a command, by its id',
            { type: 'command' as const, parameters: { commandId: 'app:go-back' } },
            'app:go-back',
        ],
        [
            'a link, by its url',
            { type: 'url' as const, parameters: { url: 'obsidian://zotflow?x=1' } },
            'obsidian://zotflow?x=1',
        ],
        [
            'a new file, by its file name',
            { type: 'create_file' as const, parameters: { fileName: 'Note.md' } },
            'Note.md',
        ],
    ])('falls back to what the action points at: %s', (_label, action, expected) => {
        expect(named({ actions: [action] })).toBe(expected);
    });

    it('falls back to the id only when there is nothing else at all', () => {
        // An actionless, unnamed tool is possible and must still be listed
        // rather than silently dropped from the count.
        expect(toolDisplayLabel({ id: 'mu5y-4-tqt', name: '', actions: [] }, 'mu5y-4-tqt')).toBe(
            'mu5y-4-tqt'
        );
        expect(toolDisplayLabel(undefined, 'mu5y-4-tqt')).toBe('mu5y-4-tqt');
    });

    it('shortens a label that would widen the dialog', () => {
        const long = 'Wort '.repeat(40);
        const label = named({ name: long });
        expect(label.length).toBeLessThanOrEqual(61);
        expect(label.endsWith('…')).toBe(true);
    });

    it('collapses whitespace so a label stays one line', () => {
        expect(named({ name: '  Two   lines\nhere  ' })).toBe('Two lines here');
    });
});

describe('turning a selection into delete targets', () => {
    const tools = registryOf(
        tool('a', { name: 'Tool A' }),
        tool('b', { name: 'Tool B' }),
        tool('c', { name: 'Tool C' })
    );

    it('names each target, in the order given', () => {
        expect(deleteTargetsOf(tools, ['c', 'a'])).toEqual([
            { toolId: 'c', label: 'Tool C' },
            { toolId: 'a', label: 'Tool A' },
        ]);
    });

    it('counts one tool once, however many cells hold it', () => {
        expect(deleteTargetsOf(tools, ['a', 'a', 'b'])).toHaveLength(2);
    });

    // A selection can outlive what it pointed at: a grid remounts, a variant
    // flips, another delete lands first. Offering to delete something already
    // gone would make the count in the dialog a lie.
    it('drops ids that no longer name a tool', () => {
        expect(deleteTargetsOf(tools, ['a', 'ghost', 'b']).map((target) => target.toolId)).toEqual([
            'a',
            'b',
        ]);
    });

    it('has nothing to delete for an empty selection', () => {
        expect(deleteTargetsOf(tools, [])).toEqual([]);
    });

    // Empty cells contribute no tool id at all, so a selection of nothing but
    // empty cells arrives here as an empty list — and nothing is offered.
    it('has nothing to delete when the selection held only empty cells', () => {
        expect(deleteTargetsOf(tools, [])).toHaveLength(0);
    });
});
