import { App, Modal, Notice, Setting, TextComponent, ToggleComponent } from 'obsidian';
import type { ButtonCondition } from '@/types/conditions';
import { t } from '@/utils/i18n';
import { ConditionEditor } from '@/components/input';

export interface VariantModalResult {
    name: string;
    /** Trigger of a normal variant; undefined when `fallback` is true. */
    trigger: ButtonCondition | undefined;
    fallback: boolean;
}

/**
 * VariantModal — create, edit or duplicate one variant of a dynamic grid
 * category.
 *
 * A variant owns exactly one trigger, so this reuses the shared visual
 * ConditionEditor rather than introducing a second condition language. An
 * empty trigger means "always matches" (stored explicitly as `{ all: [] }`,
 * respecting priority order); the fallback toggle replaces the trigger
 * entirely — the fallback renders only when no triggered variant matches.
 * Invalid input blocks the save exactly as everywhere else.
 */
export class VariantModal extends Modal {
    private name: string;
    private fallback: boolean;
    private readonly initialTrigger: ButtonCondition | undefined;
    private readonly titleText: string;
    /** True when another variant already is the fallback (toggle disabled). */
    private readonly fallbackTaken: boolean;
    private readonly onSubmit: (result: VariantModalResult) => void;

    private nameInput: TextComponent | null = null;
    private fallbackToggle: ToggleComponent | null = null;
    private triggerEditor: ConditionEditor | null = null;
    private triggerSectionEl: HTMLElement | null = null;

    constructor(
        app: App,
        options: {
            title: string;
            name?: string;
            trigger?: ButtonCondition;
            fallback?: boolean;
            fallbackTaken?: boolean;
            onSubmit: (result: VariantModalResult) => void;
        }
    ) {
        super(app);
        this.titleText = options.title;
        this.name = options.name ?? '';
        this.initialTrigger = options.trigger;
        this.fallback = options.fallback ?? false;
        this.fallbackTaken = options.fallbackTaken ?? false;
        this.onSubmit = options.onSubmit;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass('buttons-panel');
        contentEl.addClass('ocap-variant-modal');

        titleEl.setText(this.titleText);

        new Setting(contentEl)
            .setName(t('variant_name'))
            .setDesc(t('variant_name_desc'))
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

        const fallbackSetting = new Setting(contentEl)
            .setName(t('variant_fallback'))
            .setDesc(
                this.fallbackTaken && !this.fallback
                    ? t('variant_fallback_taken')
                    : t('variant_fallback_desc')
            )
            .addToggle((toggle) => {
                this.fallbackToggle = toggle;
                toggle.setValue(this.fallback).onChange((value) => {
                    this.fallback = value;
                    this.updateTriggerVisibility();
                });
                if (this.fallbackTaken && !this.fallback) {
                    toggle.setDisabled(true);
                }
            });
        fallbackSetting.settingEl.addClass('ocap-variant-fallback-setting');

        this.triggerSectionEl = contentEl.createDiv('ocap-variant-trigger-section');
        this.triggerEditor = new ConditionEditor(this.triggerSectionEl, this.initialTrigger, {
            name: t('variant_trigger_label'),
            description: t('variant_trigger_desc'),
        });
        this.updateTriggerVisibility();

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

    private updateTriggerVisibility(): void {
        this.triggerSectionEl?.toggleClass('ocap-variant-trigger-hidden', this.fallback);
    }

    private handleSave(): void {
        const name = this.name.trim();
        if (name.length === 0) {
            this.nameInput?.inputEl.classList.add('input-error');
            new Notice(t('variant_name_empty'));
            return;
        }

        if (this.fallback) {
            this.onSubmit({ name, trigger: undefined, fallback: true });
            this.close();
            return;
        }

        const triggerResult = this.triggerEditor?.getResult();
        if (triggerResult && !triggerResult.ok) {
            new Notice(triggerResult.error);
            return;
        }
        // An empty trigger editor means "always matches" — stored explicitly,
        // so an absent trigger can never be an accidental always-match.
        const trigger: ButtonCondition =
            triggerResult && triggerResult.conditions !== undefined
                ? triggerResult.conditions
                : { all: [] };

        this.onSubmit({ name, trigger, fallback: false });
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * Confirmation before deleting a variant. A variant holding tools says so
 * explicitly and names them — deleting a full grid must never silently drop
 * configuration the user cannot see from here.
 */
export class VariantDeleteModal extends Modal {
    private readonly variantName: string;
    private readonly buttonNames: string[];
    private readonly onConfirm: () => void;

    constructor(
        app: App,
        options: { variantName: string; buttonNames: string[]; onConfirm: () => void }
    ) {
        super(app);
        this.variantName = options.variantName;
        this.buttonNames = options.buttonNames;
        this.onConfirm = options.onConfirm;
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass('buttons-panel');

        titleEl.setText(t('variant_delete_title'));

        const count = this.buttonNames.length;
        contentEl.createEl('p', {
            text:
                count === 0
                    ? t('variant_delete_confirm_empty').replace('{name}', this.variantName)
                    : t('variant_delete_confirm')
                          .replace('{name}', this.variantName)
                          .replace('{count}', String(count)),
        });

        if (count > 0) {
            const list = contentEl.createEl('ul', { cls: 'ocap-variant-delete-list' });
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
