import { useCallback } from 'react';
import { Menu, MenuItem } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { ButtonEditModal } from '@/components/modal/ButtonEditModal';
import { useButtonOperations } from './useButtonOperations';
import { t } from '@/utils/i18n';
import type { ButtonConfig, CategoryConfig } from '@/types';

/**
 * useButtonMenu Hook
 *
 * Builds the context menu of a button and handles its entries.
 */
export function useButtonMenu(button: ButtonConfig, category: CategoryConfig) {
    const { plugin, app } = usePluginContext();
    const { copyButton, deleteButton } = useButtonOperations();

    const handleContextMenu = useCallback(
        (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const menu = new Menu();

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

            menu.showAtMouseEvent(e);
        },
        [button, category, plugin, app, copyButton, deleteButton]
    );

    return handleContextMenu;
}
