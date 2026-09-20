// tests/cellSelectionGesturePrecedence.test.ts
//
// Two rules that only show up as BUGS if they ever drift, and neither of which
// a pure-value test can reach on its own:
//
// 1. **a modifier press reserves the SELECTION.** Shift or Ctrl/Cmd with the
//    left button means the user is building a selection, so nothing else may
//    claim the press — no tool move, no swap, no category reorder — on a
//    filled and on an empty cell alike (spec §4a);
// 2. **the ephemeral paint colour is ephemeral.** It is armed by applying a
//    colour, dropped with the selection session that armed it, previewed
//    during a drag and persisted exactly ONCE, on pointer-up.
//
// The behaviour of (1)'s wrapper is tested for real; everything that only
// exists inside React components is pinned at the SOURCE level, the same
// technique tests/futureSettings.test.ts and the Escape contract already use.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function sourceOf(relativePath: string): string {
    return readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8');
}

/** Source with comments removed, so a doc comment cannot satisfy a check. */
function codeOf(relativePath: string): string {
    return sourceOf(relativePath)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

describe('a selection modifier reserves the press it lands on', () => {
    // Shift or Ctrl/Cmd + LEFT is the selection gesture (corrected
    // 2026-09-20). Inside a grid the press never reaches a drag activator —
    // the grid claims it in the capture phase. OUTSIDE one, on the surfaces
    // that are themselves drag handles, the activator has to refuse it: there
    // is no cell to select out there, but a category reordering under a held
    // Shift would be a surprise.
    const handles = [
        'components/buttons-panel/SortableCategoryBlock.tsx',
        'components/buttons-panel/SortableCategoryTab.tsx',
        'components/buttons-panel/SortableCategoryFolder.tsx',
    ];

    for (const handle of handles) {
        it(`${handle} refuses a modified press, and the right button`, () => {
            const code = codeOf(handle);
            expect(code).toMatch(
                /const dragListeners = activateOnButton\(listeners, MOUSE_BUTTON\.left, \{\s*blockSelectionModifier: true,\s*\}\);/
            );
            // The raw listeners must not also be spread somewhere, or the
            // filter would be bypassed on that element.
            expect(code).not.toMatch(/\{\.\.\.listeners\}/);
        });
    }

    it('and a TOOL answers to the right button instead', () => {
        expect(codeOf('components/button/SortableButtonItem.tsx')).toMatch(
            /activateOnButton\(listeners, MOUSE_BUTTON\.right\)/
        );
    });
});

describe('the grid claims a modifier press before anyone else can', () => {
    const code = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');

    it('runs the rectangle gesture in the pointer-down CAPTURE phase', () => {
        // Bubble-phase would be too late: dnd-kit's activator sits on the tool
        // BELOW the grid and would already have started a drag.
        expect(code).toMatch(/onPointerDownCapture=\{handleGridPointerDownCapture\}/);
        expect(code).toMatch(/rectangle\.onPointerDownCapture\(event, intent\)/);
    });

    it('still records the press origin, so a press that never travels is a click', () => {
        // Shift click = add ONE cell stays the existing path; the rectangle is
        // only what happens past the drag threshold. The origin must therefore
        // be recorded whether or not the gesture claimed the press — no early
        // return may sit in front of it.
        const start = code.indexOf('const handleGridPointerDownCapture');
        const body = code.slice(start, code.indexOf('\n    };', start));
        expect(body).toMatch(/rectangle\.onPointerDownCapture\(event, intent\)/);
        expect(body).toMatch(/pressOriginRef\.current =/);
        expect(body).not.toMatch(/(?:^|[\s;{])return[\s;]/);
    });
});

describe('the rectangle gesture keeps the single-cell click intact', () => {
    const code = codeOf('hooks/useCellRectangleSelection.ts');

    it('never prevents the default of the press', () => {
        // `preventDefault` on pointerdown suppresses the compatibility mouse
        // events, and with them the very click the sub-threshold fallback
        // (Shift click = add one) is built on.
        expect(code).not.toMatch(/preventDefault/);
    });

    it('never captures the pointer', () => {
        // Pointer capture retargets the compatibility mouse events too, so a
        // press that never travelled would deliver its click to the grid
        // container instead of to the cell it landed on.
        expect(code).not.toMatch(/setPointerCapture/);
    });

    it('uses the same travel threshold as the drag sensor', () => {
        expect(code).toMatch(/RESIZE_DRAG_THRESHOLD_PX/);
        expect(code).toMatch(/Math\.sqrt/);
    });

    it('latches: past the threshold the press stays a drag', () => {
        expect(code).toMatch(/drag\.dragging = true/);
        expect(code).toMatch(/onActivate\(\)/);
    });

    it('cancels on Escape and on a lost pointer, restoring the baseline', () => {
        expect(code).toMatch(/event\.key !== 'Escape'/);
        expect(code).toMatch(/pointercancel/);
        // `restore` puts the selection back exactly where the press found it.
        expect(code).toMatch(/onPreview\(\[\.\.\.drag\.baseline\]\)/);
    });

    it('derives every step from the baseline, never from the last step', () => {
        expect(code).toMatch(/rectangleSelectionCells\(\s*drag\.baseline/);
        expect(code).toMatch(/cellsAddedByRectangle\(drag\.baseline/);
        // Nothing may read the LIVE selection mid-gesture.
        expect(code).not.toMatch(/latest\.current\.selectedCells/);
    });
});

describe('the gesture draws itself, separately from the selection', () => {
    const hook = codeOf('hooks/useCellRectangleSelection.ts');
    const grid = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');

    it('publishes the block as a span, not as a second cell list', () => {
        // The outline is ONE box over the whole block; it needs the span, and
        // it must come from the same computation as the selected cells so the
        // two can never disagree about where the rectangle is.
        expect(hook).toMatch(/rectangleBounds\(drag\.anchor, cell, drag\.dimensions\)/);
        expect(hook).toMatch(/rectangleCellKeys\(drag\.anchor, cell, drag\.dimensions\)/);
    });

    it('marks the cells a removal is dropping, and only for a removal', () => {
        expect(hook).toMatch(/drag\.gesture === 'remove'/);
        expect(hook).toMatch(/cellsRemovedByRectangle\(drag\.baseline, rectangle\)/);
    });

    it('drops the outline the moment the gesture ends, however it ends', () => {
        // Released, cancelled, Escaped or torn down: `endDrag` is the one exit.
        const endDrag = hook.slice(
            hook.indexOf('const endDrag'),
            hook.indexOf('const handlePointerMove')
        );
        expect(endDrag.length).toBeGreaterThan(0);
        expect(endDrag).toMatch(/setPreview\(null\)/);
    });

    it('renders the outline inside the grid, above the cells and out of flow', () => {
        expect(grid).toMatch(/rectangle\.preview && \(/);
        expect(grid).toMatch(/<GridRectanglePreview/);
        // Last child of the grid, so it paints above the cells in tree order.
        const gridEl = grid.slice(grid.indexOf('const gridEl ='), grid.indexOf('const availability'));
        expect(gridEl.indexOf('{cells}')).toBeLessThan(gridEl.indexOf('GridRectanglePreview'));
    });

    it('stays clearly apart from the PERSISTENT selection contour', () => {
        const gridEl = grid.slice(grid.indexOf('const gridEl ='), grid.indexOf('const availability'));
        // Three layers, in this order: the cells (wash), the contour of what is
        // selected, and the gesture on top of both.
        expect(gridEl.indexOf('{cells}')).toBeLessThan(
            gridEl.indexOf('GridSelectionOutline')
        );
        expect(gridEl.indexOf('GridSelectionOutline')).toBeLessThan(
            gridEl.indexOf('GridRectanglePreview')
        );
    });
});

describe('the persistent selection contour', () => {
    const grid = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');
    const outline = codeOf('components/buttons-panel/GridSelectionOutline.tsx');

    it('is drawn from the SELECTION, not from the gesture', () => {
        // It has to outlive the gesture that produced it — that is the point.
        expect(grid).toMatch(
            /<GridSelectionOutline cells=\{selectedCells\} dimensions=\{dimensions\} \/>/
        );
        expect(outline).not.toMatch(/preview|gesture|rectangle/i);
    });

    it('traces the real shape, never a bounding box', () => {
        expect(outline).toMatch(/selectionOutlinePieces\(cells, dimensions\)/);
        // A bounding box would be a single element with a span; the contour is
        // one piece per cell, keyed by the cell itself.
        expect(outline).toMatch(/pieces\.map\(\(piece\) =>/);
        expect(outline).toMatch(/key=\{piece\.cell\}/);
    });

    it('draws a side only where the neighbour is not selected', () => {
        const core = codeOf('utils/gridSelectionOutline.ts');
        expect(core).toMatch(/top:\s*!selected\(row - 1, column\)/);
        expect(core).toMatch(/right:\s*!selected\(row, column \+ 1\)/);
        expect(core).toMatch(/bottom:\s*!selected\(row \+ 1, column\)/);
        expect(core).toMatch(/left:\s*!selected\(row, column - 1\)/);
    });

    it('reaches into a gutter only where the grid has one', () => {
        const core = codeOf('utils/gridSelectionOutline.ts');
        expect(core).toMatch(/top:\s*row > 0/);
        expect(core).toMatch(/right:\s*column < dimensions\.columns - 1/);
        expect(core).toMatch(/bottom:\s*row < dimensions\.rows - 1/);
        expect(core).toMatch(/left:\s*column > 0/);
    });

    it('renders nothing when nothing is selected', () => {
        expect(outline).toMatch(/pieces\.length === 0/);
    });

    it('feeds the cells their transient "leaving" state', () => {
        expect(grid).toMatch(/deselecting=\{rectangle\.preview\?\.removing\.has\(cellKey\)/);
    });
});

describe('the ephemeral paint colour', () => {
    const hook = codeOf('hooks/useCellRectangleSelection.ts');
    const grid = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');
    const panel = codeOf('components/buttons-panel/PanelContent.tsx');

    it('is written exactly once, on pointer-up — never on a pointer-move', () => {
        const move = hook.slice(
            hook.indexOf('const handlePointerMove'),
            hook.indexOf('const handlePointerUp')
        );
        const up = hook.slice(
            hook.indexOf('const handlePointerUp'),
            hook.indexOf('const handlePointerCancel')
        );
        expect(move.length).toBeGreaterThan(0);
        expect(move).not.toMatch(/onPaint/);
        expect(up).toMatch(/onPaint\(\[\.\.\.cells\]\)/);
        // One call for the whole rectangle, not one per cell.
        expect(up).not.toMatch(/for\s*\(/);
    });

    it('writes nothing at all when a cancelled gesture ends', () => {
        const cancel = hook.slice(
            hook.indexOf('const handlePointerCancel'),
            hook.indexOf('const handleKeyDown')
        );
        expect(cancel).not.toMatch(/onPaint/);
        const key = hook.slice(hook.indexOf('const handleKeyDown'));
        expect(key.slice(0, key.indexOf('React.useEffect'))).not.toMatch(/onPaint/);
    });

    it('holds the preview until the stored styles really carry the colour', () => {
        // Saving is asynchronous and the panel re-renders from an event, so
        // dropping the preview when the promise resolves shows the PRE-paint
        // colours for the frames until the settings come back. Same defect
        // useGridResizeDrag holds its geometry for.
        expect(hook).toMatch(/pendingPaintRef/);
        expect(hook).toMatch(/gridCellColorOf\(options\.cellStyles, cell\) === pending\.color/);
    });

    it('drops the preview at once when the write was refused', () => {
        // A read-only configuration never catches up, so a preview waiting for
        // it would stand for good — promising a colour the data does not have.
        expect(hook).toMatch(/if \(!written\) \{/);
        expect(hook).toMatch(/clearPaintPreview\(\)/);
    });

    it('only ever paints what an ADD gesture brought in', () => {
        expect(hook).toMatch(/drag\.gesture === 'add' && paint !== null/);
        // A remove gesture has no added set by construction.
        expect(hook).toMatch(/:\s*\[\]/);
    });

    it('is armed by applying a colour, including "no colour"', () => {
        expect(grid).toMatch(/armPaint\(\{ color \}\)/);
    });

    it('is NOT armed by a modifier click on a swatch', () => {
        // The rule that makes the palette safe to explore: a modifier on a
        // swatch never writes, and it must not change the armed colour either.
        const palette = codeOf('components/buttons-panel/CellColorPalette.tsx');
        expect(palette).not.toMatch(/armPaint/);
        const selectByColor = grid.slice(grid.indexOf('const handleSelectByColor'));
        expect(selectByColor.slice(0, 400)).not.toMatch(/armPaint/);
    });

    it('dies with the selection session that armed it', () => {
        // One rule for every case the spec lists — selection cleared, Escape,
        // edit mode left, category or variant changed: they all end with the
        // selection naming a different grid, or none.
        expect(panel).toMatch(/gridContextKey\(cellSelection\.context\)/);
        expect(panel).toMatch(/setCellPaint\(null\);\s*\}, \[selectionContextKey\]\)/);
    });

    it('is never persisted', () => {
        // React state only: no settings key, no template field, no save.
        expect(panel).not.toMatch(/paint[A-Za-z]*\s*:\s*[^,)]*plugin/);
        expect(panel).not.toMatch(/saveData|persistSettings|commitToolState/);
        const settings = sourceOf('types/settings.ts');
        expect(settings).not.toMatch(/paintColor|selectionPaint/i);
        const template = sourceOf('export/templateFormat.ts');
        expect(template).not.toMatch(/paintColor|selectionPaint/i);
    });
});
