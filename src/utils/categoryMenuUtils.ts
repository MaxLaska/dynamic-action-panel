import { Menu, MenuItem, App, Notice } from 'obsidian';
import { CategoryEditModal } from '@/components/modal/CategoryEditModal';
import { CategoryDeleteModal } from '@/components/modal/CategoryDeleteModal';
import { VariantModal } from '@/components/modal/VariantModal';
import { t } from '@/utils/i18n';
import { duplicateCategoryConfig } from '@/utils/categoryStore';
import { convertStaticGridToDynamic, isStaticGridCategory } from '@/utils/categoryVariants';
import type { CategoryConfig, ButtonsPanelPlugin } from '@/types';

/**
 * "Make dynamic": turn a static grid category into a dynamic one. The
 * category's existing full grid becomes the first variant exactly as it is;
 * the user names it and gives it a trigger (or marks it as the fallback).
 * Shared by the React hook and the plain menu builder.
 */
export function openMakeDynamicModal(
    app: App,
    plugin: ButtonsPanelPlugin,
    categoryId: string
): void {
    const category = plugin.settings.categories.find((c) => c.id === categoryId);
    if (!category || !isStaticGridCategory(category)) {
        new Notice(t('category_not_found'));
        return;
    }
    new VariantModal(app, {
        title: t('variant_make_dynamic_title'),
        name: category.name,
        onSubmit: ({ name, trigger, fallback }) => {
            const stored = plugin.settings.categories.find((c) => c.id === categoryId);
            if (!stored || !isStaticGridCategory(stored)) {
                new Notice(t('category_not_found'));
                return;
            }
            const variantId = `var-${Date.now().toString(36)}-${Math.random()
                .toString(36)
                .slice(2, 9)}`;
            const index = plugin.settings.categories.findIndex(
                (c) => c.id === categoryId
            );
            plugin.settings.categories[index] = convertStaticGridToDynamic(stored, {
                id: variantId,
                name,
                trigger,
                fallback,
            });
            void plugin.saveSettings();
            activeDocument.dispatchEvent(new CustomEvent('buttons-panel-refresh'));
        },
    }).open();
}

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

        // Static grid categories can be turned into dynamic ones; the reverse
        // is deliberately not offered (it would collapse full variants).
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
    };
}
