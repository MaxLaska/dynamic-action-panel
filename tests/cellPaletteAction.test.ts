// tests/cellPaletteAction.test.ts
//
// The palette speaks the grammar of the grid (cell-selection-colors.md §8):
//
//     plain, nothing selected    -> select this colour's cells
//     plain, something selected  -> paint them this colour   (the only write)
//     Shift                      -> add this colour's cells
//     Ctrl/Cmd                   -> remove them; with nothing selected, no-op
//
// Three layers: the pure decision, the sentence it produces in every shipped
// locale, and the wiring that makes click, tooltip and cursor read that one
// decision instead of three private copies of it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    cellPaletteMeaning,
    type CellPaletteAction,
} from '@/utils/cellPaletteAction';
import {
    applyCellSetGesture,
    cellsWithColor,
    NO_CELL_SELECTION,
    type GridCellSelectionState,
} from '@/utils/gridCellSelection';
import { t, tWithParams } from '@/utils/i18n';

const COLOUR = false;
const CLEAR = true;
const action = (
    gesture: 'replace' | 'add' | 'remove',
    hasSelection: boolean,
    isClear = COLOUR
): CellPaletteAction => cellPaletteMeaning(gesture, hasSelection, isClear).action;

// --- 1. The decision ---------------------------------------------------------------

describe('what a click on a swatch means', () => {
    it('with NOTHING selected, a plain click selects that colour group', () => {
        expect(action('replace', false)).toBe('select-group');
        expect(action('replace', false, CLEAR)).toBe('select-group');
    });

    it('with a selection, a plain click paints it', () => {
        expect(action('replace', true)).toBe('apply');
        expect(action('replace', true, CLEAR)).toBe('apply');
    });

    it('Shift adds the colour group, selection or not', () => {
        expect(action('add', false)).toBe('add-group');
        expect(action('add', true)).toBe('add-group');
        expect(action('add', true, CLEAR)).toBe('add-group');
    });

    it('Ctrl/Cmd removes the colour group', () => {
        expect(action('remove', true)).toBe('remove-group');
        expect(action('remove', true, CLEAR)).toBe('remove-group');
    });

    it('...and does nothing at all when there is nothing to remove from', () => {
        // It must not start a selection (that is Shift's job) and must not
        // write. The old rule — Ctrl REPLACES the selection with the colour
        // group — is gone; that is now the plain click's job.
        expect(action('remove', false)).toBe('none');
        expect(action('remove', false, CLEAR)).toBe('none');
        expect(cellPaletteMeaning('remove', false, COLOUR).gesture).toBeNull();
    });

    it('only the plain click on a selection writes, and only it arms the paint', () => {
        const writes: CellPaletteAction[] = [];
        const arms: CellPaletteAction[] = [];
        for (const gesture of ['replace', 'add', 'remove'] as const) {
            for (const hasSelection of [false, true]) {
                for (const isClear of [false, true]) {
                    const meaning = cellPaletteMeaning(gesture, hasSelection, isClear);
                    if (meaning.writes) writes.push(meaning.action);
                    if (meaning.arms) arms.push(meaning.action);
                }
            }
        }
        expect([...new Set(writes)]).toEqual(['apply']);
        expect([...new Set(arms)]).toEqual(['apply']);
    });

    it('never hands the selection a REPLACE — an add may move the one context, a remove may not', () => {
        // `select-group` is an add onto an empty selection. Expressed as a
        // replace it would re-home the panel-wide context from any grid, which
        // is exactly what the cross-grid rule reserves for Shift (§4.2).
        for (const gesture of ['replace', 'add', 'remove'] as const) {
            for (const hasSelection of [false, true]) {
                expect(cellPaletteMeaning(gesture, hasSelection, COLOUR).gesture).not.toBe(
                    'replace'
                );
            }
        }
        expect(cellPaletteMeaning('replace', false, COLOUR).gesture).toBe('add');
    });
});

// --- 2. The same decision, driving the real selection core -------------------------

