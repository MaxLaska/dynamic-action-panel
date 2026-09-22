// The Delete key: when it means "delete the selected tools", and — mostly —
// when it does not.
//
// A destructive shortcut is judged by its refusals, so that is what most of
// this file is. The one thing it must never do is remove panel tools while the
// user is typing somewhere else, and "somewhere else" has more shapes than it
// looks: a settings field, a rename box, Obsidian's editor, another leaf, a
// dialog that is already open.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    isSelectionDeleteKey,
    isTextEntryTarget,
    shouldOpenDeleteConfirmation,
} from '@/utils/deleteKey';

const key = (overrides: Record<string, unknown> = {}) => ({ key: 'Delete', ...overrides });

describe('which keystroke counts', () => {
    it('is the plain Delete key', () => {
        expect(isSelectionDeleteKey(key())).toBe(true);
    });

    // Backspace is the key people correct typing with, especially on a Mac.
    // The panel has never claimed it and does not start now.
    it.each([['Backspace'], ['Escape'], ['Enter'], ['x'], ['Del']])(
        'is not %s',
        (name) => {
            expect(isSelectionDeleteKey(key({ key: name }))).toBe(false);
        }
    );

    // A destructive action should not answer to a combination nobody gave it.
    it.each([['ctrlKey'], ['metaKey'], ['altKey'], ['shiftKey']])(
        'is not Delete with %s held',
        (modifier) => {
            expect(isSelectionDeleteKey(key({ [modifier]: true }))).toBe(false);
        }
    );

    it('stands down for an event something else already handled', () => {
        expect(isSelectionDeleteKey(key({ defaultPrevented: true }))).toBe(false);
    });

    // Holding the key opens one dialog, not one per repeat.
    it('ignores auto-repeat', () => {
        expect(isSelectionDeleteKey(key({ repeat: true }))).toBe(false);
    });
});

describe('where the keystroke came from', () => {
    const element = (tagName: string, extra: Record<string, unknown> = {}) => ({
        tagName,
        closest: () => null,
        ...extra,
    });

    it.each([['INPUT'], ['TEXTAREA'], ['SELECT'], ['input'], ['textarea']])(
        'treats <%s> as text entry',
        (tagName) => {
            expect(isTextEntryTarget(element(tagName))).toBe(true);
        }
    );

    it('treats an editable node as text entry', () => {
        expect(isTextEntryTarget(element('DIV', { isContentEditable: true }))).toBe(true);
    });

    it('treats a node INSIDE an editable as text entry', () => {
        // A rich control whose inner node is a plain span still belongs to the
        // editor around it.
        expect(
            isTextEntryTarget(element('SPAN', { closest: () => ({}) }))
        ).toBe(true);
    });

    it('does not treat an ordinary element as text entry', () => {
        expect(isTextEntryTarget(element('DIV'))).toBe(false);
        expect(isTextEntryTarget(element('BUTTON'))).toBe(false);
    });

    it('survives a target that is nothing at all', () => {
        expect(isTextEntryTarget(null)).toBe(false);
        expect(isTextEntryTarget(undefined)).toBe(false);
        expect(isTextEntryTarget({})).toBe(false);
    });

    // Obsidian opens popout windows, which are separate realms with their own
    // constructors — an `instanceof` guard would answer false for every node in
    // one, switching the protection off exactly where it still matters.
    it('recognises an element from another realm', () => {
        class OtherRealmElement {
            tagName = 'INPUT';
            closest(): null {
                return null;
            }
        }
        expect(isTextEntryTarget(new OtherRealmElement())).toBe(true);
    });
});

describe('whether the confirmation opens', () => {
    const base = {
        event: key(),
        target: { tagName: 'DIV', closest: (): null => null },
        targetCount: 3,
        dragging: false,
        modalOpen: false,
        inScope: true,
    };

    it('opens for a plain Delete on a selection holding tools', () => {
        expect(shouldOpenDeleteConfirmation(base)).toBe(true);
    });

    it('opens for a selection holding exactly one tool', () => {
        expect(shouldOpenDeleteConfirmation({ ...base, targetCount: 1 })).toBe(true);
    });

    it('does nothing when the selection holds no tools', () => {
        // Selected empty cells, or no selection at all: both arrive as zero.
        expect(shouldOpenDeleteConfirmation({ ...base, targetCount: 0 })).toBe(false);
    });

    it.each([
        ['a text field has the key', { target: { tagName: 'INPUT', closest: (): null => null } }],
        ['the editor has the key', { target: { tagName: 'DIV', isContentEditable: true, closest: (): null => null } }],
        ['a drag is running', { dragging: true }],
        ['a dialog is already open', { modalOpen: true }],
        ['the key came from somewhere else', { inScope: false }],
        ['it was not the Delete key', { event: key({ key: 'Backspace' }) }],
        ['a modifier was held', { event: key({ ctrlKey: true }) }],
    ])('does nothing when %s', (_label, overrides) => {
        expect(shouldOpenDeleteConfirmation({ ...base, ...overrides })).toBe(false);
    });

    // Every guard on its own is enough; none of them is load-bearing for the
    // others. This is the check that a future edit cannot quietly drop one.
    it('needs every condition, not merely most of them', () => {
        const conditions: Array<Record<string, unknown>> = [
            { event: key({ key: 'Backspace' }) },
            { target: { tagName: 'TEXTAREA', closest: (): null => null } },
            { targetCount: 0 },
            { dragging: true },
            { modalOpen: true },
            { inScope: false },
        ];
        for (const broken of conditions) {
            expect(shouldOpenDeleteConfirmation({ ...base, ...broken })).toBe(false);
        }
    });
});

describe('the key is wired to the one delete path', () => {
    const source = (path: string) => readFileSync(path, 'utf8');
    const component = source('src/components/buttons-panel/CellSelectionDeleteKey.tsx');

    it('asks the shared predicate rather than re-deciding', () => {
        expect(component).toContain('shouldOpenDeleteConfirmation({');
    });

    it('opens the confirmation instead of deleting outright', () => {
        // `deleteTools` is the path that asks first; nothing here removes
        // anything by itself.
        expect(component).toContain('deleteTools(');
        expect(component).not.toContain('removeTool');
        expect(component).not.toContain('commitToolState');
    });

    it('never swallows the key', () => {
        expect(component).not.toContain('preventDefault');
        expect(component).not.toContain('stopPropagation');
    });

    it('listens only while a selection stands', () => {
        expect(component).toContain('if (!hasSelection)');
    });

    it('scopes the key the way Escape is scoped', () => {
        const escape = source('src/components/buttons-panel/CellSelectionEscape.tsx');
        for (const file of [component, escape]) {
            expect(file).toContain("closest('.workspace-leaf')");
            expect(file).toContain('doc.body');
        }
    });
});
