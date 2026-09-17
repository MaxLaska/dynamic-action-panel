import { App, Modal, Setting, Notice } from 'obsidian';
import { ButtonsPanelPlugin } from '@/types/plugin';
import { CategoryConfig } from '@/types';
import { commitToolState, toolStateOf } from '@/utils/categoryStore';
import { deleteCategoryFromState } from '@/domain/categoryOps';
import { t, tWithParams } from '@/utils/i18n';

/**
 * Confirmation modal for deleting a category.
 * The category and the buttons it holds are removed only after the user confirms.
 */
export class CategoryDeleteModal extends Modal {
    plugin: ButtonsPanelPlugin;
    category: CategoryConfig;
    onDelete: () => void;

    /**
     * Initializes the modal.
     * @param app Obsidian app instance
     * @param plugin Plugin instance
     * @param category Category to delete
     * @param onDelete Called after the deletion
     */
    constructor(
        app: App,
        plugin: ButtonsPanelPlugin,
        category: CategoryConfig,
        onDelete: () => void
    ) {
        super(app);
        this.plugin = plugin;
        this.category = category;
        this.onDelete = onDelete;
    }

    /**
     * Called when the modal opens; renders the confirmation UI.
     */
    onOpen() {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass('buttons-panel');
        contentEl.addClass('category-delete');

        const buttonCount = this.category.buttons.length;

        // Use the Obsidian Modal title bar, consistent with the add-category modal.
        titleEl.setText(t('delete_category'));
        titleEl.addClass('buttons-panel-delete-title');

        // Warning message.
        contentEl.createEl('p', {
            text: tWithParams('confirm_delete_category', { categoryName: this.category.name }),
            cls: 'delete-message',
        });

        if (buttonCount > 0) {
            contentEl.createEl('p', {
                text: tWithParams('delete_category_warning', { buttonCount }),
                cls: 'warning-message',
            });
        }

        // Action buttons.
        new Setting(contentEl)
            .addButton((button) =>
                button
                    .setButtonText(t('delete'))
                    .setDestructive()
                    .setCta()
                    .onClick(() => this.handleDelete())
            )
            .addButton((button) => button.setButtonText(t('cancel')).onClick(() => this.close()));
    }

    /**
     * Deletes the category: removal, renumbering, persistence and the notice.
     */
    async handleDelete() {
        try {
            // Locate the category in the settings.
            const index = this.plugin.settings.categories.findIndex(
                (c) => c.id === this.category.id
            );
            if (index > -1) {
                // Remove + renumber immutably, and garbage-collect the tools
                // that lived only in this category (library tools survive).
                await commitToolState(
                    this.plugin,
                    deleteCategoryFromState(toolStateOf(this.plugin), this.category.id)
                );

                // Show the success message.
                const buttonCount = this.category.buttons.length;
                const message =
                    buttonCount > 0
                        ? tWithParams('delete_category_success', {
                              categoryName: this.category.name,
                              buttonCount,
                          })
                        : tWithParams('delete_category_success_empty', {
                              categoryName: this.category.name,
                          });
                new Notice(message);

                // Invoke the callback.
                this.onDelete();
                this.close();
            }
        } catch (error) {
            console.error('Error while deleting the category:', error);
            new Notice(t('delete_category_error'));
        }
    }

    /**
     * Called when the modal closes; clears its content.
     */
    onClose() {
        const { contentEl, titleEl } = this;
        titleEl.removeClass('buttons-panel-delete-title');
        contentEl.empty();
    }
}
