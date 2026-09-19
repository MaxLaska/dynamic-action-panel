// cellPaletteAction.ts
// What a click on a colour swatch means — the palette's whole grammar, pure.
//
// The palette follows the SAME grammar as the grid (cell-selection-colors.md
// §8): plain = the primary action, Shift = add, Ctrl/Cmd = remove. The primary
// action depends on whether there is something to act on:
//
//     nothing selected + plain  ->  select this colour's cells
//     something selected + plain -> paint them this colour
//     Shift                      -> add this colour's cells to the selection
//     Ctrl/Cmd                   -> remove them from it (nothing to remove: no-op)
//
// One function, so the click handler, the tooltip and the cursor cannot drift
// into three slightly different readings of the same question. It knows nothing
// about React, the DOM or i18n text — it names a tooltip KEY, and the caller
// resolves it.

import type { CellSelectionGesture } from '@/utils/gridCellSelection';

/** What the click will do. */
export type CellPaletteAction =
    /** Write this colour onto the selected cells (the ONE writing gesture). */
    | 'apply'
    /** Make this colour's cells the selection. */
    | 'select-group'
    /** Add this colour's cells to the selection. */
    | 'add-group'
    /** Take this colour's cells out of the selection. */
    | 'remove-group'
    /** Nothing at all. */
    | 'none';

export interface CellPaletteMeaning {
    action: CellPaletteAction;
    /**
     * The set gesture to hand to the selection, or null when the click does
     * not change the selection. `select-group` is an ADD onto an empty
     * selection rather than a REPLACE: that is literally what it is, and it
     * keeps the one cross-grid rule intact — an add may move the one active
     * context to this grid, a remove may never reach across (§4.2).
     */
    gesture: CellSelectionGesture | null;
    /** Whether the click writes cell colours. Exactly `action === 'apply'`. */
    writes: boolean;
    /** Whether the click arms the selection's paint colour (§8.2). */
    arms: boolean;
    /** i18n key describing what THIS click, right now, would do. */
    tooltipKey: string;
}

/**
 * @param gesture   the resolved modifier gesture of the click or of the keys
 *                  currently held (`replace` = no modifier)
 * @param hasSelection whether this grid currently holds a selection
 * @param isClear   whether the swatch is "no colour", which is a colour GROUP
 *                  of its own: the uncoloured cells
 */
export function cellPaletteMeaning(
    gesture: CellSelectionGesture,
    hasSelection: boolean,
    isClear: boolean
): CellPaletteMeaning {
    if (gesture === 'add') {
        return {
            action: 'add-group',
            gesture: 'add',
            writes: false,
            arms: false,
            tooltipKey: isClear
                ? 'cell_palette_tip_add_uncolored'
                : 'cell_palette_tip_add',
        };
    }

    if (gesture === 'remove') {
        // Remove needs something to remove from. With nothing selected this is
        // deliberately a no-op: it must not start a selection (that is Shift's
        // job) and must not write.
        return hasSelection
            ? {
                  action: 'remove-group',
                  gesture: 'remove',
                  writes: false,
                  arms: false,
                  tooltipKey: isClear
                      ? 'cell_palette_tip_remove_uncolored'
                      : 'cell_palette_tip_remove',
              }
            : {
                  action: 'none',
                  gesture: null,
                  writes: false,
                  arms: false,
                  tooltipKey: 'cell_palette_tip_remove_idle',
              };
    }

    // Plain click. With a selection it paints it — the only gesture in the
    // palette that changes the configuration, and the only one that arms the
    // paint colour. Without one there is nothing to paint, so the swatch is
    // what it looks like: the name of a group of cells.
    return hasSelection
        ? {
              action: 'apply',
              gesture: null,
              writes: true,
              arms: true,
              tooltipKey: isClear ? 'cell_palette_tip_clear' : 'cell_palette_tip_apply',
          }
        : {
              action: 'select-group',
              gesture: 'add',
              writes: false,
              arms: false,
              tooltipKey: isClear
                  ? 'cell_palette_tip_select_uncolored'
                  : 'cell_palette_tip_select',
          };
}
