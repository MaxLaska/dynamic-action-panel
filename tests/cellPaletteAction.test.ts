// tests/cellPaletteAction.test.ts
//
// A swatch is a PAINT colour (cell-selection-colors.md §8):
//
//     plain                      -> choose this colour; paint the selection
//                                   with it if there is one
//     Shift                      -> add this colour's cells to the selection
//     Ctrl/Cmd                   -> remove them; nothing selected: no-op
//
// A plain click therefore always means the same thing, selection or not. The
// rule it replaces — "with nothing selected, a plain click selects that
// colour's cells" — made one gesture mean two unrelated things depending on a
// state the user cannot see.
//
// Four layers: the pure decision, the set operations against the real
// selection core, the sentence in every shipped locale, and the wiring that
// makes click, tooltip, cursor and the armed marker read that one decision.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cellPaletteMeaning, type CellPaletteAction } from '@/utils/cellPaletteAction';
import {
    applyCellSetGesture,
    cellsWithColor,
    NO_CELL_SELECTION,
    type GridCellSelectionState,
} from '@/utils/gridCellSelection';
import { tWithParams } from '@/utils/i18n';

const COLOUR = false;
const CLEAR = true;
const action = (
    gesture: 'replace' | 'add' | 'remove',
    hasSelection: boolean,
    isClear = COLOUR
): CellPaletteAction => cellPaletteMeaning(gesture, hasSelection, isClear).action;

// --- 1. The decision ---------------------------------------------------------------

describe('what a click on a swatch means', () => {
    it('with NOTHING selected, a plain click chooses the paint colour', () => {
        expect(action('replace', false)).toBe('arm');
        expect(action('replace', false, CLEAR)).toBe('arm');
    });

    it('...and selects nothing at all while doing it', () => {
        // The gesture it hands the selection is the whole story: none.
        expect(cellPaletteMeaning('replace', false, COLOUR).gesture).toBeNull();
        expect(cellPaletteMeaning('replace', false, CLEAR).gesture).toBeNull();
    });

    it('...and writes nothing', () => {
        expect(cellPaletteMeaning('replace', false, COLOUR).writes).toBe(false);
    });

    it('with a selection, a plain click paints it — and chooses the colour too', () => {
        expect(action('replace', true)).toBe('apply');
        expect(action('replace', true, CLEAR)).toBe('apply');
        expect(cellPaletteMeaning('replace', true, COLOUR).writes).toBe(true);
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
        expect(action('remove', false)).toBe('none');
        expect(action('remove', false, CLEAR)).toBe('none');
        expect(cellPaletteMeaning('remove', false, COLOUR).gesture).toBeNull();
    });

    it('a MODIFIER never writes and never changes the chosen colour', () => {
        // Red armed, then Shift+blue: the blue cells join the selection and
        // red stays the colour the next added cell will get.
        for (const gesture of ['add', 'remove'] as const) {
            for (const hasSelection of [false, true]) {
                for (const isClear of [false, true]) {
                    const meaning = cellPaletteMeaning(gesture, hasSelection, isClear);
                    expect(meaning.writes).toBe(false);
                    expect(meaning.arms).toBe(false);
                }
            }
        }
    });

    it('only the plain click arms, and only with a selection does it write', () => {
        const arming: CellPaletteAction[] = [];
        const writing: CellPaletteAction[] = [];
        for (const gesture of ['replace', 'add', 'remove'] as const) {
            for (const hasSelection of [false, true]) {
                for (const isClear of [false, true]) {
                    const meaning = cellPaletteMeaning(gesture, hasSelection, isClear);
                    if (meaning.arms) arming.push(meaning.action);
                    if (meaning.writes) writing.push(meaning.action);
                }
            }
        }
        expect([...new Set(arming)].sort()).toEqual(['apply', 'arm']);
        expect([...new Set(writing)]).toEqual(['apply']);
    });

    it('never hands the selection a REPLACE', () => {
        // An add may move the one active context to this grid; a remove may
        // never reach across (§4.2). A replace would re-home it silently.
        for (const gesture of ['replace', 'add', 'remove'] as const) {
            for (const hasSelection of [false, true]) {
                expect(cellPaletteMeaning(gesture, hasSelection, COLOUR).gesture).not.toBe(
                    'replace'
                );
            }
        }
    });
});

