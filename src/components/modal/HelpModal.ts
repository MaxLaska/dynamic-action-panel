import { App, Modal } from 'obsidian';
import { t } from '@/utils/i18n';
import { interactionReferenceText } from '@/utils/interactionReference';

/**
 * The panel's controls, as a modal.
 *
 * It renders `interactionReference()` and knows nothing else: every gesture it
 * shows is defined in one place, so the modal cannot fall behind the panel.
 * Plain Obsidian DOM, no React — there is no state here, and the modal is
 * opened from the navigation bar, which is not inside the React tree that
 * holds the panel.
 */
export class HelpModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass('buttons-panel');
        contentEl.addClass('ocap-help-modal');

        titleEl.setText(t('help_modal_title'));

        for (const section of interactionReferenceText()) {
            const sectionEl = contentEl.createDiv({ cls: 'ocap-help-section' });
            sectionEl.createEl('h4', {
                text: section.title,
                cls: 'ocap-help-section-title',
            });
            for (const row of section.rows) {
                const rowEl = sectionEl.createDiv({ cls: 'ocap-help-row' });
                rowEl.createEl('kbd', { text: row.gesture, cls: 'ocap-help-gesture' });
                rowEl.createSpan({ text: row.description, cls: 'ocap-help-description' });
            }
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
