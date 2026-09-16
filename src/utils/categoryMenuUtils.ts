import { Menu, MenuItem, App } from 'obsidian';
import { CategoryEditModal } from '@/components/modal/CategoryEditModal';
import { CategoryDeleteModal } from '@/components/modal/CategoryDeleteModal';
import { t } from '@/utils/i18n';
import { duplicateCategoryConfig } from '@/utils/categoryStore';
import type { CategoryConfig, ButtonsPanelPlugin } from '@/types';

/**
 * 创建分类右键菜单处理函数
 */
export function createCategoryMenuHandler(
    category: CategoryConfig,
    categories: CategoryConfig[],
    plugin: ButtonsPanelPlugin,
    app: App
): (e: MouseEvent) => void {
    return (e: MouseEvent) => {
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

        menu.addItem((item: MenuItem) => {
            item.setTitle(t('copy') || '复制')
                .setIcon('copy')
                .onClick(() => {
                    void (async () => {
                        // Copies every palette layer, not just `buttons`.
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
    };
}
