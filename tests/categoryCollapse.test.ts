// tests/categoryCollapse.test.ts
//
// Collapsing a category in list view is the user's, and only the user's.
//
// It was not: `ListModeContent` revealed EVERY collapsed category for the
// duration of ANY button drag and folded them all back on release, so dragging
// a tool at the bottom of the panel unfolded a category at the top, moved
// everything in between mid-gesture, and put it back afterwards. A second
// mechanism did the same thing more quietly — a 0.4s drag-hover expanded a
// collapsed category and did not even undo itself.
//
// There is no DOM in this test environment, so the rule is pinned at the source
// level — the same technique tests/futureSettings.test.ts uses for "there is
// exactly one place that writes settings". The behaviour itself is covered by
// the live smoke run (a collapsed category checked before, during and after a
// drag in another category).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
    new URL('../src/components/buttons-panel/ListModeContent.tsx', import.meta.url),
    'utf8'
);
/** Comments removed, so a doc comment cannot satisfy a check. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('a drag never touches a category collapse state', () => {
    it('keeps a collapsed category hidden for the whole drag', () => {
        expect(code).toMatch(/hideButtonGridWhileCollapsed = sortableEnabled && !isOpen/);
        // The transient "open it while anything is being dragged" flag is gone,
        // and with it the mid-drag layout change.
        expect(code).not.toMatch(/isVisuallyOpen/);
    });

    it('never auto-expands a category the drag hovers over', () => {
        expect(code).not.toMatch(/registerCategoryHover\(/);
    });

    it('still mounts the collapsed grid, so its droppables stay registered', () => {
        // Hidden, not unmounted: the slot droppables must keep their dnd-kit
        // registration (see GridSlotCell), or a later drag races them.
        expect(code).toMatch(/showButtonGrid = isOpen \|\| sortableEnabled/);
    });

    it('drives the chevron and the open class from the real state', () => {
        expect(code).toMatch(/isOpen \? 'chevron-down' : 'chevron-right'/);
        expect(code).toMatch(/isOpen \? 'list-category-open' : 'list-category-closed'/);
        expect(code).toMatch(/'aria-expanded': isOpen/);
    });

    it('writes the open map only from deliberate user actions', () => {
        // Three writers, and no more: the title click, the keyboard
        // activation, and the lifecycle effect that adds and removes
        // categories. A fourth would be something changing the state on the
        // user's behalf again.
        expect([...code.matchAll(/setOpenByCategoryId\(/g)]).toHaveLength(3);
    });
});
