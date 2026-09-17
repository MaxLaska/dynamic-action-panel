import { useCallback } from 'react';
import { Menu, MenuItem } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { CategoryEditModal } from '@/components/modal/CategoryEditModal';
import { CategoryDeleteModal } from '@/components/modal/CategoryDeleteModal';
import { commitToolState, toolStateOf } from '@/utils/categoryStore';
import { duplicateCategoryInState } from '@/domain/categoryOps';
import { freshId } from '@/utils/id';
import { isStaticGridCategory } from '@/utils/categoryVariants';
import { addTemplateMenuItems, openMakeDynamicModal } from '@/utils/categoryMenuUtils';
import { t } from '@/utils/i18n';
import type { CategoryConfig } from '@/types';

export function useCategoryMenu(category: CategoryConfig, categories: CategoryConfig[]) {
    const { plugin, app } = usePluginContext();

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
                        new CategoryEditModal(app, plugin, category, () => {}).open();
                    });
            });

            // Static grid categories can be turned into dynamic ones; the
            // reverse is deliberately not offered.
            if (isStaticGridCategory(category)) {
                menu.addItem((item: MenuItem) => {
                    item.setTitle(t('category_make_dynamic'))
                        .setIcon('layers')
                        .onClick(() => openMakeDynamicModal(app, plugin, category.id));
                });
            }

            menu.addItem((item: MenuItem) => {
                item.setTitle(t('copy') || 'Copy')
                    .setIcon('copy')
                    .onClick(() => {
                        // Copies every variant AND its tool definitions
                        // (fresh ids — fully independent, see F2).
                        const result = duplicateCategoryInState(
                            toolStateOf(plugin),
                            category.id,
                            categories.length,
                            freshId
                        );
                        if (result) {
                            void commitToolState(plugin, result.state);
                        }
                    });
            });

            menu.addSeparator();
            addTemplateMenuItems(menu, app, plugin, category.id);
            menu.addSeparator();

            menu.addItem((item: MenuItem) => {
                item.setTitle(t('delete') || 'Delete')
                    .setIcon('trash')
                    .onClick(() => {
                        new CategoryDeleteModal(app, plugin, category, () => {
                            activeDocument.dispatchEvent(new CustomEvent('buttons-panel-refresh'));
                        }).open();
                    });
            });

            menu.showAtMouseEvent(e);
        },
        [category, categories, plugin, app]
    );

    return handleContextMenu;
}
