// tests/selectionBackdrop.test.ts
//
// What counts as empty panel background — the surface whose click may mean
// "clear the selection" precisely because it means nothing else.
//
// The rule is an EXCLUSION list, and that is the thing worth pinning: a control
// that goes missing from it does not break quietly, it starts having its clicks
// read as "never mind" as well. Every surface named in the product decision is
// checked here by name.
//
// There is no DOM in this environment, so the test brings a miniature one:
// elements with a parent, a tag, classes and attributes, plus `closest` and
// `contains`. It understands exactly the three selector shapes the exclusion
// list uses (`tag`, `.class`, `[attr]` / `[attr="value"]`), which is enough to
// exercise the real function rather than a paraphrase of it. The browser's own
// matching is covered by the live smoke run.

import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeAll } from 'vitest';
import {
    SELECTION_BACKDROP_EXCLUDES,
    isSelectionBackdrop,
} from '@/utils/selectionBackdrop';

class FakeElement {
    tagName: string;
    classList: string[];
    attributes: Record<string, string>;
    parentElement: FakeElement | null = null;
    children: FakeElement[] = [];

    constructor(
        tag: string,
        options: { class?: string; attrs?: Record<string, string> } = {}
    ) {
        this.tagName = tag.toUpperCase();
        this.classList = options.class ? options.class.split(/\s+/) : [];
        this.attributes = options.attrs ?? {};
    }

