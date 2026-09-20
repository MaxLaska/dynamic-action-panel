// cellPaletteAction.ts
// What a click on a colour swatch means — the palette's whole grammar, pure.
//
// A swatch is a PAINT colour; the modifiers are the grid's own grammar applied
// to the cells that carry it (cell-selection-colors.md §8):
//
//     plain                      -> choose this paint colour, and paint the
//                                   selection with it if there is one
//     Shift                      -> add this colour's cells to the selection
//     Ctrl/Cmd                   -> remove them from it (nothing to remove: no-op)
//
// A plain click therefore always means the same thing — "paint with this" —
// whether or not something is selected. With nothing selected it only arms the
// colour, and the next Shift gesture in the grid carries it onto the cells it
// brings in: choose a colour, then work with it.
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
    /** Choose this colour for what comes next, without writing anything. */
    | 'arm'
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
     * not change the selection at all — which a plain click never does any
     * more. A modifier's `add` may move the one active context to this grid,
     * its `remove` may never reach across (§4.2).
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

    // Plain click: choose this colour. With a selection it also paints it —
    // the only gesture in the whole palette that writes. Without one it just
    // arms, and the next additive gesture in the grid carries it.
    //
    // It deliberately never selects: reading a plain click as "find me every
    // red cell" made the same gesture mean two unrelated things depending on
    // a state the user cannot see. Fetching a colour's cells is what the
    // modifiers are for, and they say so on every surface of the panel.
    return hasSelection
        ? {
              action: 'apply',
              gesture: null,
              writes: true,
              arms: true,
              tooltipKey: isClear ? 'cell_palette_tip_clear' : 'cell_palette_tip_apply',
          }
        : {
              action: 'arm',
              gesture: null,
              writes: false,
              arms: true,
              tooltipKey: isClear ? 'cell_palette_tip_arm_uncolored' : 'cell_palette_tip_arm',
          };
}
