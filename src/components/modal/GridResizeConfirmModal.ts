import { App, Modal, Setting } from 'obsidian';
import { t, tWithParams } from '@/utils/i18n';
import type { GridResizeEdge } from '@/utils/categoryGrid';

/**
 * Confirmation before a shrink that would cut tools away.
 *
 * Removing an EMPTY outer row or column is not a decision — it happens
 * immediately. Removing an occupied one is, so it says how many tools go and
 * names them, exactly like VariantDeleteModal does for a whole variant. This
 * is deliberately an Obsidian modal and not `window.confirm`, which would
 * steal focus from the whole app and cannot be styled or localized.
 *
 * ONE confirmation covers the whole gesture, not one per stripe: a drag can
 * take several columns at once, and being asked four times in a row would
 * train the user to click through without reading.
 *
 * Note for later: "remove from the grid" really does DELETE these tools today,
 * because a tool exists only on the grid it sits on. Once a tool library
 * separates definition from placement, this is the one place that has to
 * change its wording and its effect.
 */
export class GridResizeConfirmModal extends Modal {
    private readonly edge: GridResizeEdge;
    /** How many columns / rows the gesture removes (>= 1). */
    private readonly strips: number;
    private readonly buttonNames: string[];
    private readonly onConfirm: () => void;

    constructor(
        app: App,
        options: {
            edge: GridResizeEdge;
            strips?: number;
            buttonNames: string[];
            onConfirm: () => void;
        }
    ) {
        super(app);
        this.edge = options.edge;
        this.strips = Math.max(1, options.strips ?? 1);
        this.buttonNames = options.buttonNames;
        this.onConfirm = options.onConfirm;
    }

    /** The question, in the four shapes one/many stripe x one/many tool take. */
    private questionText(): string {
        const tools = this.buttonNames.length;
        const isColumn = this.edge === 'column';
        if (this.strips === 1) {
            // Removing exactly one tool is the common case and reads badly as
            // "1 tools", so it gets its own sentence per language.
            const key = isColumn
                ? 'grid_remove_column_confirm'
                : 'grid_remove_row_confirm';
            return tools === 1
                ? t(`${key}_one`)
                : tWithParams(key, { count: tools });
        }
        const key = isColumn ? 'grid_remove_columns_confirm' : 'grid_remove_rows_confirm';
        return tools === 1
            ? tWithParams(`${key}_one`, { strips: this.strips })
            : tWithParams(key, { strips: this.strips, count: tools });
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass('buttons-panel');

        titleEl.setText(
            this.edge === 'column'
                ? t(this.strips === 1 ? 'grid_remove_column_title' : 'grid_remove_columns_title')
                : t(this.strips === 1 ? 'grid_remove_row_title' : 'grid_remove_rows_title')
        );

        contentEl.createEl('p', { text: this.questionText() });

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