    append(child: FakeElement): FakeElement {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    private matchesOne(selector: string): boolean {
        const trimmed = selector.trim();
        if (trimmed.startsWith('.')) {
            return this.classList.includes(trimmed.slice(1));
        }
        if (trimmed.startsWith('[')) {
            const body = trimmed.slice(1, -1);
            const eq = body.indexOf('=');
            if (eq === -1) {
                return body in this.attributes;
            }
            const name = body.slice(0, eq);
            const value = body.slice(eq + 1).replace(/^["']|["']$/g, '');
            return this.attributes[name] === value;
        }
        return this.tagName === trimmed.toUpperCase();
    }

    matches(selector: string): boolean {
        return selector.split(',').some((one) => this.matchesOne(one));
    }

    closest(selector: string): FakeElement | null {
        if (this.matches(selector)) {
            return this;
        }
        return this.parentElement?.closest(selector) ?? null;
    }

    contains(other: FakeElement | null): boolean {
        let node = other;
        while (node) {
            if (node === this) return true;
            node = node.parentElement;
        }
        return false;
    }
}

/**
 * The fake stands in for a real Element at the call boundary. It implements
 * exactly what `isSelectionBackdrop` uses — `instanceof`, `closest`,
 * `contains` — and nothing else, so the cast is where that claim is made.
 */
const asElement = (node: FakeElement): Element => node as unknown as Element;

beforeAll(() => {
    // `isSelectionBackdrop` narrows with `instanceof Element`.
    (globalThis as { Element?: unknown }).Element = FakeElement;
});

/** A panel with one category, one grid, one cell and one tool inside it. */
function buildPanel() {
    const panel = new FakeElement('div', { class: 'buttons-panel-panel-content' });
    const list = panel.append(new FakeElement('div', { class: 'buttons-panel-list-mode' }));
    // The real list block: the sortable ITEM, but no longer its activator —
    // dnd-kit's props (role="button" among them) live on the handle.
    const category = list.append(
        new FakeElement('div', {
            class: 'buttons-panel-category sortable-category-item',
        })
    );
    const title = category.append(
        new FakeElement('div', {
            class: 'buttons-panel-category-title',
            attrs: { role: 'button' },
        })
    );
    const handle = title.append(
        new FakeElement('span', {
            class: 'ocap-category-drag-handle',
            attrs: { role: 'button', tabindex: '0', 'aria-roledescription': 'sortable' },
        })
    );
    const handleIcon = handle.append(new FakeElement('svg', { class: 'svg-icon' }));
    // The same handle, imagined outside a title: it must not depend on the
    // title to stay excluded.
    const looseHandle = panel.append(
        new FakeElement('span', { class: 'ocap-category-drag-handle' })
    );
    const frame = category.append(new FakeElement('div', { class: 'ocap-grid-frame' }));
    const frameMain = frame.append(new FakeElement('div', { class: 'ocap-grid-frame-main' }));
    const grid = frameMain.append(
        new FakeElement('div', { class: 'buttons-panel-grid ocap-palette-grid' })
    );
    const cell = grid.append(
        new FakeElement('div', { class: 'ocap-grid-slot', attrs: { 'data-slot': '0' } })
    );
    const tool = cell.append(
        new FakeElement('button', { class: 'buttons-panel-simple-button' })
    );
    const toolLabel = tool.append(new FakeElement('span', { class: 'button-text' }));
    const resizeEdge = frameMain.append(
        new FakeElement('button', { class: 'ocap-grid-edge ocap-grid-edge--column' })
    );
    const palette = category.append(new FakeElement('div', { class: 'ocap-cell-palette' }));
    const swatch = palette.append(
        new FakeElement('button', { class: 'ocap-cell-swatch' })
    );
    const variantBar = category.append(new FakeElement('div', { class: 'ocap-variant-bar' }));
    const variantSelect = variantBar.append(
        new FakeElement('select', { class: 'ocap-variant-select' })
    );
    const outside = new FakeElement('div', { class: 'workspace-leaf' });
    // Drag handles whose CLICK does something: a tab switches, a tile opens.
    const tabs = panel.append(new FakeElement('div', { class: 'buttons-panel-tabs' }));
    const tab = tabs.append(
        new FakeElement('div', {
            class: 'sortable-category-tab category-drag-handle',
            attrs: { role: 'button' },
        })
    );
    const tabLabel = tab.append(new FakeElement('span', { class: 'tab-label' }));
    const folder = panel.append(
        new FakeElement('div', {
            class: 'sortable-category-folder category-drag-handle',
            attrs: { role: 'button' },
        })
    );

    return {
        panel,
        list,
        category,
        title,
        handle,
        handleIcon,
        looseHandle,
        grid,
        cell,
        tool,
        toolLabel,
        resizeEdge,
        palette,
        swatch,
        variantBar,
        variantSelect,
        outside,
        tab,
        tabLabel,
        folder,
    };
}

describe('empty panel background clears; everything else keeps its meaning', () => {
    const dom = buildPanel();

    const panel = asElement(dom.panel);

    it('treats the panel background itself as backdrop', () => {
        expect(isSelectionBackdrop(asElement(dom.panel), panel)).toBe(true);
        expect(isSelectionBackdrop(asElement(dom.list), panel)).toBe(true);
    });

    it('treats the free area of a category as backdrop', () => {
        // The block is the sortable item but not a drag surface any more:
        // only its handle starts a reorder, so its free area is plain
        // background. The decision still waits for the click (see
        // CellSelectionBackdrop), because a press alone must destroy nothing.
        expect(isSelectionBackdrop(asElement(dom.category), panel)).toBe(true);
    });

    const controls: [string, keyof ReturnType<typeof buildPanel>][] = [
        ['a grid cell', 'cell'],
        ['the grid itself, i.e. the gutter between cells', 'grid'],
        ['a tool', 'tool'],
        ['the label inside a tool', 'toolLabel'],
        ['the resize edge', 'resizeEdge'],
        ['the category title', 'title'],
        ['the category DRAG HANDLE — its press belongs to the reorder', 'handle'],
        ['the grip icon inside the handle', 'handleIcon'],
        ['a drag handle even outside a title, by its own class', 'looseHandle'],
        ['the colour palette', 'palette'],
        ['a palette swatch', 'swatch'],
        ['the variant bar', 'variantBar'],
        ['the variant dropdown', 'variantSelect'],
        ['a category TAB, which switches tabs on click', 'tab'],
        ['the label inside a tab', 'tabLabel'],
        ['a folder TILE, which opens the folder on click', 'folder'],
    ];

    for (const [label, key] of controls) {
        it(`never treats ${label} as backdrop`, () => {
            expect(isSelectionBackdrop(asElement(dom[key]), panel)).toBe(false);
        });
    }

    it('ignores anything outside the panel', () => {
        // A click in the editor, a modal or another leaf is none of our
        // business; a selection must not evaporate because the window moved.
        expect(isSelectionBackdrop(asElement(dom.outside), panel)).toBe(false);
    });

    it('ignores a target that is not an element at all', () => {
        expect(isSelectionBackdrop(null, panel)).toBe(false);
        expect(isSelectionBackdrop({} as EventTarget, panel)).toBe(false);
    });
});

/**
 * The listener around the predicate. There is no DOM here, so the rules that
 * keep it from stepping on a drag are pinned at the source level — the same
 * technique the Escape contract uses.
 */
describe('the backdrop click never steals a drag', () => {
    const source = readFileSync(
        new URL('../src/components/buttons-panel/CellSelectionBackdrop.tsx', import.meta.url),
        'utf8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    it('decides on the CLICK, never on the press', () => {
        // The same background is the list-view category drag handle, so
        // clearing at pointer-down would destroy the selection at the start of
        // every category drag. Pointer-down only remembers where it started.
        const press = code.slice(code.indexOf('const onPointerDown'), code.indexOf('const onClick'));
        expect(press).toMatch(/pressOriginRef\.current =/);
        expect(press).not.toMatch(/clearCellSelection/);
        expect(code).toMatch(/const onClick[\s\S]*clearCellSelection\(\)/);
    });

    it('lets an activated drag forfeit the click outright', () => {
        // Travel alone is not enough: a drag that wanders off and comes back
        // releases near its origin.
        expect(code).toMatch(/if \(isDragging\) \{\s*pressOriginRef\.current = null;/);
        expect(code).toMatch(/categoryDrag\?\.isDragging/);
        expect(code).toMatch(/buttonDrag\?\.isDragging/);
        expect(code).toMatch(/cellGestureActive/);
    });

    it('uses the same travel threshold as every other click check', () => {
        expect(code).toMatch(/RESIZE_DRAG_THRESHOLD_PX/);
        expect(code).toMatch(/Math\.sqrt/);
    });

    it('forfeits the click once the press has EVER travelled past the threshold', () => {
        // The free category area is no longer a drag surface, so no drag
        // engine activates there; wandering off and back must still not end
        // in a click on the background.
        const move = code.slice(code.indexOf('const onPointerMove'), code.indexOf('const onClick'));
        expect(move).toMatch(/if \(origin !== null && travelled\(origin, event\)\) \{\s*pressOriginRef\.current = null;/);
        expect(code).toMatch(/panel\.addEventListener\('pointermove', onPointerMove, true\)/);
        expect(code).toMatch(/panel\.removeEventListener\('pointermove', onPointerMove, true\)/);
    });

    it('never stops the event, and never cancels it', () => {
        expect(code).not.toMatch(/stopPropagation|stopImmediatePropagation|preventDefault/);
    });

    it('listens on the panel, not on the document', () => {
        // A click in the editor, a modal or another leaf is none of our
        // business.
        expect(code).toMatch(/panel\.addEventListener\('click', onClick\)/);
        expect(code).not.toMatch(/document\.addEventListener/);
        expect(code).toMatch(/isSelectionBackdrop\(event\.target, panel\)/);
    });

    it('does nothing at all while there is no selection', () => {
        expect(code).toMatch(/if \(!hasSelection \|\| !panel\)/);
    });
});

describe('the exclusion list names every control the decision lists', () => {
    it('covers the grid, its frame and its cells', () => {
        for (const selector of ['[data-slot]', '.ocap-grid-frame', '.ocap-palette-grid']) {
            expect(SELECTION_BACKDROP_EXCLUDES).toContain(selector);
        }
    });

    it('covers the palette, the category title, its drag handle and the variant bar', () => {
        for (const selector of [
            '.ocap-cell-palette',
            '.buttons-panel-category-title',
            '.ocap-category-drag-handle',
            '.ocap-variant-bar',
        ]) {
            expect(SELECTION_BACKDROP_EXCLUDES).toContain(selector);
        }
    });

    it('covers ordinary controls wherever they sit', () => {
        for (const selector of [
            'button',
            'a',
            'input',
            'select',
            'textarea',
            '[role="button"]',
            '[contenteditable="true"]',
        ]) {
            expect(SELECTION_BACKDROP_EXCLUDES).toContain(selector);
        }
    });
});
