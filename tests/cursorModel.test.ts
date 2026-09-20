// tests/cursorModel.test.ts
//
// The cursor says what a press does HERE (cell-selection-colors.md §4.5):
//
//     a layout drag in flight          -> grabbing
//     Ctrl/Cmd held                    -> remove (a bold minus)
//     Shift held                       -> add (`cell`, the bold plus)
//     a tool that can be moved (edit)  -> grab
//     otherwise                        -> the surface's own: pointer on a tool
//                                         that runs and on the `+`, default on
//                                         a cell or a gutter
//
// and a list category moves only by its handle (§5a).
//
// Three layers, because there is no browser here:
// 1. the modifier tracking, RUN against a fake document;
// 2. the stylesheet, parsed, with the cascade question — which rule wins on
//    which surface — answered by computing specificity rather than trusting
//    source order;
// 3. the handle wiring, at source level.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'obsidian';
import {
    SELECTION_INTENT_ATTRIBUTE,
    trackSelectionIntent,
} from '@/components/buttons-panel/CellSelectionModifierCursor';

// --- 1. The modifier tracking -----------------------------------------------------

type Listener = (event: unknown) => void;

class FakeEventTarget {
    private readonly listeners = new Map<string, Set<Listener>>();

    addEventListener(type: string, listener: Listener): void {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type)!.add(listener);
    }

    removeEventListener(type: string, listener: Listener): void {
        this.listeners.get(type)?.delete(listener);
    }

    dispatch(type: string, event: unknown = {}): void {
        this.listeners.get(type)?.forEach((listener) => listener(event));
    }

    count(): number {
        let total = 0;
        this.listeners.forEach((set) => (total += set.size));
        return total;
    }
}

function fakePanel() {
    const win = new FakeEventTarget();
    const doc = Object.assign(new FakeEventTarget(), { defaultView: win });
    const attributes = new Map<string, string>();
    const panel = {
        ownerDocument: doc,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
    };
    return {
        panel: panel as unknown as HTMLElement,
        doc,
        win,
        intent: () => attributes.get(SELECTION_INTENT_ATTRIBUTE) ?? null,
    };
}

/** A key or pointer event as the listener sees it, with spies on its brakes. */
function input(flags: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) {
    return {
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        ...flags,
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
        preventDefault: vi.fn(),
    };
}

describe('the held modifier, mirrored onto the panel', () => {
    afterEach(() => {
        Platform.isMacOS = false;
    });

    it('Shift means ADD — over a tool and over an empty cell alike', () => {
        // The attribute sits on the panel; which surface is under the pointer
        // only decides the fallback, never the intent.
        const f = fakePanel();
        trackSelectionIntent(f.panel);
        f.doc.dispatch('keydown', input({ shiftKey: true }));
        expect(f.intent()).toBe('add');
    });

    it('Ctrl means REMOVE', () => {
        const f = fakePanel();
        trackSelectionIntent(f.panel);
        f.doc.dispatch('keydown', input({ ctrlKey: true }));
        expect(f.intent()).toBe('remove');
    });

    it('with both held it shows what the press will really do: add', () => {
        const f = fakePanel();
        trackSelectionIntent(f.panel);
        f.doc.dispatch('keydown', input({ shiftKey: true, ctrlKey: true }));
        expect(f.intent()).toBe('add');
    });

    it('on macOS Cmd is the remove key, and Ctrl (the secondary click) is not', () => {
        Platform.isMacOS = true;
        const f = fakePanel();
        trackSelectionIntent(f.panel);
        f.doc.dispatch('keydown', input({ metaKey: true }));
        expect(f.intent()).toBe('remove');
        f.doc.dispatch('keydown', input({ ctrlKey: true }));
        expect(f.intent()).toBeNull();
    });

    it('releasing the key gives the surface its own cursor back at once', () => {
        const f = fakePanel();
        trackSelectionIntent(f.panel);
        f.doc.dispatch('keydown', input({ shiftKey: true }));
        f.doc.dispatch('keyup', input());
        expect(f.intent()).toBeNull();
        f.doc.dispatch('keydown', input({ ctrlKey: true }));
        f.doc.dispatch('keyup', input());
        expect(f.intent()).toBeNull();
    });

    it('a pointer move corrects a key that changed while the window was away', () => {
        const f = fakePanel();
        trackSelectionIntent(f.panel);
        f.doc.dispatch('pointermove', input({ shiftKey: true }));
        expect(f.intent()).toBe('add');
        f.doc.dispatch('pointermove', input());
        expect(f.intent()).toBeNull();
    });

    it('a lost window focus clears it — no modifier hangs after Alt-Tab', () => {
        const f = fakePanel();
        trackSelectionIntent(f.panel);
        f.doc.dispatch('keydown', input({ ctrlKey: true }));
        f.win.dispatch('blur');
        expect(f.intent()).toBeNull();
    });

    it('stopping (unmount, a search, a closed view) removes every listener and the state', () => {
        const f = fakePanel();
        const stop = trackSelectionIntent(f.panel);
        f.doc.dispatch('keydown', input({ shiftKey: true }));
        stop();
        expect(f.intent()).toBeNull();
        expect(f.doc.count()).toBe(0);
        expect(f.win.count()).toBe(0);
        f.doc.dispatch('keydown', input({ shiftKey: true }));
        expect(f.intent()).toBeNull();
    });

    it('is visual only: no event is ever stopped or cancelled', () => {
        const f = fakePanel();
        trackSelectionIntent(f.panel);
        const events = [input({ shiftKey: true }), input({ ctrlKey: true }), input()];
        f.doc.dispatch('keydown', events[0]);
        f.doc.dispatch('pointermove', events[1]);
        f.doc.dispatch('keyup', events[2]);
        for (const event of events) {
            expect(event.stopPropagation).not.toHaveBeenCalled();
            expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
            expect(event.preventDefault).not.toHaveBeenCalled();
        }
    });
});

