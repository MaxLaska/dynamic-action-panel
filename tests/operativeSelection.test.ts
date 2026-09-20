// tests/operativeSelection.test.ts
//
// The operative model (2026-09-19):
//
//     plain click   = USE the tool           (locked AND edit)
//     modifier      = SELECT cells           (locked AND edit)
//     locked / edit = layout locked / layout editable — nothing else
//
// Before, locked meant "consume" and edit meant "manage": tools stopped working
// the moment the panel was unlocked, a plain click in edit mode replaced the
// selection, and locking threw the selection away. This file pins the new
// contract in three layers — the pure click decision, the gates in the
// components (source level, as there is no DOM here), and what must stay
// edit-only.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isClickNotDrag } from '@/utils/gridCellSelection';
import { gridPointerIntent } from '@/utils/gridPointerIntent';
import { allowsLayoutEditing } from '@/utils/interactionMode';
import { RESIZE_DRAG_THRESHOLD_PX } from '@/utils/categoryGrid';

function codeOf(relativePath: string): string {
    return readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

const T = RESIZE_DRAG_THRESHOLD_PX;
const at = (x: number, y: number) => ({ x, y });

// --- 1. The pure click decision ------------------------------------------------

describe('what a click on a grid cell means', () => {
    // The full matrix lives in tests/mouseGrammar.test.ts; what belongs to
    // THIS file's subject is that using a tool and choosing cells are still
    // different gestures, and that a drag never also runs a tool.
    it('runs the tool on a plain LEFT click', () => {
        expect(gridPointerIntent({ button: 0, shiftKey: false, ctrlKey: false, metaKey: false }, false)).toBe(
            'use'
        );
    });

    it('selects with a MODIFIER, so a plain click never has to choose', () => {
        expect(gridPointerIntent({ button: 0, shiftKey: true, ctrlKey: false, metaKey: false }, false)).toBe(
            'select-add'
        );
        expect(gridPointerIntent({ button: 0, shiftKey: false, ctrlKey: true, metaKey: false }, false)).toBe(
            'select-remove'
        );
    });
});

describe('click or drag', () => {
    it('treats a keyboard activation as a click, always', () => {
        // Enter/Space on a focused tool: detail 0, no press, no travel.
        expect(isClickNotDrag(0, null, at(500, 500), T)).toBe(true);
    });

    it('treats a press that did not travel as a click', () => {
        expect(isClickNotDrag(1, at(10, 10), at(10, 10), T)).toBe(true);
        expect(isClickNotDrag(1, at(10, 10), at(10 + T, 10), T)).toBe(true);
    });

    it('treats travel past the threshold as a drag (euclidean)', () => {
        expect(isClickNotDrag(1, at(10, 10), at(10 + T + 1, 10), T)).toBe(false);
        // 3-4-5: diagonal travel counts in full, not per axis.
        expect(isClickNotDrag(1, at(0, 0), at(3, 4), 4)).toBe(false);
    });

    it('treats a click whose press was forgotten as the end of a drag', () => {
        // An activated drag drops the remembered press on purpose: a tool
        // dragged away and back releases near its origin.
        expect(isClickNotDrag(1, null, at(10, 10), T)).toBe(false);
    });
});

describe('the one thing the modes still decide', () => {
    it('is whether the LAYOUT may change', () => {
        expect(allowsLayoutEditing('edit')).toBe(true);
        expect(allowsLayoutEditing('locked')).toBe(false);
    });

    it('is the only predicate left — no "executes" and no "selects" per mode', () => {
        const source = codeOf('utils/interactionMode.ts');
        expect(source).toMatch(/export function allowsLayoutEditing/);
        expect(source).not.toMatch(/executesToolActions|allowsCellSelection/);
    });
});

// --- 2. The gates in the components --------------------------------------------

describe('a tool runs in both modes', () => {
    const hook = codeOf('hooks/useButtonClickHandler.ts');

    it('has no mode guard in the click handler any more', () => {
        expect(hook).not.toMatch(/useInteractionMode|interactionMode|executesToolActions/);
        expect(hook).toMatch(/executeButtonActions\(button\)/);
    });
});

describe('the grid decides what a click means, before the tool sees it', () => {
    const grid = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');
    const handler = grid.slice(
        grid.indexOf('const handleGridClickCapture'),
        grid.indexOf('const handleCellPress')
    );

    it('listens in the CAPTURE phase', () => {
        // Bubble would be too late: the tool's own click handler runs first.
        expect(grid).toMatch(/onClickCapture=\{handleGridClickCapture\}/);
        expect(grid).not.toMatch(/onClick=\{handleGridClickCapture\}/);
    });

    it('uses the latched intent and the shared threshold, not a mode check', () => {
        expect(handler).toMatch(/const intent = pressIntentRef\.current;/);
        expect(handler).toMatch(/isClickNotDrag\(/);
        expect(handler).not.toMatch(/enableEditMode|interactionMode|sortableEnabled/);
    });

    it('lets a plain left click through to the tool', () => {
        expect(handler).toMatch(/if \(intent === 'use' && wasClick\) \{\s*return;\s*\}/);
    });

    it('keeps every other click from the tool', () => {
        // A selection gesture's closing click, a reserved left drag's, macOS'
        // Ctrl secondary click: none of them may also run something.
        const afterRunTool = handler.slice(handler.indexOf("intent === 'use'"));
        expect(afterRunTool).toMatch(/event\.stopPropagation\(\);/);
    });

    it('does no selection work at all any more', () => {
        expect(handler).not.toMatch(/selectCell|selectCells/);
    });
});

describe('selection is available in both modes', () => {
    const grid = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');

    it('is gated on nothing but availability and a real grid', () => {
        expect(grid).toMatch(
            /const selectionEnabled =\s*selectable && selectionAvailable && selectionContext !== null;/
        );
    });

    it('mounts the palette whenever selection is active — locked included', () => {
        expect(grid).toMatch(/\{selectionActive && selectionContext !== null && \(\s*<CellColorPalette/);
    });

    it('is suspended by a search, and only by a search', () => {
        const panel = codeOf('components/buttons-panel/PanelContent.tsx');
        expect(panel).toMatch(/available=\{normalizedQuery\.length === 0\}/);
    });
});

describe('a mode toggle is not a change of grid', () => {
    const panel = codeOf('components/buttons-panel/PanelContent.tsx');
    const guard = panel.slice(
        panel.indexOf('React.useEffect(() => {\n        const context = cellSelection.context;'),
        panel.indexOf('}, [cellSelection.context')
    );

    it('keeps the selection when the mode changes', () => {
        expect(guard.length).toBeGreaterThan(0);
        expect(guard).not.toMatch(/enableEditMode|interactionMode/);
        expect(panel).toMatch(
            /\}, \[cellSelection\.context, normalizedQuery, filteredCategories, projection\.gridViews\]\)/
        );
    });

    it('compares the variant the projection ACTUALLY renders', () => {
        // Right in both modes: the edited variant in edit mode, the
        // context-resolved one in locked mode.
        expect(guard).toMatch(/projection\.gridViews\.get\(category\.id\)\?\.variantId/);
    });

    it('keeps the paint colour too, because it is keyed on the grid, not the mode', () => {
        expect(panel).toMatch(/setCellPaint\(null\);\s*\}, \[selectionContextKey\]\)/);
    });
});