describe('the decision applied to a real selection', () => {
    const dimensions = { rows: 2, columns: 2 };
    const here = { categoryId: 'cat-a', variantId: null };
    const there = { categoryId: 'cat-b', variantId: null };
    const styles = {
        r0c0: { color: 'ocap:blue' },
        r0c1: { color: 'ocap:blue' },
        r1c0: { color: 'ocap:red' },
        // r1c1 has no colour at all
    };

    /** One swatch click, end to end: decision -> cells -> new selection. */
    function click(
        state: GridCellSelectionState,
        gesture: 'replace' | 'add' | 'remove',
        colour: string | null,
        context = here
    ): { state: GridCellSelectionState; painted: string[] | null } {
        const selected = state.context && state.context.categoryId === context.categoryId
            ? state.cells
            : new Set<string>();
        const meaning = cellPaletteMeaning(gesture, selected.size > 0, colour === null);
        if (meaning.action === 'apply') {
            return { state, painted: [...selected].sort() };
        }
        if (meaning.gesture === null) {
            return { state, painted: null };
        }
        return {
            state: applyCellSetGesture(
                state,
                context,
                cellsWithColor(styles, dimensions, colour),
                meaning.gesture
            ),
            painted: null,
        };
    }

    it('plain click with nothing selected selects the colour group', () => {
        const { state, painted } = click(NO_CELL_SELECTION, 'replace', 'ocap:blue');
        expect([...state.cells].sort()).toEqual(['r0c0', 'r0c1']);
        expect(state.context).toEqual(here);
        expect(painted).toBeNull();
    });

    it('plain click on clear selects the uncoloured cells', () => {
        const { state } = click(NO_CELL_SELECTION, 'replace', null);
        expect([...state.cells]).toEqual(['r1c1']);
    });

    it('Shift then adds a second group, keeping the first', () => {
        const first = click(NO_CELL_SELECTION, 'replace', 'ocap:blue').state;
        const second = click(first, 'add', 'ocap:red').state;
        expect([...second.cells].sort()).toEqual(['r0c0', 'r0c1', 'r1c0']);
    });

    it('Ctrl takes one group back out and leaves the colours alone', () => {
        const both = click(click(NO_CELL_SELECTION, 'replace', 'ocap:blue').state, 'add', 'ocap:red')
            .state;
        const { state, painted } = click(both, 'remove', 'ocap:blue');
        expect([...state.cells]).toEqual(['r1c0']);
        expect(painted).toBeNull();
    });

    it('a plain click on a selection paints exactly it, and nothing else', () => {
        const selection = click(NO_CELL_SELECTION, 'replace', 'ocap:blue').state;
        const { state, painted } = click(selection, 'replace', 'ocap:red');
        expect(painted).toEqual(['r0c0', 'r0c1']);
        expect(state).toBe(selection);
    });

    it('a group whose colour is nowhere in the grid leaves an empty selection', () => {
        const { state } = click(NO_CELL_SELECTION, 'replace', 'ocap:purple');
        expect(state).toBe(NO_CELL_SELECTION);
    });

    it("Ctrl in a grid that does not hold the selection changes nothing", () => {
        const inA = click(NO_CELL_SELECTION, 'replace', 'ocap:blue').state;
        expect(click(inA, 'remove', 'ocap:blue', there).state).toBe(inA);
    });

    it('a plain click in another grid moves the one context there', () => {
        // Nothing is selected HERE, so the primary action is to select — and
        // an add is how a selection legitimately moves grids.
        const inA = click(NO_CELL_SELECTION, 'replace', 'ocap:blue').state;
        const moved = click(inA, 'replace', 'ocap:red', there).state;
        expect(moved.context).toEqual(there);
        expect([...moved.cells]).toEqual(['r1c0']);
    });
});

// --- 3. The sentence ----------------------------------------------------------------

