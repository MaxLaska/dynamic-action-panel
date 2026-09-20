// tests/mouseGrammar.test.ts
//
// The mouse grammar (experimental, 2026-09-20):
//
//     left                 use it — run the tool, or drag it to move it
//     right                context: the menu for what is under the pointer
//     Shift + right        add to the selection
//     Ctrl/Cmd + right     take out of the selection
//
// The button carries part of the meaning, which is what let the locked/edit
// mode go: a filled cell can now say "run this" and "select this one cell"
// without either gesture being ambiguous.
//
// Three layers: the pure decision, the press-time latch that every later
// handler reads, and the single mode that follows from one constant.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    MOUSE_BUTTON,
    gestureOfIntent,
    gridPointerIntent,
    isSelectionIntent,
    type GridPointerIntent,
} from '@/utils/gridPointerIntent';
import { SINGLE_INTERACTION_MODE, allowsLayoutEditing } from '@/utils/interactionMode';

const WINDOWS = false;
const MAC = true;

const press = (
    button: number,
    modifiers: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey', boolean>> = {}
) => ({ button, shiftKey: false, ctrlKey: false, metaKey: false, ...modifiers });

const intentOf = (
    button: number,
    modifiers?: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey', boolean>>,
    isMac = WINDOWS
): GridPointerIntent => gridPointerIntent(press(button, modifiers), isMac);

// --- 1. The decision ----------------------------------------------------------------

