import { useCallback } from 'react';
import { Menu, MenuItem } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { ButtonEditModal } from '@/components/modal/ButtonEditModal';
import { useButtonOperations } from './useButtonOperations';
import { useContextTarget } from '@/contexts/GridContextTarget';
import { useGridCellSelection } from '@/contexts/GridCellSelectionContext';
import { t, tWithParams } from '@/utils/i18n';
import { offersSelectionDelete, type ContextTarget } from '@/utils/contextTarget';
import type { ButtonConfig, CategoryConfig } from '@/types';

/**
 * useButtonMenu Hook
 *
 * Builds the context menu of a button and handles its entries.
 *
 * The menu knows WHAT the right click was about before it builds anything: the
 * tool under the pointer, or the selection that tool is part of
 * (`resolveContextTarget`).
 *
 * Edit, Copy and Delete always act on the CLICKED tool, in both contexts — a
 * selection does not change what editing or copying this one tool means. What a
 * selection context adds, below them, is the first entry that acts on the
 * selection itself: deleting all the tools it holds, in one operation, after
 * one confirmation.
 *
 * The click never touches the selection. Right-clicking a tool outside the
 * selection does not reduce the selection to it, and right-clicking inside does
 * not extend it: reading is all this path does. The selection is dropped in
 * exactly one case — after a selection delete has actually been written.
 */
export function useButtonMenu(button: ButtonConfig, category: CategoryConfig) {
    const { plugin, app } = usePluginContext();
    const { copyButton, deleteButton, deleteTools } = useButtonOperations();
    const { clearCellSelection } = useGridCellSelection();
    const contextTarget = useContextTarget();

    const handleContextMenu = useCallback(
        (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const target: ContextTarget = contextTarget(button.id);
            const menu = new Menu();

            // The clicked tool's own actions. They are the whole menu in a
            // TOOL context, and the starting point of a SELECTION one.
            menu.addItem((item: MenuItem) => {
                item.setTitle(t('edit'))
                    .setIcon('pencil')
                    .onClick(() => {
                        // The modal saves through the commit funnel itself.
                        new ButtonEditModal(app, plugin, button, category, () => {}).open();
                    });
            });

            menu.addItem((item: MenuItem) => {
                item.setTitle(t('copy') || 'Copy')
                    .setIcon('copy')
                    .onClick(() => {
                        void copyButton(button, category);
                    });
            });

            menu.addItem((item: MenuItem) => {
                item.setTitle(t('delete') || 'Delete')
                    .setIcon('trash')
                    .onClick(() => {
                        deleteButton(button, category);
                    });
            });

            // The selection's own entry, and the first one there has ever been.
            //
            // Offered only when the selection holds MORE than one tool. With
            // exactly one, the plain Delete above already deletes precisely
            // that tool, and a second entry saying the same thing in different
            // words would be a choice without a difference. Empty selected
            // cells are not targets and are not counted — `toolIds` is what the
            // cells actually hold, so a selection of nothing but empty cells
            // never reaches this at all.
            if (offersSelectionDelete(target)) {
                menu.addSeparator();
                menu.addItem((item: MenuItem) => {
                    item.setTitle(
                        tWithParams('delete_selected_count', {
                            count: target.toolIds.length,
                        })
                    )
                        .setIcon('trash')
                        .onClick(() => {
                            // The selection is dropped only once the write has
                            // landed; a cancelled dialog leaves it standing.
                            deleteTools(target.toolIds, category, clearCellSelection);
                        });
                });
            }

            menu.showAtMouseEvent(e);

            // The resolved context, recorded on the menu element. It does not
            // change what the menu offers — it makes what the menu is ABOUT
            // inspectable, in a live panel and in a test, instead of a value
            // that only exists for the length of this function.
            const dom = (menu as unknown as { dom?: HTMLElement }).dom;
            if (dom) {
                dom.dataset.ocapContextKind = target.kind;
                dom.dataset.ocapContextCells = String(target.cellCount);
                dom.dataset.ocapContextTools = String(target.toolIds.length);
                dom.dataset.ocapSelectionDelete = String(offersSelectionDelete(target));
            }
        },
        [
            button,
            category,
            plugin,
            app,
            copyButton,
            deleteButton,
            deleteTools,
            clearCellSelection,
            contextTarget,
        ]
    );

    return handleContextMenu;
}