describe('the tooltip says what THIS click would do', () => {
    const tip = (
        gesture: 'replace' | 'add' | 'remove',
        hasSelection: boolean,
        isClear = COLOUR,
        colour = 'blue'
    ) =>
        tWithParams(cellPaletteMeaning(gesture, hasSelection, isClear).tooltipKey, {
            color: colour,
        });

    it('reads as one action for a colour', () => {
        expect(tip('replace', false)).toBe('Select all blue cells');
        expect(tip('replace', true)).toBe('Apply blue to selection');
        expect(tip('add', true)).toBe('Add all blue cells to selection');
        expect(tip('remove', true)).toBe('Remove all blue cells from selection');
    });

    it('reads as one action for clear, which is the uncoloured group', () => {
        expect(tip('replace', false, CLEAR)).toBe('Select all uncolored cells');
        expect(tip('replace', true, CLEAR)).toBe('Clear color from selection');
        expect(tip('add', true, CLEAR)).toBe('Add all uncolored cells to selection');
        expect(tip('remove', true, CLEAR)).toBe('Remove all uncolored cells from selection');
    });

    it('does not promise a removal that would not happen', () => {
        expect(tip('remove', false)).toBe('Nothing selected to remove from');
        expect(tip('remove', false, CLEAR)).toBe('Nothing selected to remove from');
    });

    it('is one sentence, never a manual of every gesture', () => {
        for (const gesture of ['replace', 'add', 'remove'] as const) {
            for (const hasSelection of [false, true]) {
                for (const isClear of [false, true]) {
                    const text = tip(gesture, hasSelection, isClear);
                    expect(text).not.toMatch(/·|\n/);
                    expect(text).not.toMatch(/\{color\}/);
                }
            }
        }
    });

    it('exists in every shipped locale, with the colour placeholder where needed', () => {
        const locales = ['en', 'ru', 'zh'].map((code) => ({
            code,
            strings: JSON.parse(
                readFileSync(new URL(`../src/locales/${code}.json`, import.meta.url), 'utf8')
            ) as Record<string, string>,
        }));
        const keys = new Set<string>();
        for (const gesture of ['replace', 'add', 'remove'] as const) {
            for (const hasSelection of [false, true]) {
                for (const isClear of [false, true]) {
                    keys.add(cellPaletteMeaning(gesture, hasSelection, isClear).tooltipKey);
                }
            }
        }
        expect(keys.size).toBe(9);
        for (const { code, strings } of locales) {
            for (const key of keys) {
                expect(strings[key], `${code}:${key}`).toBeTruthy();
                // A colour key names the colour; an uncoloured/idle one must not.
                const needsColour = /_apply$|_select$|_add$|_remove$/.test(key);
                expect(strings[key]?.includes('{color}'), `${code}:${key}`).toBe(needsColour);
            }
        }
        // The old multi-action manual is gone everywhere.
        expect(t('cell_color_swatch_hint')).toBe('cell_color_swatch_hint');
        for (const { strings } of locales) {
            expect(strings['cell_color_swatch_hint']).toBeUndefined();
        }
    });
});

// --- 4. The wiring ------------------------------------------------------------------

function codeOf(relativePath: string): string {
    return readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

describe('click, tooltip and cursor all read the one decision', () => {
    const palette = codeOf('components/buttons-panel/CellColorPalette.tsx');
    const cursor = codeOf('components/buttons-panel/CellSelectionModifierCursor.tsx');
    const css = readFileSync(
        new URL('../src/components/buttons-panel/PaletteGrid.css', import.meta.url),
        'utf8'
    );

    it('the click handler asks `cellPaletteMeaning` and does exactly what it says', () => {
        expect(palette).toMatch(
            /const meaning = cellPaletteMeaning\(gesture, hasSelection, value === null\);/
        );
        expect(palette).toMatch(/if \(meaning\.action === 'apply'\) \{\s*onApply\(value\);/);
        expect(palette).toMatch(/if \(meaning\.gesture === null\) \{\s*return;/);
        expect(palette).toMatch(
            /onSelectByColor\(cellsWithColor\(cellStyles, dimensions, value\), meaning\.gesture\);/
        );
        // No second reading of the modifiers anywhere in the component.
        expect(palette).not.toMatch(/shiftKey|ctrlKey|metaKey/);
    });

    it('the tooltip is built from the same function and the keys held right now', () => {
        expect(palette).toMatch(/const heldIntent = useSelectionModifierIntent\(\);/);
        expect(palette).toMatch(
            /cellPaletteMeaning\(heldIntent \?\? 'replace', hasSelection, entry\.value === null\)\s*\.tooltipKey/
        );
        expect(palette).toMatch(/title=\{tooltip\}/);
    });

    it('the held modifier comes from the tracker the cursor already uses', () => {
        // One tracker, two readers — not a second set of key listeners.
        expect(cursor).toMatch(/export function useSelectionModifierIntent\(\)/);
        expect(cursor).toMatch(/React\.useSyncExternalStore\(/);
        expect(cursor).toMatch(/publishIntent\(gesture\);/);
        expect(cursor).toMatch(/publishIntent\(null\);/);
        expect(palette).not.toMatch(/addEventListener/);
    });

    it('a swatch wears the same modifier cursors as a cell', () => {
        expect(css).toMatch(
            /body \.buttons-panel \.ocap-cell-palette button\.ocap-cell-swatch \{\s*cursor: var\(--ocap-selection-cursor, pointer\);\s*\}/
        );
    });

    it('nothing about the palette depends on the mode', () => {
        expect(palette).not.toMatch(/enableEditMode|interactionMode|allowsLayoutEditing/);
    });
});
