import { App, Modal, Setting } from 'obsidian';
import { t, tWithParams } from '@/utils/i18n';
import type { GridResizeEdge } from '@/utils/categoryVariants';

/**
 * Confirmation before a shrink that would cut tools away.
 *
 * Removing an EMPTY outer row or column is not a decision — it happens
 * immediately. Removing an occupied one is, so it says how many tools go and
 * names them, exactly like VariantDeleteModal does for a whole variant. This
 * is deliberately an Obsidian modal and not `window.confirm`, which would
 * steal focus from the whole app and cannot be styled or localized.
 *
 * Note for later: "remove from the grid" really does DELETE these tools today,
 * because a tool exists only on the grid it sits on. Once a tool library
 * separates definition from placement, this is the one place that has to
 * change its wording and its effect.
 */
export class GridResizeConfirmModal extends Modal {
    private readonly edge: GridResizeEdge;
    private readonly buttonNames: string[];
    private readonly onConfirm: () => void;

    constructor(
        app: App,
        options: { edge: GridResizeEdge; buttonNames: string[]; onConfirm: () => void }
    ) {
        super(app);
        this.edge = options.edge;
        this.buttonNames = options.buttonNames;
        this.onConfirm = options.onConfirm;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass('buttons-panel');

        titleEl.setText(
            this.edge === 'column'
                ? t('grid_remove_column_title')
                : t('grid_remove_row_title')
        );

        // Removing exactly one tool is the common case and reads badly as
        // "1 tools", so it gets its own sentence per language.
        const count = this.buttonNames.length;
        const key =
            (this.edge === 'column' ? 'grid_remove_column_confirm' : 'grid_remove_row_confirm') +
            (count === 1 ? '_one' : '');
        contentEl.createEl('p', {
            text: count === 1 ? t(key) : tWithParams(key, { count }),
        });

        const list = contentEl.createEl('ul', { cls: 'ocap-variant-delete-list' });
        for (const name of this.buttonNames) {
            list.createEl('li', { text: name });
        }

        new Setting(contentEl)
            .addButton((button) =>
                button
                    .setButtonText(t('grid_remove_confirm_action'))
                    .setDestructive()
                    .onClick(() => {
                        this.onConfirm();
                        this.close();
                    })
            )
            .addButton((button) =>
                button.setButtonText(t('cancel')).onClick(() => this.close())
            );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