// --- 2. The set operations, against the real selection core ------------------------

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

    /** One swatch click, end to end. */
    function click(
        state: GridCellSelectionState,
        gesture: 'replace' | 'add' | 'remove',
        colour: string | null,
        context = here
    ): {
        state: GridCellSelectionState;
        painted: string[] | null;
        armed: string | null | undefined;
    } {
        const selected =
            state.context && state.context.categoryId === context.categoryId
                ? state.cells
                : new Set<string>();
        const meaning = cellPaletteMeaning(gesture, selected.size > 0, colour === null);
        const armed = meaning.arms ? colour : undefined;
        if (meaning.gesture === null) {
            return {
                state,
                painted: meaning.writes ? [...selected].sort() : null,
                armed,
            };
        }
        return {
            state: applyCellSetGesture(
                state,
                context,
                cellsWithColor(styles, dimensions, colour),
                meaning.gesture
            ),
            painted: null,
            armed,
        };
    }

    it('a plain click with nothing selected leaves the selection empty and arms', () => {
        const { state, painted, armed } = click(NO_CELL_SELECTION, 'replace', 'ocap:red');
        expect(state).toBe(NO_CELL_SELECTION);
        expect(painted).toBeNull();
        expect(armed).toBe('ocap:red');
    });

    it('a plain click on clear with nothing selected arms "no colour"', () => {
        const { state, armed } = click(NO_CELL_SELECTION, 'replace', null);
        expect(state).toBe(NO_CELL_SELECTION);
        expect(armed).toBeNull();
    });

    it('Shift builds a selection out of colour groups', () => {
        const blue = click(NO_CELL_SELECTION, 'add', 'ocap:blue').state;
        expect([...blue.cells].sort()).toEqual(['r0c0', 'r0c1']);
        expect(blue.context).toEqual(here);
        const both = click(blue, 'add', 'ocap:red').state;
        expect([...both.cells].sort()).toEqual(['r0c0', 'r0c1', 'r1c0']);
    });

    it('Ctrl takes one group back out and paints nothing', () => {
        const both = click(click(NO_CELL_SELECTION, 'add', 'ocap:blue').state, 'add', 'ocap:red')
            .state;
        const { state, painted, armed } = click(both, 'remove', 'ocap:blue');
        expect([...state.cells]).toEqual(['r1c0']);
        expect(painted).toBeNull();
        expect(armed).toBeUndefined();
    });

    it('a plain click on a selection paints exactly it, and keeps it', () => {
        const selection = click(NO_CELL_SELECTION, 'add', 'ocap:blue').state;
        const { state, painted, armed } = click(selection, 'replace', 'ocap:red');
        expect(painted).toEqual(['r0c0', 'r0c1']);
        expect(state).toBe(selection);
        expect(armed).toBe('ocap:red');
    });

    it('Shift in a grid that holds no selection moves the one context there', () => {
        const inA = click(NO_CELL_SELECTION, 'add', 'ocap:blue').state;
        const moved = click(inA, 'add', 'ocap:red', there).state;
        expect(moved.context).toEqual(there);
        expect([...moved.cells]).toEqual(['r1c0']);
    });

    it('Ctrl in a grid that does not hold the selection changes nothing', () => {
        const inA = click(NO_CELL_SELECTION, 'add', 'ocap:blue').state;
        expect(click(inA, 'remove', 'ocap:blue', there).state).toBe(inA);
    });

    it('a plain click in another grid does not disturb that selection either', () => {
        // It only chooses a colour, so the selection in A stays exactly as it
        // was — no context move, no cells.
        const inA = click(NO_CELL_SELECTION, 'add', 'ocap:blue').state;
        const after = click(inA, 'replace', 'ocap:red', there);
        expect(after.state).toBe(inA);
        expect(after.armed).toBe('ocap:red');
    });

    it('a colour with no cells in the grid selects nothing under Shift', () => {
        const { state } = click(NO_CELL_SELECTION, 'add', 'ocap:purple');
        expect(state).toBe(NO_CELL_SELECTION);
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

    it('offers the colour when there is nothing to paint yet', () => {
        expect(tip('replace', false)).toBe('Paint with blue from now on');
        expect(tip('replace', false, CLEAR)).toBe('Paint with no color from now on');
    });

    it('states the write when there is a selection', () => {
        expect(tip('replace', true)).toBe('Apply blue to selection');
        expect(tip('replace', true, CLEAR)).toBe('Clear color from selection');
    });

    it('states the set operation under a modifier', () => {
        expect(tip('add', true)).toBe('Add all blue cells to selection');
        expect(tip('add', false, CLEAR)).toBe('Add all uncolored cells to selection');
        expect(tip('remove', true)).toBe('Remove all blue cells from selection');
        expect(tip('remove', true, CLEAR)).toBe('Remove all uncolored cells from selection');
    });

    it('does not promise a removal that would not happen', () => {
        expect(tip('remove', false)).toBe('Nothing selected to remove from');
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
                const needsColour = /_apply$|_arm$|_add$|_remove$/.test(key);
                expect(strings[key]?.includes('{color}'), `${code}:${key}`).toBe(needsColour);
            }
            // The superseded wordings are gone everywhere.
            expect(strings['cell_palette_tip_select']).toBeUndefined();
            expect(strings['cell_palette_tip_select_uncolored']).toBeUndefined();
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

describe('click, tooltip, cursor and the armed marker read the one decision', () => {
    const palette = codeOf('components/buttons-panel/CellColorPalette.tsx');
    const grid = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');
    const panel = codeOf('components/buttons-panel/PanelContent.tsx');
    const cursor = codeOf('components/buttons-panel/CellSelectionModifierCursor.tsx');
    const css = readFileSync(
        new URL('../src/components/buttons-panel/PaletteGrid.css', import.meta.url),
        'utf8'
    );

    it('the click handler asks `cellPaletteMeaning` and does exactly what it says', () => {
        expect(palette).toMatch(
            /const meaning = cellPaletteMeaning\(gesture, hasSelection, value === null\);/
        );
        // `apply` and `arm` take the same path: choosing the colour is one act.
        expect(palette).toMatch(/if \(meaning\.arms\) \{\s*onApply\(value\);/);
        expect(palette).toMatch(/if \(meaning\.gesture === null\) \{\s*return;/);
        expect(palette).toMatch(
            /onSelectByColor\(cellsWithColor\(cellStyles, dimensions, value\), meaning\.gesture\);/
        );
        expect(palette).not.toMatch(/shiftKey|ctrlKey|metaKey/);
    });

    it('the grid arms even with nothing selected, and paints only when there is', () => {
        const handler = grid.slice(
            grid.indexOf('const handleApplyColor'),
            grid.indexOf('const handleSelectByColor')
        );
        expect(handler).toMatch(/armPaint\(\{ color \}\);/);
        expect(handler).toMatch(/if \(selectedCells\.size === 0\) \{\s*return;\s*\}/);
        // The arming happens BEFORE the early return, or choosing a colour
        // with nothing selected would do nothing at all.
        expect(handler.indexOf('armPaint')).toBeLessThan(handler.indexOf('selectedCells.size === 0'));
        expect(handler).toMatch(/applyCellColor\(selectionContext, \[\.\.\.selectedCells\], color\)/);
    });

    it('an explicit clear drops the chosen colour, selection or not', () => {
        // Escape and the background click both go through here. With nothing
        // selected there is no context change for the watcher below to see,
        // so "never mind" has to say it itself.
        const clear = panel.slice(
            panel.indexOf('const clearCellSelection'),
            panel.indexOf('const restoreCellSelection')
        );
        expect(clear).toMatch(/setCellSelection\(\(prev\) => \(prev\.context === null \? prev : NO_CELL_SELECTION\)\);/);
        expect(clear).toMatch(/setCellPaint\(null\);/);
    });

    it('a colour armed with nothing selected survives the gesture that starts one', () => {
        // The reset watches the selection CONTEXT; going from "no selection"
        // to "a selection" is the one transition that must keep the colour,
        // because that gesture is the one meant to carry it.
        const reset = panel.slice(
            panel.indexOf('const previousContextKeyRef'),
            panel.indexOf('}, [selectionContextKey]);') + 30
        );
        expect(reset).toMatch(/if \(previous === selectionContextKey \|\| previous === null\) \{\s*return;\s*\}/);
        expect(reset).toMatch(/setCellPaint\(null\);/);
    });

    it('the tooltip is built from the same function and the keys held right now', () => {
        expect(palette).toMatch(/const heldIntent = useSelectionModifierIntent\(\);/);
        expect(palette).toMatch(
            /cellPaletteMeaning\(heldIntent \?\? 'replace', hasSelection, entry\.value === null\)\s*\.tooltipKey/
        );
        expect(palette).toMatch(/title=\{tooltip\}/);
        expect(cursor).toMatch(/export function useSelectionModifierIntent\(\)/);
    });

    it('the armed colour is visible on its swatch, and follows the state not the focus', () => {
        expect(palette).toMatch(/const armed = paint !== null && paint\.color === entry\.value;/);
        expect(palette).toMatch(/armed \? 'ocap-cell-swatch--armed' : ''/);
        expect(palette).toMatch(/aria-pressed=\{armed\}/);
        expect(palette).toMatch(/paint: CellPaintColor \| null;/);
        expect(grid).toMatch(/paint=\{paint\}/);
        // `:focus` would mark the last thing clicked, not the chosen colour.
        expect(css).not.toMatch(/ocap-cell-swatch:focus\b/);
    });

    it('what the selection IS and what the next paint WILL BE are drawn apart', () => {
        expect(palette).toMatch(/const uniform = !summary\.mixed && summary\.color === entry\.value;/);
        expect(palette).toMatch(/uniform \? 'ocap-cell-swatch--uniform' : ''/);
        expect(css).toMatch(/\.ocap-cell-swatch--armed \{\s*outline: 2px solid var\(--interactive-accent\)/);
        expect(css).toMatch(/\.ocap-cell-swatch--uniform \{\s*border-color: var\(--text-normal\)/);
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
