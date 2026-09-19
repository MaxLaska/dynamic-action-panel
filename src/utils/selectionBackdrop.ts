// selectionBackdrop.ts
// What counts as empty panel background — the surface whose click may mean
// "clear the selection" precisely because it means nothing else.
//
// The list below is deliberately a list of EXCLUSIONS rather than an allowlist
// of backdrop elements. A backdrop is not a thing anyone renders; it is
// whatever is left over between the things that are. Naming the leftovers would
// mean inventing a class for every gap in every view and keeping it correct
// forever, and the first one forgotten would swallow a click that belonged to a
// control. Naming the CONTROLS is the shorter and more honest list, and a new
// control that forgets to appear here fails loudly (its click also clears the
// selection) rather than silently (its click stops working).
//
// THE ONE RULE FOR THIS LIST (2026-09-20):
//
//     Only elements whose OWN click does something belong here.
//     A container is not a control because it contains one.
//
// The list is matched with `closest`, so every entry walls off its whole
// subtree — including the empty space inside it. That is right for a control
// (its icon and its label are part of it) and wrong for a bar that merely holds
// controls: the colour palette and the variant bar were listed here, and with
// them every free pixel to the right of their buttons stopped clearing the
// selection. The user then had to hunt for the thin strip between two
// categories to deselect. Those two are gone from the list; their buttons are
// `button` elements and remain excluded on their own account.
//
// Most of these stop the click themselves anyway — the category title, the
// slot `+`, the palette swatches all call `stopPropagation`, so the backdrop
// listener never even sees them. This is the backstop for the ones that do not,
// and the specification of the rule in one place.

/**
 * Elements whose own click already means something, wherever they sit.
 */
const SELF_ACTING_CONTROLS = [
    // The category title: its whole row collapses/expands, and it carries the
    // context menu. The icon and the name are part of that action.
    '.buttons-panel-category-title',
    // The list category's drag handle (inside the title, named anyway): a
    // press there belongs to the reorder, and its click means nothing at all
    // — least of all "clear".
    '.ocap-category-drag-handle',
    // Ordinary controls: tools, swatches, the `+`, resize handles, the variant
    // dropdown and its buttons, tabs, folder tiles, search inputs.
    'button',
    'a',
    'input',
    'select',
    'textarea',
    'label',
    '[role="button"]',
    '[role="checkbox"]',
    '[role="tab"]',
    '[contenteditable="true"]',
];

/**
 * The grid, its frame and its cells.
 *
 * Not a control, and listed anyway: what a press on a cell means is decided by
 * the grid itself (run the tool, select with a modifier, drop a file), and the
 * 4px gutter between two cells deliberately means nothing at all. Neither may
 * be re-read as "clear" behind the grid's back — least of all an empty cell,
 * which is a drop target and a creation spot, not leftover space.
 */
const GRID_SURFACES = ['[data-slot]', '.ocap-grid-frame', '.ocap-palette-grid'];

const INTERACTIVE_SELECTOR = [...SELF_ACTING_CONTROLS, ...GRID_SURFACES].join(', ');

/**
 * Whether a click on `target` landed on inert panel background.
 *
 * False for anything outside `panel` as well: a click in the editor, in a modal
 * or in another leaf is none of the panel's business, and the selection is not
 * the kind of state that should evaporate because the window was clicked.
 */
export function isSelectionBackdrop(
    target: EventTarget | null,
    panel: Element
): boolean {
    if (!(target instanceof Element)) {
        return false;
    }
    if (!panel.contains(target)) {
        return false;
    }
    // Asked of the element actually under the pointer, walking up only through
    // its real ancestors. A bar that holds buttons is not one; the free space
    // beside them is background, exactly as it looks.
    return target.closest(INTERACTIVE_SELECTOR) === null;
}

/** The selector itself, so a test can state the contract without a DOM. */
export const SELECTION_BACKDROP_EXCLUDES = INTERACTIVE_SELECTOR;

/** The two groups, so a test can state WHY each entry is on the list. */
export const SELECTION_BACKDROP_GROUPS = {
    controls: SELF_ACTING_CONTROLS,
    grid: GRID_SURFACES,
};
