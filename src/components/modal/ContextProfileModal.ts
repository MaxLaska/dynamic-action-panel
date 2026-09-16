import { App, Modal, Notice, Setting, TextComponent } from 'obsidian';
import type { ButtonCondition } from '@/types/conditions';
import { t } from '@/utils/i18n';
import { ConditionEditor } from '@/components/input';

/**
 * ContextProfileModal — create or edit one context profile of a grid palette.
 *
 * A profile owns exactly one condition, so this reuses the shared visual
 * ConditionEditor rather than introducing a second condition language. An
 * empty condition is legitimate and means "always matches" (a fallback layer);
 * invalid input blocks the save exactly as everywhere else.
 */
export class ContextProfileModal extends Modal {
    private name: string;
    private readonly initialConditions: ButtonCondition | undefined;
    private readonly titleText: string;
    private readonly onSubmit: (
        name: string,
        conditions: ButtonCondition | undefined
    ) => void;

    private nameInput: TextComponent | null = null;
    private conditionsInput: ConditionEditor | null = null;

    constructor(
        app: App,
        options: {
            title: string;
            name?: string;
            conditions?: ButtonCondition;
            onSubmit: (name: string, conditions: ButtonCondition | undefined) => void;
        }
    ) {
        super(app);
        this.titleText = options.title;
        this.name = options.name ?? '';
        this.initialConditions = options.conditions;
        this.onSubmit = options.onSubmit;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass('buttons-panel');
        contentEl.addClass('ocap-context-profile-modal');

        titleEl.setText(this.titleText);

        new Setting(contentEl)
            .setName(t('palette_context_name'))
            .setDesc(t('palette_context_name_desc'))
            .addText((text) => {
                this.nameInput = text;
                text.setValue(this.name).onChange((value) => {
                    this.name = value;
                    this.nameInput?.inputEl.classList.remove('input-error');
                });
                text.inputEl.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        this.handleSave();
                    }
                });
            });

        this.conditionsInput = new ConditionEditor(contentEl, this.initialConditions, {
            name: t('palette_context_condition_label'),
            description: t('palette_context_conditions_desc'),
        });

        new Setting(contentEl)
            .addButton((button) =>
                button
                    .setButtonText(t('save'))
                    .setCta()
                    .setClass('save-btn')
                    .onClick(() => this.handleSave())
            )
            .addButton((button) =>
                button
                    .setButtonText(t('cancel'))
                    .setClass('cancel-btn')
                    .onClick(() => this.close())
            );
    }

    private handleSave(): void {
        const name = this.name.trim();
        if (name.length === 0) {
            this.nameInput?.inputEl.classList.add('input-error');
            new Notice(t('palette_context_name_empty'));
            return;
        }

        const conditionsResult = this.conditionsInput?.getResult();
        if (conditionsResult && !conditionsResult.ok) {
            new Notice(conditionsResult.error);
            return;
        }

        this.onSubmit(name, conditionsResult ? conditionsResult.conditions : undefined);
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * Confirmation before deleting a context profile. A profile holding tools says
 * so explicitly and names them — deleting a layer must never silently drop
 * configuration the user cannot see from here.
 */
export class ContextProfileDeleteModal extends Modal {
    private readonly profileName: string;
    private readonly buttonNames: string[];
    private readonly onConfirm: () => void;

    constructor(
        app: App,
        options: { profileName: string; buttonNames: string[]; onConfirm: () => void }
    ) {
        super(app);
        this.profileName = options.profileName;
        this.buttonNames = options.buttonNames;
        this.onConfirm = options.onConfirm;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass('buttons-panel');

        titleEl.setText(t('palette_context_delete_title'));

        const count = this.buttonNames.length;
        contentEl.createEl('p', {
            text:
                count === 0
                    ? t('palette_context_delete_confirm_empty').replace(
                          '{name}',
                          this.profileName
                      )
                    : t('palette_context_delete_confirm')
                          .replace('{name}', this.profileName)
                          .replace('{count}', String(count)),
        });

        if (count > 0) {
            const list = contentEl.createEl('ul', { cls: 'ocap-context-delete-list' });
            for (const name of this.buttonNames) {
                list.createEl('li', { text: name });
            }
        }

        new Setting(contentEl)
            .addButton((button) =>
                button
                    .setButtonText(t('delete'))
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
