import { App, Modal, Setting } from 'obsidian';
import { ButtonsPanelPlugin } from '@/types/plugin';
import { CategoryConfig } from '@/types';
import { t, tWithParams } from '@/utils/i18n';
import type { DeleteTarget } from '@/utils/deleteTargets';

/**
 * Confirmation modal for deleting tools. Nothing is removed until the user
 * confirms, and Cancel and Escape both mean "nothing happened".
 *
 * ONE modal for one target and for many, on purpose. A selection delete is the
 * same question asked about more things, and a second dialog would be a second
 * place for the wording, the warning and the destructive-button conventions to
 * drift. Deleting one tool is a list of one and reads exactly as it always did
 * — same title, same sentence, same warning — so generalising it cost the
 * single case nothing.
 */
export class ButtonDeleteModal extends Modal {
    plugin: ButtonsPanelPlugin;
    targets: DeleteTarget[];
    category: CategoryConfig;
    onDelete: () => void;

    /**
     * Initializes the modal.
     * @param app Obsidian app instance
     * @param plugin Plugin instance
     * @param targets Tools to delete, already named for display
     * @param category Category the tools belong to
     * @param onDelete Called after the user confirms
     */
    constructor(
        app: App,
        plugin: ButtonsPanelPlugin,
        targets: DeleteTarget[],
        category: CategoryConfig,
        onDelete: () => void
    ) {
        super(app);
        this.plugin = plugin;
        this.targets = targets;
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

        const single = this.targets.length <= 1;

        // Use the Obsidian Modal title bar, consistent with the add-category modal.
        titleEl.setText(single ? t('delete_button') : t('delete_selected'));
        titleEl.addClass('buttons-panel-delete-title');

        contentEl.createEl('p', {
            text: single
                ? tWithParams('confirm_delete_button', {
                      buttonName: this.targets[0]?.label ?? '',
                  })
                : tWithParams('confirm_delete_selection', {
                      count: this.targets.length,
                  }),
            cls: 'delete-message',
        });

        // The list only appears for a selection: naming the one tool twice —
        // once in the sentence, once under it — would say nothing new.
        if (!single) {
            const list = contentEl.createEl('ul', { cls: 'delete-target-list' });
            for (const target of this.targets) {
                list.createEl('li', { text: target.label });
            }
        }

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
     *
     * Closing is not confirming. Cancel, Escape and the title-bar × all land
     * here without `onDelete` ever having run, which is what makes "nothing
     * happened" the default outcome rather than a case to remember.
     */
    onClose() {
        this.titleEl.removeClass('buttons-panel-delete-title');
        this.contentEl.empty();
    }
}