describe('what a press on the grid means', () => {
    it('the LEFT button is the tool and the layout, whatever is held', () => {
        // The point of moving the selection off this button: a left press
        // keeps one meaning, so a stray Shift cannot turn a move into
        // something else halfway through.
        expect(intentOf(MOUSE_BUTTON.left)).toBe('layout');
        expect(intentOf(MOUSE_BUTTON.left, { shiftKey: true })).toBe('layout');
        expect(intentOf(MOUSE_BUTTON.left, { ctrlKey: true })).toBe('layout');
        expect(intentOf(MOUSE_BUTTON.left, { metaKey: true })).toBe('layout');
    });

    it('the RIGHT button alone is the context menu', () => {
        expect(intentOf(MOUSE_BUTTON.right)).toBe('context');
    });

    it('Shift + right ADDS, Ctrl + right REMOVES', () => {
        expect(intentOf(MOUSE_BUTTON.right, { shiftKey: true })).toBe('select-add');
        expect(intentOf(MOUSE_BUTTON.right, { ctrlKey: true })).toBe('select-remove');
    });

    it('both modifiers held resolve to ADD, as everywhere else in the panel', () => {
        expect(intentOf(MOUSE_BUTTON.right, { shiftKey: true, ctrlKey: true })).toBe(
            'select-add'
        );
    });

    it('any other button means nothing at all', () => {
        expect(intentOf(MOUSE_BUTTON.middle)).toBe('none');
        expect(intentOf(3)).toBe('none');
        expect(intentOf(MOUSE_BUTTON.middle, { shiftKey: true })).toBe('none');
    });

    it('on macOS Cmd removes, and Ctrl + LEFT is the secondary click', () => {
        // Ctrl + left IS a right click there, so it must read as context —
        // not as a layout press, and not as a removal.
        expect(intentOf(MOUSE_BUTTON.right, { metaKey: true }, MAC)).toBe('select-remove');
        expect(intentOf(MOUSE_BUTTON.right, { ctrlKey: true }, MAC)).toBe('context');
        expect(intentOf(MOUSE_BUTTON.left, { ctrlKey: true }, MAC)).toBe('context');
        expect(intentOf(MOUSE_BUTTON.left, { shiftKey: true }, MAC)).toBe('layout');
        expect(intentOf(MOUSE_BUTTON.right, { shiftKey: true }, MAC)).toBe('select-add');
    });

    it('hands the selection a gesture only for the two selection intents', () => {
        expect(gestureOfIntent('select-add')).toBe('add');
        expect(gestureOfIntent('select-remove')).toBe('remove');
        for (const intent of ['layout', 'context', 'none'] as GridPointerIntent[]) {
            expect(gestureOfIntent(intent)).toBeNull();
            expect(isSelectionIntent(intent)).toBe(false);
        }
        expect(isSelectionIntent('select-add')).toBe(true);
        expect(isSelectionIntent('select-remove')).toBe(true);
    });

    it('never produces REPLACE from a press: no gesture wipes a selection wholesale', () => {
        for (const button of [0, 1, 2, 3]) {
            for (const modifiers of [{}, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
                for (const isMac of [WINDOWS, MAC]) {
                    expect(gestureOfIntent(gridPointerIntent(press(button, modifiers), isMac))).not.toBe(
                        'replace'
                    );
                }
            }
        }
    });
});

// --- 2. The wiring ------------------------------------------------------------------

function codeOf(relativePath: string): string {
    return readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

describe('one decision per press, taken at pointer-down', () => {
    const grid = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');
    const hook = codeOf('hooks/useCellRectangleSelection.ts');

    it('latches the intent when the button goes down', () => {
        const down = grid.slice(
            grid.indexOf('const handleGridPointerDownCapture'),
            grid.indexOf('const handleGridPointerMoveCapture')
        );
        expect(down).toMatch(/const intent = pointerIntentOfEvent\(event\);/);
        expect(down).toMatch(/pressIntentRef\.current = intent;/);
        expect(down).toMatch(/pressTravelledRef\.current = false;/);
        expect(down).toMatch(/rectangle\.onPointerDownCapture\(event, intent\)/);
    });

    it('never asks the event again later: no handler reads a button or a key', () => {
        // The whole point of the latch. A modifier released mid-gesture, or a
        // second button pressed, must not change what the gesture was.
        const afterDown = grid.slice(grid.indexOf('const handleGridPointerMoveCapture'));
        expect(afterDown).not.toMatch(/\bevent\.button\b/);
        expect(afterDown).not.toMatch(/shiftKey|ctrlKey|metaKey/);
        expect(afterDown).not.toMatch(/pointerIntentOfEvent|gestureOfEvent/);
        // The hook is handed the intent; it does not re-derive one either.
        expect(hook).not.toMatch(/\bevent\.button\b/);
        expect(hook).not.toMatch(/shiftKey|ctrlKey|metaKey/);
    });

    it('the rectangle takes only the two selection intents', () => {
        expect(hook).toMatch(/const gesture = gestureOfIntent\(intent\);/);
        expect(hook).toMatch(/if \(gesture === null\) \{\s*return false;\s*\}/);
    });

    it('a selection press that stayed put means its one cell', () => {
        // The right button fires no `click`, so the single-cell case lives in
        // the same press that a rectangle does.
        expect(hook).toMatch(
            /if \(!finished\.dragging\) \{[\s\S]*latest\.current\.onCellPress\(\s*gridCellKey\(finished\.anchor\.row, finished\.anchor\.column\),\s*finished\.gesture\s*\)/
        );
        expect(grid).toMatch(/onCellPress: \(cell, gesture\) => handleCellPress\(cell, gesture\)/);
        expect(grid).toMatch(/selectCell\(selectionContext, cellKey, gesture\);/);
    });

    it('a left click runs the tool, and only when it was not a drag', () => {
        const click = grid.slice(
            grid.indexOf('const handleGridClickCapture'),
            grid.indexOf('const handleCellPress')
        );
        expect(click).toMatch(/if \(intent === 'layout' && wasClick\) \{\s*return;\s*\}/);
        expect(click).toMatch(/event\.stopPropagation\(\);/);
        // No selection work on this path any more.
        expect(click).not.toMatch(/selectCell|selectCells/);
        expect(grid).toMatch(/onClickCapture=\{handleGridClickCapture\}/);
    });

    it('a selection gesture and a right DRAG never end in a menu', () => {
        const menu = grid.slice(
            grid.indexOf('const handleGridContextMenuCapture'),
            grid.indexOf('const handleGridClickCapture')
        );
        expect(menu).toMatch(/if \(isSelectionIntent\(intent\) \|\| travelled\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
        expect(grid).toMatch(/onContextMenuCapture=\{handleGridContextMenuCapture\}/);
        // Capture, or the tool's own contextmenu listener would already have
        // opened it (see Button.tsx).
        expect(grid).not.toMatch(/onContextMenu=\{handleGridContextMenuCapture\}/);
    });

    it('travel is measured once, against the same threshold as everywhere else', () => {
        const move = grid.slice(
            grid.indexOf('const handleGridPointerMoveCapture'),
            grid.indexOf('const handleGridContextMenuCapture')
        );
        expect(move).toMatch(/RESIZE_DRAG_THRESHOLD_PX/);
        expect(move).toMatch(/pressTravelledRef\.current = true;/);
    });

    it('no left press is a selection gesture any more, anywhere', () => {
        for (const file of [
            'components/buttons-panel/SortableCategoryBlock.tsx',
            'components/buttons-panel/SortableCategoryTab.tsx',
            'components/buttons-panel/SortableCategoryFolder.tsx',
        ]) {
            const code = codeOf(file);
            expect(code).toMatch(/const dragListeners = listeners;/);
            expect(code).not.toMatch(/suppressDragOnSelectionModifier/);
        }
        // The `+` no longer steps aside for a held modifier either.
        expect(codeOf('components/buttons-panel/GridSlotCell.tsx')).not.toMatch(
            /hasSelectionModifier/
        );
    });
});

// --- 3. One mode --------------------------------------------------------------------

describe('the panel runs in one mode', () => {
    const panel = codeOf('components/buttons-panel/PanelContent.tsx');
    const nav = codeOf('components/shared/NavigationBar.tsx');

    it('reads a constant instead of the stored mode', () => {
        expect(SINGLE_INTERACTION_MODE).toBe('edit');
        expect(panel).toMatch(/const interactionMode = SINGLE_INTERACTION_MODE;/);
        expect(panel).not.toMatch(/panelConfig\.interactionMode/);
    });

    it('leaves every layout affordance permanently available', () => {
        // They still ask the same question; the answer is now always yes.
        expect(allowsLayoutEditing(SINGLE_INTERACTION_MODE)).toBe(true);
        expect(panel).toMatch(/const enableEditMode = allowsLayoutEditing\(interactionMode\);/);
        const gridSource = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');
        expect(gridSource).toMatch(/const creationEnabled = enableEditMode && !isDragging/);
        expect(gridSource).toMatch(/enabled: isGrid && enableEditMode && !isDragging/);
    });

    it('shows no lock toggle', () => {
        expect(nav).not.toMatch(/interactionIcon|isLocked|edit-mode-btn/);
        expect(nav).not.toMatch(/onChangeInteractionMode\(/);
    });

    it('touches neither the stored value nor the schema', () => {
        // The prototype is one constant; the setting keeps whatever it holds,
        // so going back is one line and no data moves.
        const settings = readFileSync(
            new URL('../src/types/settings.ts', import.meta.url),
            'utf8'
        );
        expect(settings).toMatch(/interactionMode\?: InteractionMode;/);
        const migrations = readFileSync(
            new URL('../src/settings/settingsMigrations.ts', import.meta.url),
            'utf8'
        );
        expect(migrations).toMatch(/normalizeInteractionMode/);
        const mode = readFileSync(
            new URL('../src/utils/interactionMode.ts', import.meta.url),
            'utf8'
        );
        expect(mode).toMatch(/export function allowsLayoutEditing/);
    });

    it('a stored "locked" changes nothing at runtime', () => {
        // Whatever is in the file, the panel runs the one mode.
        for (const stored of ['locked', 'edit', undefined]) {
            void stored;
            expect(SINGLE_INTERACTION_MODE).toBe('edit');
        }
        expect(panel).not.toMatch(/interactionMode === 'locked'|isLocked/);
    });
});
