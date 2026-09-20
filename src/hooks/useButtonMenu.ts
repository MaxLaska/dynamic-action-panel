import { useCallback } from 'react';
import { Menu, MenuItem } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { ButtonEditModal } from '@/components/modal/ButtonEditModal';
import { useButtonOperations } from './useButtonOperations';
import { useContextTarget } from '@/contexts/GridContextTarget';
import { t } from '@/utils/i18n';
import type { ContextTarget } from '@/utils/contextTarget';
import type { ButtonConfig, CategoryConfig } from '@/types';

/**
 * useButtonMenu Hook
 *
 * Builds the context menu of a button and handles its entries.
 *
 * The menu now knows WHAT the right click was about before it builds anything:
 * the tool under the pointer, or the selection that tool is part of
 * (`resolveContextTarget`). Both currently offer the same three entries — they
 * act on the clicked tool, and a selection does not change what editing,
 * copying or deleting THIS tool means — so nothing about the menu has changed
 * yet. What has changed is that there is now one place where it could: the
 * branch below is where a selection's own entries will attach, with the
 * selection already resolved and counted.
 *
 * The click never touches the selection. Right-clicking a tool outside the
 * selection does not reduce the selection to it, and right-clicking inside
 * does not extend it: reading is all this path does.
 */
export function useButtonMenu(button: ButtonConfig, category: CategoryConfig) {
    const { plugin, app } = usePluginContext();
    const { copyButton, deleteButton } = useButtonOperations();
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

            // A SELECTION context (`target.kind`) is where the selection's own
            // entries will attach, with `target.cellCount` cells and
            // `target.toolIds` tools already resolved. Nothing is added here
            // yet: an entry that does nothing, or announces something that
            // does not exist, is worse than no entry at all.

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
            }
        },
        [button, category, plugin, app, copyButton, deleteButton, contextTarget]
    );

    return handleContextMenu;
}