// --- 2. The stylesheet --------------------------------------------------------------

interface CssRule {
    selector: string;
    declarations: Map<string, string>;
    file: string;
}

function rulesOf(file: string): CssRule[] {
    const source = readFileSync(
        new URL(`../src/components/${file}`, import.meta.url),
        'utf8'
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules: CssRule[] = [];
    // Flat stylesheets only (no nesting); @media blocks are skipped whole.
    const withoutMedia = source.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    for (const match of withoutMedia.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const declarations = new Map<string, string>();
        for (const part of (match[2] ?? '').split(/;(?![^(]*\))/)) {
            const colon = part.indexOf(':');
            if (colon === -1) continue;
            declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
        }
        for (const selector of (match[1] ?? '').split(',')) {
            rules.push({ selector: selector.trim(), declarations, file });
        }
    }
    return rules;
}

/** [ids, classes + attributes + pseudo-classes, elements] — enough for these selectors. */
function specificity(selector: string): [number, number, number] {
    const withoutPseudoElements = selector.replace(/::[\w-]+/g, '');
    const ids = (withoutPseudoElements.match(/#[\w-]+/g) ?? []).length;
    const classes =
        (withoutPseudoElements.match(/\.[\w-]+/g) ?? []).length +
        (withoutPseudoElements.match(/\[[^\]]+\]/g) ?? []).length +
        (withoutPseudoElements.match(/:(?!:)[\w-]+/g) ?? []).length;
    const elements = withoutPseudoElements
        .replace(/\[[^\]]+\]/g, '')
        .split(/[\s>+~]+/)
        .filter((part) => /^[a-z]/i.test(part)).length;
    return [ids, classes, elements];
}

const beats = (a: string, b: string): boolean => {
    const x = specificity(a);
    const y = specificity(b);
    for (let i = 0; i < 3; i += 1) {
        const [xi, yi] = [x[i] ?? 0, y[i] ?? 0];
        if (xi !== yi) return xi > yi;
    }
    return false;
};

const palette = rulesOf('buttons-panel/PaletteGrid.css');
const categoryDrag = rulesOf('buttons-panel/CategoryDrag.css');
const buttonCss = rulesOf('button/Button.css');
const buttonDragCss = rulesOf('buttons-panel/ButtonDrag.css');

const cursorRule = (rules: CssRule[], selector: string): CssRule => {
    const rule = rules.find((r) => r.selector === selector && r.declarations.has('cursor'));
    if (!rule) throw new Error(`no cursor rule for ${selector}`);
    return rule;
};

const MODEL = {
    grid: 'body .buttons-panel .ocap-palette-grid',
    cell: 'body .buttons-panel .ocap-palette-grid .ocap-grid-slot',
    lockedTool:
        'body .buttons-panel .ocap-palette-grid .ocap-grid-slot button.buttons-panel-simple-button',
    add: 'body .buttons-panel .ocap-palette-grid .ocap-grid-slot button.ocap-slot-add',
    movableWrapper: 'body .buttons-panel .ocap-palette-grid .ocap-grid-slot .sortable-button-item',
    movableTool:
        'body .buttons-panel .ocap-palette-grid .ocap-grid-slot .sortable-button-item button.buttons-panel-simple-button',
};

describe('the cursor on each grid surface, without a modifier', () => {
    it('a movable tool (edit mode) shows the open hand', () => {
        expect(cursorRule(palette, MODEL.movableTool).declarations.get('cursor')).toBe(
            'var(--ocap-selection-cursor, grab)'
        );
        expect(cursorRule(palette, MODEL.movableWrapper).declarations.get('cursor')).toBe(
            'var(--ocap-selection-cursor, grab)'
        );
    });

    it('...and actually wins over the tool’s own pointer', () => {
        // The bug this replaces: the hand sat on the drag WRAPPER, but the
        // pointer is over the BUTTON, whose own `cursor: pointer` won there.
        const toolPointer = buttonCss.find(
            (r) =>
                r.declarations.get('cursor') === 'pointer' &&
                r.selector.includes('button.buttons-panel-simple-button')
        )!;
        expect(beats(MODEL.movableTool, toolPointer.selector)).toBe(true);
        expect(beats(MODEL.movableTool, MODEL.lockedTool)).toBe(true);
    });

    it('a tool that is not movable (locked, a search) keeps the click pointer', () => {
        expect(cursorRule(palette, MODEL.lockedTool).declarations.get('cursor')).toBe(
            'var(--ocap-selection-cursor, pointer)'
        );
    });

    it('an empty cell and the gutters show the plain arrow — nothing to grab', () => {
        expect(cursorRule(palette, MODEL.cell).declarations.get('cursor')).toBe(
            'var(--ocap-selection-cursor, default)'
        );
        expect(cursorRule(palette, MODEL.grid).declarations.get('cursor')).toBe(
            'var(--ocap-selection-cursor, default)'
        );
    });

    it('the `+` keeps its pointer, and wins over its base style', () => {
        expect(cursorRule(palette, MODEL.add).declarations.get('cursor')).toBe(
            'var(--ocap-selection-cursor, pointer)'
        );
        const base = cursorRule(palette, '.buttons-panel button.ocap-slot-add');
        expect(beats(MODEL.add, base.selector)).toBe(true);
    });

    it('no other rule gives a grid surface a cursor outside the model', () => {
        // Priority is built into ONE property, not decided by specificity: a
        // grid rule setting a plain cursor would be a second, competing voice.
        const gridSurface = /ocap-palette-grid|ocap-grid-slot|sortable-button-item/;
        const outside = [...palette, ...buttonDragCss].filter(
            (r) =>
                gridSurface.test(r.selector) &&
                r.declarations.has('cursor') &&
                !/^var\(--ocap-selection-cursor, /.test(r.declarations.get('cursor')!) &&
                r.declarations.get('cursor') !== 'inherit' &&
                !r.selector.includes('buttons-panel-is-dragging')
        );
        expect(outside.map((r) => r.selector)).toEqual([]);
    });

    it('pressing a tool does not already show the closed hand — only a real drag does', () => {
        const early = [...palette, ...buttonDragCss].filter(
            (r) => r.selector.includes(':active') && r.declarations.get('cursor') === 'grabbing'
        );
        expect(early).toEqual([]);
    });
});

describe('the cursor with a modifier held (locked and edit alike)', () => {
    const intent = (value: string) =>
        palette.find(
            (r) =>
                r.selector ===
                `body .buttons-panel .buttons-panel-panel-content[data-ocap-selection-intent='${value}']`
        )!;

    it('Shift sets the bold plus of `cell`', () => {
        expect(intent('add').declarations.get('--ocap-selection-cursor')).toBe('cell');
    });

    it('Ctrl/Cmd sets a bold minus, centred, falling back to `cell`', () => {
        const value = intent('remove').declarations.get('--ocap-selection-cursor')!;
        const match = /^url\("data:image\/svg\+xml,([^"]+)"\) (\d+) (\d+), cell$/.exec(value);
        expect(match).not.toBeNull();
        const svg = decodeURIComponent(match?.[1] ?? '');
        expect(svg).toMatch(/^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' width='24' height='24'/);
        // One wide, flat bar: a minus, white with a black rim like `cell`.
        const rect = /<rect x='([\d.]+)' y='([\d.]+)' width='([\d.]+)' height='([\d.]+)' fill='white' stroke='black'/.exec(svg);
        expect(rect).not.toBeNull();
        const [x = NaN, y = NaN, width = NaN, height = NaN] = (rect ?? []).slice(1).map(Number);
        expect(width).toBeGreaterThan(height * 2);
        // The hotspot is the middle of the bar.
        expect(Number(match![2])).toBe(x + width / 2);
        expect(Number(match![3])).toBe(y + height / 2);
        // No characters a CSS url() or a data URI would choke on.
        expect(match?.[1]).not.toMatch(/[<>#"]/);
    });

    it('everything inside the grid follows the modifier, including a movable tool', () => {
        // The modifier is not a competing rule: it is the value every grid
        // rule consults first. Checked on every surface of the model.
        for (const selector of Object.values(MODEL)) {
            expect(cursorRule(palette, selector).declarations.get('cursor')).toMatch(
                /^var\(--ocap-selection-cursor, /
            );
        }
        const rest = cursorRule(
            palette,
            'body .buttons-panel .buttons-panel-panel-content[data-ocap-selection-intent] .ocap-palette-grid *'
        );
        expect(rest.declarations.get('cursor')).toBe('inherit');
    });
});

describe('a layout drag in flight', () => {
    it('shows the closed hand over the whole panel, above everything else', () => {
        for (const selector of [
            'body .buttons-panel.buttons-panel-is-dragging',
            'body .buttons-panel.buttons-panel-is-dragging *',
        ]) {
            expect(cursorRule(palette, selector).declarations.get('cursor')).toBe(
                'grabbing !important'
            );
        }
    });

    it('is the only `!important` of the cursor model', () => {
        const important = [...palette, ...categoryDrag].filter((r) =>
            [...r.declarations.values()].some((v) => v.includes('!important'))
        );
        expect(important.map((r) => r.selector)).toEqual([
            'body .buttons-panel.buttons-panel-is-dragging',
            'body .buttons-panel.buttons-panel-is-dragging *',
        ]);
    });

    it('is driven by dnd-kit’s ACTIVE drag, not by a press', () => {
        const context = readFileSync(
            new URL('../src/contexts/ButtonDragContext.tsx', import.meta.url),
            'utf8'
        );
        expect(context).toMatch(
            /if \(isButtonDragActive \|\| isCategoryDragActive\) \{\s*setPanelTouchDragLock\(true\);/
        );
        const lock = readFileSync(new URL('../src/utils/touchDragLock.ts', import.meta.url), 'utf8');
        expect(lock).toMatch(/PANEL_TOUCH_DRAG_LOCK_CLASS = 'buttons-panel-is-dragging'/);
    });
});

// --- 3. The category handle ---------------------------------------------------------

function codeOf(relativePath: string): string {
    return readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

describe('a list category moves only by its handle', () => {
    const block = codeOf('components/buttons-panel/SortableCategoryBlock.tsx');
    const list = codeOf('components/buttons-panel/ListModeContent.tsx');
    const preview = codeOf('components/buttons-panel/CategoryListDragPreview.tsx');

    const handleJsx = block.slice(block.indexOf('const handle = ('), block.indexOf('const blockClassName'));
    const blockJsx = block.slice(block.indexOf('<div\n            ref={setNodeRef}'));

    it('uses dnd-kit’s own activator mechanism', () => {
        expect(block).toMatch(/setActivatorNodeRef/);
        expect(block).toMatch(/setActivatorNodeRef\(el\);/);
        expect(handleJsx).toMatch(/\{\.\.\.attributes\}/);
        expect(handleJsx).toMatch(/\{\.\.\.dragListeners\}/);
    });

    it('the block stays the sortable item but is no longer an activator', () => {
        expect(blockJsx).toMatch(/ref=\{setNodeRef\}/);
        expect(blockJsx).not.toMatch(/\.\.\.attributes|\.\.\.dragListeners|\.\.\.listeners/);
        expect(block).not.toMatch(/'category-drag-handle'/);
    });

    it('hands dnd-kit its listeners unwrapped: the left button always drags', () => {
        // Selecting moved to the right button (2026-09-20), so a held
        // modifier no longer has to suppress anything here.
        expect(block).toMatch(/const dragListeners = listeners;/);
        expect(block).not.toMatch(/suppressDragOnSelectionModifier/);
    });

    it('a click on the handle neither folds the header it sits in nor bubbles on', () => {
        expect(handleJsx).toMatch(/onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
        expect(handleJsx).toMatch(/onKeyDown=\{\(event\) => event\.stopPropagation\(\)\}/);
    });

    it('sits first in the header, before the icon and the name', () => {
        expect(list).toMatch(
            /renderTitle=\{\(handle\) => \(\s*<div ref=\{bindTitleRef\} className=\{titleClassName\} \{\.\.\.titleHandlers\}>\s*\{handle \?\? <CategoryDragHandleSpace \/>\}\s*\{titleContent\}/
        );
        expect(list).toMatch(/const titleContent = \(\s*<>\s*<span\s+className=\{\s*isDynamic\s*\? 'category-icon-left/);
    });

    it('the header keeps folding the category on click', () => {
        const handlers = list.slice(list.indexOf('const titleHandlers = {'), list.indexOf('const buttonGridSection'));
        expect(handlers).toMatch(/onClick: \(e: React\.MouseEvent\) => \{[\s\S]*next\.set\(category\.id, !isOpen\)/);
    });

    it('exists only where reordering is allowed — edit mode, no search', () => {
        expect(list).toMatch(/if \(categorySortEnabled\) \{\s*return \(\s*<SortableCategoryBlock/);
        const panel = codeOf('components/buttons-panel/PanelContent.tsx');
        expect(panel).toMatch(/const dragReorderEnabled = normalizedQuery\.length === 0 && enableEditMode;/);
    });

    it('elsewhere keeps only its empty SPACE, so the header does not shift with the mode', () => {
        expect(list).toMatch(
            /<div ref=\{bindTitleRef\} className=\{titleClassName\} \{\.\.\.titleHandlers\}>\s*<CategoryDragHandleSpace \/>\s*\{titleContent\}/
        );
        const inert = cursorRule(
            categoryDrag,
            'body .buttons-panel .buttons-panel-category-title .ocap-category-drag-handle--inert'
        );
        expect(inert.declarations.get('pointer-events')).toBe('none');
        expect(inert.declarations.get('cursor')).toBe('inherit');
        expect(block).toMatch(/--inert/);
        expect(block).toMatch(/aria-hidden="true"/);
    });

    it('the handle shows the open hand; the block and its free space do not', () => {
        const handle = cursorRule(
            categoryDrag,
            'body .buttons-panel .buttons-panel-category-title .ocap-category-drag-handle'
        );
        expect(handle.declarations.get('cursor')).toBe('grab');
        expect(beats(handle.selector, '.buttons-panel .buttons-panel-category-title.is-collapsible')).toBe(true);
        const blockCursor = categoryDrag.filter(
            (r) => r.selector.includes('sortable-category-item') && r.declarations.has('cursor')
        );
        expect(blockCursor).toEqual([]);
    });

    it('only the handle refuses touch panning; the block may scroll again', () => {
        const touch = categoryDrag.filter((r) => r.declarations.has('touch-action'));
        expect(touch.map((r) => r.selector)).toContain(
            'body .buttons-panel .buttons-panel-category-title .ocap-category-drag-handle'
        );
        expect(touch.some((r) => /sortable-category-item\s*$/.test(r.selector))).toBe(false);
    });

    it('the drag preview draws the same header, grip included', () => {
        expect(preview).toMatch(/<span className=\{CATEGORY_DRAG_HANDLE_CLASS\} ref=\{handleRef\} aria-hidden="true" \/>/);
        expect(preview).toMatch(/setIcon\(handleRef\.current, 'grip-vertical'\)/);
    });
});
