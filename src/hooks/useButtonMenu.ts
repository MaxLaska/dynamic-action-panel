import { useCallback } from 'react';
import { Menu, MenuItem } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { ButtonEditModal } from '@/components/modal/ButtonEditModal';
import { useButtonOperations } from './useButtonOperations';
import { useContextTarget } from '@/contexts/GridContextTarget';
import { useGridCellSelection } from '@/contexts/GridCellSelectionContext';
import { t } from '@/utils/i18n';
import { deleteTargetsOfContext, type ContextTarget } from '@/utils/contextTarget';
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
 * Edit and Copy always act on the CLICKED tool: a selection does not change
 * what editing or copying this one tool means.
 *
 * Delete is the one entry whose SUBJECT the context decides. There is exactly
 * one of it, always titled the same, and `deleteTargetsOfContext` answers what
 * it removes — every tool a selection holds when the click was inside one, the
 * clicked tool otherwise. The number belongs in the confirmation, which names
 * them; a menu offering both "Delete" and "Delete 4 selected items" would be
 * offering one action twice.
 *
 * The click never touches the selection. Right-clicking a tool outside the
 * selection does not reduce the selection to it, and right-clicking inside does
 * not extend it: reading is all this path does. The selection is dropped in
 * exactly one case — after a delete whose subject WAS the selection has
 * actually been written.
 */
export function useButtonMenu(button: ButtonConfig, category: CategoryConfig) {
    const { plugin, app } = usePluginContext();
    const { copyButton, deleteTools } = useButtonOperations();
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

            // ONE Delete. What it removes is the context's business, not the
            // menu's: inside a selection it is every tool the selection holds,
            // anywhere else it is the tool under the pointer. The count belongs
            // in the confirmation, where there is room to name them; a menu
            // entry that says "Delete 4 selected items" makes a second action
            // out of what is one.
            const doomed = deleteTargetsOfContext(target);
            if (doomed.length > 0) {
                menu.addItem((item: MenuItem) => {
                    item.setTitle(t('delete') || 'Delete')
                        .setIcon('trash')
                        .onClick(() => {
                            // The selection is dropped only once the write has
                            // landed, and only when it WAS the subject: deleting
                            // one tool outside the selection leaves it standing.
                            deleteTools(
                                doomed,
                                category,
                                target.kind === 'selection' ? clearCellSelection : undefined
                            );
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
                dom.dataset.ocapDeleteTargets = String(deleteTargetsOfContext(target).length);
            }
        },
        [
            button,
            category,
            plugin,
            app,
            copyButton,
            deleteTools,
            clearCellSelection,
            contextTarget,
        ]
    );

    return handleContextMenu;
}