describe('a category reorder is not a change of grid either', () => {
    const panel = codeOf('components/buttons-panel/PanelContent.tsx');

    it('holds the deregistration check while a category is being dragged', () => {
        const register = panel.slice(
            panel.indexOf('const registerSelectableGrid'),
            panel.indexOf('const handleLayoutDragChange')
        );
        expect(register).toMatch(/if \(layoutDragActiveRef\.current\) \{\s*return;/);
    });

    it('asks again once the drop has remounted the grid', () => {
        const onChange = panel.slice(panel.indexOf('const handleLayoutDragChange'));
        expect(onChange).toMatch(/liveCount\(prev\.context\) === 0/);
        expect(onChange).toMatch(/window\.setTimeout/);
    });

    it('is told about category drags from inside the drag provider', () => {
        expect(panel).toMatch(
            /<CellSelectionLayoutDragHold onActiveChange=\{handleLayoutDragChange\} \/>/
        );
        const hold = codeOf('components/buttons-panel/CellSelectionLayoutDragHold.tsx');
        expect(hold).toMatch(/categoryDrag\?\.isDragging/);
    });

    it('no longer loses every grid when button sorting pauses for a category drag', () => {
        // The drag provider disables button sorting while a category moves;
        // gating selection on `sortableEnabled` took every grid offline.
        const grid = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');
        const gate = grid.slice(grid.indexOf('const selectionEnabled ='), grid.indexOf('const selectionActive'));
        expect(gate).not.toMatch(/sortableEnabled|enableEditMode/);
    });
});

describe('Escape keeps working after the focused element is gone', () => {
    // With the selection now surviving a mode toggle, pressing Escape right
    // after one is the normal case — and a toggle rebuilds the category blocks,
    // unmounting whatever had focus. Focus then falls back to <body>.
    const escape = codeOf('components/buttons-panel/CellSelectionEscape.tsx');

    it('accepts an Escape aimed at nothing in particular', () => {
        expect(escape).toMatch(/target === doc\.body \|\| target === doc\.documentElement/);
    });

    it('accepts one from anywhere in the panel leaf, toolbar included', () => {
        expect(escape).toMatch(/panel\?\.closest\('\.workspace-leaf'\) \?\? panel/);
        expect(escape).toMatch(/scope\?\.contains\(target\)/);
    });

    it('still never stops or cancels the key', () => {
        expect(escape).not.toMatch(/stopPropagation|stopImmediatePropagation|preventDefault/);
    });
});

describe('one active selection context, panel-wide', () => {
    // The pure rule lives in gridCellSelection.ts and is tested there: Shift in
    // another grid MOVES the context, Ctrl in another grid is a no-op. These
    // pin the pointer layer, which has to apply the same rule to rectangles.
    const hook = codeOf('hooks/useCellRectangleSelection.ts');
    const grid = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');

    it('lets a Shift rectangle start in a grid that does not hold the selection', () => {
        // Only a REMOVE is stopped at the grid boundary.
        expect(hook).toMatch(/if \(!owns && gesture === 'remove'\) \{\s*return true;/);
        expect(hook).not.toMatch(/if \(!owns\) \{/);
    });

    it("never carries the other grid's armed paint colour across", () => {
        expect(hook).toMatch(/paintAllowed: owns/);
        expect(hook).toMatch(/drag\.gesture === 'add' && paint !== null && drag\.paintAllowed/);
    });

    it('never paints on a single Shift click that moves the context either', () => {
        const click = grid.slice(grid.indexOf('const handleGridClickCapture'), grid.indexOf('const handleApplyColor '));
        expect(click).toMatch(/gesture === 'add' &&\s*paint !== null &&\s*ownsSelection/);
    });

    it('cancels a context-moving gesture back to the WHOLE previous selection', () => {
        // Its baseline in the new grid is empty; restoring that would wipe the
        // selection the user had in the old one.
        expect(hook).toMatch(/const restoreAll = latest\.current\.onRestore;/);
        expect(grid).toMatch(/gestureStartSelectionRef\.current = cellSelectionState;/);
        expect(grid).toMatch(/restoreCellSelection\(before\)/);
    });
});

describe('the modifier cursor', () => {
    const cursor = codeOf('components/buttons-panel/CellSelectionModifierCursor.tsx');
    const panel = codeOf('components/buttons-panel/PanelContent.tsx');
    const css = readFileSync(
        new URL('../src/components/buttons-panel/PaletteGrid.css', import.meta.url),
        'utf8'
    );

    it('asks the SAME question the grid asks, so macOS Ctrl does not count', () => {
        expect(cursor).toMatch(/gestureOfEvent\(flags\)/);
        expect(cursor).toMatch(/gesture === 'add' \|\| gesture === 'remove'/);
    });

    it('follows the keys, the pointer and a lost window focus', () => {
        for (const event of ["'keydown'", "'keyup'", "'pointermove'", "'blur'"]) {
            expect(cursor).toContain(event);
        }
    });

    it('is visual only: it never stops or cancels an event', () => {
        expect(cursor).not.toMatch(/stopPropagation|stopImmediatePropagation|preventDefault/);
    });

    it('only ever touches this panel, and cleans up after itself', () => {
        // Behaviour, not just text: tests/cursorModel.test.ts runs it.
        expect(cursor).toMatch(/panel\.setAttribute\(SELECTION_INTENT_ATTRIBUTE, gesture\)/);
        expect(cursor).toMatch(/panel\.removeAttribute\(SELECTION_INTENT_ATTRIBUTE\);/);
        expect(cursor).toMatch(/return trackSelectionIntent\(panel\);/);
    });

    it('is suspended with the selection, never by the mode', () => {
        expect(cursor).toMatch(/if \(!panel \|\| !available\)/);
        expect(cursor).not.toMatch(/interactionMode|enableEditMode/);
        expect(panel).toMatch(/<CellSelectionModifierCursor panelRef=\{panelContentRef\} \/>/);
    });

    it('switches the grids and everything in them to the selection cursor', () => {
        // The full cascade is checked in tests/cursorModel.test.ts.
        expect(css).toMatch(
            /\.buttons-panel-panel-content\[data-ocap-selection-intent='add'\] \{\s*--ocap-selection-cursor: cell;/
        );
        expect(css).toMatch(
            /\.buttons-panel-panel-content\[data-ocap-selection-intent\] \.ocap-palette-grid \* \{\s*cursor: inherit;/
        );
    });
});

// --- 3. What stays edit-only -----------------------------------------------------

// Superseded 2026-09-20: there is one mode now (SINGLE_INTERACTION_MODE),
// so these gates all answer "yes". They are still worth pinning — the gates
// are how the switch comes back — and tests/mouseGrammar.test.ts owns the
// single-mode contract itself.
describe('the layout gates still exist, and now always allow', () => {
    const grid = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');
    const panel = codeOf('components/buttons-panel/PanelContent.tsx');

    it('keeps tool move/swap and category reorder behind the mode', () => {
        // The one drag gate: dnd-kit is only enabled when the layout is
        // editable (and no search filters the order).
        expect(panel).toMatch(/const dragReorderEnabled = normalizedQuery\.length === 0 && enableEditMode;/);
        expect(panel).toMatch(/const enableEditMode = allowsLayoutEditing\(interactionMode\);/);
        expect(grid).toMatch(/droppableEnabled=\{sortableEnabled\}/);
    });

    it('keeps the resize edges behind the mode', () => {
        expect(grid).toMatch(/\{enableEditMode \? \(\s*<GridResizeEdgeZone\s+edge="column"/);
        expect(grid).toMatch(/\{enableEditMode \? \(\s*<GridResizeEdgeZone\s+edge="row"/);
    });

    it('keeps the `+` behind the mode', () => {
        expect(grid).toMatch(
            /const creationEnabled = enableEditMode && !isDragging && !resizeDrag\.preview;/
        );
    });
});

// --- 4. A replacing drop is silent -------------------------------------------------

describe('a file dropped onto a tool replaces it without a word', () => {
    const hook = codeOf('hooks/useSlotFileDrop.ts');
    const grid = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');

    it('announces only a drop onto an EMPTY cell', () => {
        expect(hook).toMatch(
            /if \(\(await commitToolState\(plugin, next\)\) && target\.replacing !== true\) \{\s*new Notice\(t\(draft\.noticeKey\)\);/
        );
    });

    it('is told by the grid whether the cell held a tool', () => {
        expect(grid).toMatch(/replacing: button !== null/);
    });

    it('keeps the error notices', () => {
        expect(hook).toMatch(/new Notice\(t\('annotation_not_identified'\)\)/);
        expect(hook).toMatch(/new Notice\(t\('variant_grid_full'\)\)/);
    });
});
