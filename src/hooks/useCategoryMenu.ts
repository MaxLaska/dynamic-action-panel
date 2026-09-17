import { useCallback } from 'react';
import { Menu, MenuItem } from 'obsidian';
import { usePluginContext } from '@/contexts/PluginContext';
import { CategoryEditModal } from '@/components/modal/CategoryEditModal';
import { CategoryDeleteModal } from '@/components/modal/CategoryDeleteModal';
import { duplicateCategoryConfig } from '@/utils/categoryStore';
import { isStaticGridCategory } from '@/utils/categoryVariants';
import { openMakeDynamicModal } from '@/utils/categoryMenuUtils';
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
                        new CategoryEditModal(app, plugin, category, () => {
                            void plugin.saveSettings();
                            activeDocument.dispatchEvent(new CustomEvent('buttons-panel-refresh'));
                        }).open();
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
                item.setTitle(t('copy') || '复制')
                    .setIcon('copy')
                    .onClick(() => {
                        void (async () => {
                            // Copies every variant, not just `buttons`.
                            const newCategory = duplicateCategoryConfig(
                                category,
                                categories.length
                            );
                            plugin.settings.categories.push(newCategory);
                            await plugin.saveSettings();
                            activeDocument.dispatchEvent(new CustomEvent('buttons-panel-refresh'));
                        })();
                    });
            });

            menu.addItem((item: MenuItem) => {
                item.setTitle(t('delete') || '删除')
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
