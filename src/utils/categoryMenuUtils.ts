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
import {
    exportCategoryTemplate,
    importTemplateFromLibrary,
    openTemplateLibraryFolder,
    pickAndImportTemplate,
} from '@/export/templateIo';
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
 * The portable-template entries, shared by both category menu builders.
 *
 * Export ships THIS category (with every variant and every tool it
 * references) as a `.ocap.json` file; the other three are panel-level but live
 * here because the category menu is where a user looks for "where do panels
 * come from". Neither entry touches the other's state: export is read-only and
 * import only ever appends.
 *
 * The order is the order of use: write one out, read one back, reach past the
 * library for a file that is not in it, and open the folder the first three
 * are talking about.
 */
export function addTemplateMenuItems(
    menu: Menu,
    app: App,
    plugin: ButtonsPanelPlugin,
    categoryId: string
): void {
    menu.addItem((item: MenuItem) => {
        item.setTitle(t('category_export_template'))
            .setIcon('download')
            .onClick(() => {
                void exportCategoryTemplate(app, plugin, categoryId);
            });
    });
    addTemplateLibraryMenuItems(menu, app, plugin);
}

/**
 * The three template entries that need no category: importing from the
 * library, importing from anywhere else, and reaching the folder itself.
 *
 * Separate from the export entry because the `+` "Add category" menu offers
 * exactly these — an empty panel has no category to export, but it is the
 * state in which finding the folder matters most. Keeping them in one place
 * stops the two menus drifting apart.
 */
export function addTemplateLibraryMenuItems(
    menu: Menu,
    app: App,
    plugin: ButtonsPanelPlugin
): void {
    menu.addItem((item: MenuItem) => {
        item.setTitle(t('category_import_template'))
            .setIcon('upload')
            .onClick(() => {
                void importTemplateFromLibrary(app, plugin);
            });
    });
    menu.addItem((item: MenuItem) => {
        item.setTitle(t('template_import_from_file'))
            .setIcon('file-input')
            .onClick(() => pickAndImportTemplate(app, plugin));
    });
    menu.addItem((item: MenuItem) => {
        item.setTitle(t('template_open_folder'))
            .setIcon('folder-open')
            .onClick(() => {
                void openTemplateLibraryFolder(app);
            });
    });
}

/**
 * Builds the context menu handler for a category.
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
            item.setTitle(t('copy') || 'Copy')
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

        menu.addSeparator();
        addTemplateMenuItems(menu, app, plugin, category.id);
        menu.addSeparator();

        menu.addItem((item: MenuItem) => {
            item.setTitle(t('delete') || 'Delete')
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
