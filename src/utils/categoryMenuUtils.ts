import { Menu, MenuItem, App, Notice } from 'obsidian';
import { CategoryEditModal } from '@/components/modal/CategoryEditModal';
import { CategoryDeleteModal } from '@/components/modal/CategoryDeleteModal';
import { VariantModal } from '@/components/modal/VariantModal';
import { t } from '@/utils/i18n';
import {
    commitCategories,
    commitStoredCategory,
    dispatchPanelRefresh,
    duplicateCategoryConfig,
    findStoredCategory,
} from '@/utils/categoryStore';
import { convertStaticGridToDynamic, isStaticGridCategory } from '@/utils/categoryVariants';
import { freshId } from '@/utils/id';
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
            const stored = findStoredCategory(plugin, categoryId);
            if (!stored || !isStaticGridCategory(stored)) {
                new Notice(t('category_not_found'));
                return;
            }
            void commitStoredCategory(
                plugin,
                convertStaticGridToDynamic(stored, {
                    id: freshId('var'),
                    name,
                    trigger,
                    fallback,
                })
            );
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
                    // The modal saves through the commit funnel itself.
                    new CategoryEditModal(app, plugin, category, () => {}).open();
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
                    // Copies every variant, not just `buttons`.
                    const newCategory = duplicateCategoryConfig(
                        category,
                        categories.length
                    );
                    void commitCategories(plugin, [
                        ...plugin.settings.categories,
                        newCategory,
                    ]);
                });
        });

        menu.addItem((item: MenuItem) => {
            item.setTitle(t('delete') || '删除')
                .setIcon('trash')
                .onClick(() => {
                    new CategoryDeleteModal(app, plugin, category, () => {
                        dispatchPanelRefresh();
                    }).open();
                });
        });

        menu.showAtMouseEvent(e);
    };
}
