// tests/mouseGrammar.test.ts
//
// The mouse grammar (experimental, corrected 2026-09-20):
//
//     left                 use it: a click runs the tool
//     left, dragged        RESERVED — no move, no selection, no run either
//     Shift + left         add to the selection (one cell, or a rectangle)
//     Ctrl/Cmd + left      take out of the selection
//     right                context: a click opens the menu, a DRAG moves the tool
//
// This supersedes the first attempt of the same day, which had put the
// selection on the right button and the layout move on the left. Using it said
// otherwise: the left button is where a hand expects "use this", and moving a
// tool around is the odd job that belongs on the odd button. The left drag is
// deliberately empty — an outbound resource drag is the obvious later claimant.
//
// Three layers: the pure decision, the press-time latch every later handler
// reads, and the single mode that follows from one constant.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    MOUSE_BUTTON,
    gestureOfIntent,
    gridPointerIntent,
    isSelectionIntent,
    pressCarriesSelectionModifier,
    type GridPointerIntent,
} from '@/utils/gridPointerIntent';
import { SINGLE_INTERACTION_MODE, allowsLayoutEditing } from '@/utils/interactionMode';
import {
    cancelContextMenuSuppression,
    suppressNextContextMenu,
} from '@/utils/contextMenuSuppression';

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
    it('a plain LEFT press is "use it": a click runs the tool', () => {
        expect(intentOf(MOUSE_BUTTON.left)).toBe('use');
    });

    it('Shift + left ADDS, Ctrl + left REMOVES', () => {
        expect(intentOf(MOUSE_BUTTON.left, { shiftKey: true })).toBe('select-add');
        expect(intentOf(MOUSE_BUTTON.left, { ctrlKey: true })).toBe('select-remove');
    });

    it('both modifiers held resolve to ADD, as everywhere else in the panel', () => {
        expect(intentOf(MOUSE_BUTTON.left, { shiftKey: true, ctrlKey: true })).toBe(
            'select-add'
        );
    });

    it('the RIGHT button is one intent, whatever is held', () => {
        // Travel, not a key, decides which of its two readings it is: a click
        // opens the menu, a drag moves the tool. A modifier must not turn it
        // into a third thing — that was the rejected model.
        for (const modifiers of [{}, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
            expect(intentOf(MOUSE_BUTTON.right, modifiers)).toBe('secondary');
        }
    });

    it('any other button means nothing at all', () => {
        expect(intentOf(MOUSE_BUTTON.middle)).toBe('none');
        expect(intentOf(3)).toBe('none');
        expect(intentOf(MOUSE_BUTTON.middle, { shiftKey: true })).toBe('none');
    });

    it('on macOS Cmd removes, and Ctrl + LEFT is the secondary click', () => {
        // Ctrl + left IS a right click there, so it reads as secondary — not
        // as a removal, and not as "use".
        expect(intentOf(MOUSE_BUTTON.left, { metaKey: true }, MAC)).toBe('select-remove');
        expect(intentOf(MOUSE_BUTTON.left, { ctrlKey: true }, MAC)).toBe('secondary');
        expect(intentOf(MOUSE_BUTTON.left, { shiftKey: true }, MAC)).toBe('select-add');
        expect(intentOf(MOUSE_BUTTON.right, { ctrlKey: true }, MAC)).toBe('secondary');
    });

    it('hands the selection a gesture only for the two selection intents', () => {
        expect(gestureOfIntent('select-add')).toBe('add');
        expect(gestureOfIntent('select-remove')).toBe('remove');
        for (const intent of ['use', 'secondary', 'none'] as GridPointerIntent[]) {
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
                    expect(
                        gestureOfIntent(gridPointerIntent(press(button, modifiers), isMac))
                    ).not.toBe('replace');
                }
            }
        }
    });

    it('knows a selection modifier by the key, for the handles outside a grid', () => {
        expect(pressCarriesSelectionModifier(press(0, { shiftKey: true }), WINDOWS)).toBe(true);
        expect(pressCarriesSelectionModifier(press(0, { ctrlKey: true }), WINDOWS)).toBe(true);
        expect(pressCarriesSelectionModifier(press(0), WINDOWS)).toBe(false);
        // macOS: Cmd is the subtractive key, plain Ctrl is the secondary click.
        expect(pressCarriesSelectionModifier(press(0, { metaKey: true }), MAC)).toBe(true);
        expect(pressCarriesSelectionModifier(press(0, { ctrlKey: true }), MAC)).toBe(false);
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
        // A modifier released mid-gesture, or a second button pressed, must
        // not change what the gesture was.
        const afterDown = grid.slice(grid.indexOf('const handleGridPointerMoveCapture'));
        expect(afterDown).not.toMatch(/\bevent\.button\b/);
        expect(afterDown).not.toMatch(/shiftKey|ctrlKey|metaKey/);
        expect(afterDown).not.toMatch(/pointerIntentOfEvent|gestureOfEvent/);
        expect(hook).not.toMatch(/\bevent\.button\b/);
        expect(hook).not.toMatch(/shiftKey|ctrlKey|metaKey/);
    });

    it('the rectangle takes only the two selection intents', () => {
        expect(hook).toMatch(/const gesture = gestureOfIntent\(intent\);/);
        expect(hook).toMatch(/if \(gesture === null\) \{\s*return false;\s*\}/);
    });

    it('a selection press that stayed put means its one cell', () => {
        expect(hook).toMatch(
            /if \(!finished\.dragging\) \{[\s\S]*latest\.current\.onCellPress\(\s*gridCellKey\(finished\.anchor\.row, finished\.anchor\.column\),\s*finished\.gesture\s*\)/
        );
        expect(grid).toMatch(/onCellPress: \(cell, gesture\) => handleCellPress\(cell, gesture\)/);
        expect(grid).toMatch(/selectCell\(selectionContext, cellKey, gesture\);/);
    });

    it('ONLY a plain left click reaches the tool', () => {
        const click = grid.slice(
            grid.indexOf('const handleGridClickCapture'),
            grid.indexOf('const handleCellPress')
        );
        expect(click).toMatch(/if \(intent === 'use' && wasClick\) \{\s*return;\s*\}/);
        expect(click).toMatch(/event\.stopPropagation\(\);/);
        // Travelled once is travelled for good: a press that wandered off and
        // came back releases at its origin, and the endpoint distance alone
        // would call that a click and run the tool.
        expect(click).toMatch(/!pressTravelledRef\.current &&\s*isClickNotDrag\(/);
        // An activated drag says so itself, because the drag overlay becomes
        // the event target and the grid stops seeing the moves.
        expect(grid).toMatch(
            /if \(isDragging\) \{\s*pressOriginRef\.current = null;\s*pressTravelledRef\.current = true;/
        );
        // A left DRAG is reserved: its closing click must not run anything.
        expect(click).not.toMatch(/selectCell|selectCells/);
        expect(grid).toMatch(/onClickCapture=\{handleGridClickCapture\}/);
    });

    it('only a travelled RIGHT press suppresses the menu — never globally', () => {
        const menu = grid.slice(
            grid.indexOf('const handleGridContextMenuCapture'),
            grid.indexOf('const handleGridClickCapture')
        );
        expect(menu).toMatch(
            /if \(intent === 'secondary' && travelled\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/
        );
        expect(grid).toMatch(/onContextMenuCapture=\{handleGridContextMenuCapture\}/);
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
});

// --- 3. Which button starts which drag ----------------------------------------------

describe('a tool moves on the right button, a category on the left', () => {
    const sensor = codeOf('sensors/ScrollAwarePointerSensor.ts');
    const tool = codeOf('components/button/SortableButtonItem.tsx');
    const activator = codeOf('utils/dragActivator.ts');

    it('the sensor accepts both buttons, so each draggable can choose', () => {
        // dnd-kit's own activator refuses anything but the left button.
        expect(sensor).toMatch(/static activators/);
        expect(sensor).toMatch(/event\.button !== MOUSE_BUTTON\.left &&\s*event\.button !== MOUSE_BUTTON\.right/);
    });

    it('a TOOL activates on the right button only', () => {
        expect(tool).toMatch(
            /const dragListeners = activateOnButton\(listeners, MOUSE_BUTTON\.right\);/
        );
        // and the raw listeners are not also spread somewhere, which would
        // hand the left button a move after all.
        expect(tool).not.toMatch(/\{\.\.\.listeners\}/);
        expect(tool).toMatch(/\{\.\.\.dragListeners\}/);
    });

    it('a CATEGORY handle activates on the left button, never while selecting', () => {
        for (const file of [
            'components/buttons-panel/SortableCategoryBlock.tsx',
            'components/buttons-panel/SortableCategoryTab.tsx',
            'components/buttons-panel/SortableCategoryFolder.tsx',
        ]) {
            const code = codeOf(file);
            expect(code).toMatch(
                /const dragListeners = activateOnButton\(listeners, MOUSE_BUTTON\.left, \{\s*blockSelectionModifier: true,\s*\}\);/
            );
            expect(code).not.toMatch(/\{\.\.\.listeners\}/);
        }
    });

    it('the filter is a wrapper, not a copy of the grammar', () => {
        expect(activator).toMatch(/if \(event\.button !== button\) \{\s*return;\s*\}/);
        expect(activator).toMatch(/pressCarriesSelectionModifier\(event, isMacPlatform\(\)\)/);
        // Nothing is dropped from the map: the touch activator in particular
        // must survive, or a long press stops moving anything.
        expect(activator).toMatch(/\.\.\.listeners,/);
    });
});

// --- 3b. The menu a finished right drag must not open --------------------------------

describe('a finished right drag swallows exactly one context menu', () => {
    /** A document that records its listeners, and a menu event with spies. */
    function fakeDoc() {
        const listeners = new Map<string, Set<(event: unknown) => void>>();
        const timers = new Map<number, () => void>();
        let nextTimer = 1;
        const doc = {
            addEventListener: (type: string, fn: (event: unknown) => void) => {
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type)!.add(fn);
            },
            removeEventListener: (type: string, fn: (event: unknown) => void) => {
                listeners.get(type)?.delete(fn);
            },
            defaultView: {
                setTimeout: (fn: () => void) => {
                    timers.set(nextTimer, fn);
                    return nextTimer++;
                },
                clearTimeout: (id: number) => timers.delete(id),
            },
        };
        return {
            doc: doc as unknown as Document,
            count: () => listeners.get('contextmenu')?.size ?? 0,
            fire: () => {
                const event = {
                    preventDefault: vi.fn(),
                    stopPropagation: vi.fn(),
                };
                listeners.get('contextmenu')?.forEach((fn) => fn(event));
                return event;
            },
            expire: () => timers.forEach((fn) => fn()),
        };
    }

    it('swallows the next menu, and only that one', () => {
        const f = fakeDoc();
        suppressNextContextMenu(f.doc);
        const first = f.fire();
        expect(first.preventDefault).toHaveBeenCalledOnce();
        expect(first.stopPropagation).toHaveBeenCalledOnce();
        // Gone afterwards: a right CLICK right after a drag still gets a menu.
        expect(f.count()).toBe(0);
        const second = f.fire();
        expect(second.preventDefault).not.toHaveBeenCalled();
    });

    it('never stands: it clears itself when no menu arrives', () => {
        // A drag cancelled by Escape, or a platform that reports the menu on
        // the press, must not leave the panel menu-less.
        const f = fakeDoc();
        suppressNextContextMenu(f.doc);
        expect(f.count()).toBe(1);
        f.expire();
        expect(f.count()).toBe(0);
    });

    it('can be dropped on demand, and never stacks', () => {
        const f = fakeDoc();
        suppressNextContextMenu(f.doc);
        suppressNextContextMenu(f.doc);
        expect(f.count()).toBe(1);
        cancelContextMenuSuppression();
        expect(f.count()).toBe(0);
    });

    it('is armed by the DRAG, for a right press only', () => {
        // The grid that latched the press is remounted while a button drag is
        // in flight (ListModeContent swaps the sortable block), so the
        // suppression is armed from the drag provider, which is not.
        const context = codeOf('contexts/ButtonDragContext.tsx');
        expect(context).toMatch(
            /const activator = event\.activatorEvent as MouseEvent \| undefined;\s*if \(activator\?\.button === MOUSE_BUTTON\.right\) \{\s*suppressNextContextMenu\(activeDocument\);/
        );
    });
});

// --- 4. One mode --------------------------------------------------------------------

describe('the panel runs in one mode', () => {
    const panel = codeOf('components/buttons-panel/PanelContent.tsx');
    const nav = codeOf('components/shared/NavigationBar.tsx');

    it('reads a constant instead of the stored mode', () => {
        expect(SINGLE_INTERACTION_MODE).toBe('edit');
        expect(panel).toMatch(/const interactionMode = SINGLE_INTERACTION_MODE;/);
        expect(panel).not.toMatch(/panelConfig\.interactionMode/);
    });

    it('leaves every layout affordance permanently available', () => {
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
        expect(codeOf('utils/interactionMode.ts')).toMatch(
            /export function allowsLayoutEditing/
        );
    });

    it('a stored "locked" changes nothing at runtime', () => {
        expect(panel).not.toMatch(/interactionMode === 'locked'|isLocked/);
    });
});
