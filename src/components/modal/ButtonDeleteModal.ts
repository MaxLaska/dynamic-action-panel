import { App, Modal, Setting } from 'obsidian';
import { ButtonsPanelPlugin } from '@/types/plugin';
import { CategoryConfig, ButtonConfig } from '@/types';
import { t, tWithParams } from '@/utils/i18n';

/**
 * Confirmation modal for deleting a button.
 * The button is removed only after the user confirms.
 */
export class ButtonDeleteModal extends Modal {
    plugin: ButtonsPanelPlugin;
    button: ButtonConfig;
    category: CategoryConfig;
    onDelete: () => void;

    /**
     * Initializes the modal.
     * @param app Obsidian app instance
     * @param plugin Plugin instance
     * @param button Button to delete
     * @param category Category the button belongs to
     * @param onDelete Called after the deletion
     */
    constructor(
        app: App,
        plugin: ButtonsPanelPlugin,
        button: ButtonConfig,
        category: CategoryConfig,
        onDelete: () => void
    ) {
        super(app);
        this.plugin = plugin;
        this.button = button;
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
        contentEl.addClass('button-delete');

        // Use the Obsidian Modal title bar, consistent with the add-category modal.
        titleEl.setText(t('delete_button'));
        titleEl.addClass('buttons-panel-delete-title');
        contentEl.createEl('p', {
            text: tWithParams('confirm_delete_button', { buttonName: this.button.name }),
            cls: 'delete-message',
        });
        contentEl.createEl('p', {
            text: t('delete_button_warning'),
            cls: 'warning-message',
        });

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText(t('delete'))
                    .setDestructive()
                    .setCta()
                    .onClick(() => {
                        this.onDelete();
                        this.close();
                    })
            )
            .addButton((btn) => btn.setButtonText(t('cancel')).onClick(() => this.close()));
    }

    /**
     * Called when the modal closes; clears its content.
     */
    onClose() {
        this.titleEl.removeClass('buttons-panel-delete-title');
        this.contentEl.empty();
    }
}
