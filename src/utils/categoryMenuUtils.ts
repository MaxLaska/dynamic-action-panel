import { Menu, MenuItem, App, Notice } from 'obsidian';
import { CategoryEditModal } from '@/components/modal/CategoryEditModal';
import { CategoryDeleteModal } from '@/components/modal/CategoryDeleteModal';
import { VariantModal } from '@/components/modal/VariantModal';
import { t } from '@/utils/i18n';
import {
    commitStoredCategory,
    commitToolState,
    dispatchPanelRefresh,
    findStoredCategory,
    toolStateOf,
} from '@/utils/categoryStore';
import { isStaticGridCategory } from '@/utils/categoryVariants';
import {
    convertStoredStaticGridToDynamic,
    duplicateCategoryInState,
} from '@/domain/categoryOps';
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
                convertStoredStaticGridToDynamic(stored, {
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
    // Only the count is needed (the copy's order); both the stored and the
    // materialized view array satisfy this.
    categories: readonly { id: string }[],
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
                    // Copies every variant AND its tool definitions (fresh
                    // ids — the copy is fully independent, see F2).
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
