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
// Most of these stop the click themselves anyway — the category title, the
// slot `+`, the palette swatches all call `stopPropagation`, so the backdrop
// listener never even sees them. This is the backstop for the ones that do not,
// and the specification of the rule in one place.

/**
 * Surfaces whose click already means something. Matched with `closest`, so a
 * hit anywhere inside one of them counts.
 */
const INTERACTIVE_SELECTOR = [
    // The grid and everything framed with it: cells, tools, the resize gutters
    // and the size readout. A click on a cell REPLACES the selection, and a
    // click in the 4px gutter between two cells deliberately does nothing —
    // neither may be re-read as "clear".
    '[data-slot]',
    '.ocap-grid-frame',
    '.ocap-palette-grid',
    // The colour palette below the grid, including its modifier gestures.
    '.ocap-cell-palette',
    // The category title: collapse/expand, and its context menu.
    '.buttons-panel-category-title',
    // The variant bar of a dynamic category.
    '.ocap-variant-bar',
    // Ordinary controls, wherever they are.
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
].join(', ');

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
    return target.closest(INTERACTIVE_SELECTOR) === null;
}

/** The selector itself, so a test can state the contract without a DOM. */
export const SELECTION_BACKDROP_EXCLUDES = INTERACTIVE_SELECTOR;
