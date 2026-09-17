/**
 * ButtonCreateModal - modal for creating a button
 * Stylesheet: ButtonCreateModal.css
 */
import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';
import { ButtonConfig } from '@/types';
import type { ButtonAction } from '@/types/action';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import { t } from '@/utils/i18n';
import { ActionSequence } from '@/actions/ActionSequence';
import { NameInput, IconInput, ConditionEditor } from '@/components/input';
import { findVariant, type VariantFields } from '@/utils/categoryVariants';
import { isGridCategory } from '@/utils/categoryGrid';
import { commitToolState, findStoredCategory, toolStateOf } from '@/utils/categoryStore';
import { createToolInCategory } from '@/domain/categoryOps';
import { createDefaultButtonConfig } from '@/utils/buttonFactory';

/**
 * The category slice the modal needs — structurally satisfied by BOTH the
 * stored (v5) and the materialized view shape, so callers can hand in
 * whichever they hold; the save path always resolves the stored one by id.
 */
export interface ButtonModalCategoryRef {
    id: string;
    layout?: 'flow' | 'grid';
    variants?: VariantFields[];
}

/**
 * Modal for creating a new button.
 * Collects the basic fields and the action configuration for a new button in a given category, and validates them on save.
 */
export class ButtonCreateModal extends Modal {
    // Plugin instance
	plugin: ButtonsPanelPlugin;
    // Category the button belongs to
    parentCategory: ButtonModalCategoryRef;
    // Called after a successful save
    onSave?: () => void;
    // Working copy of the button being edited
    tempButton: ButtonConfig;
    // Action sequence of the button
    actionSequence: ActionSequence;
    // Name input component
    nameInput: NameInput | null = null;
    // Icon input component
    iconInput: IconInput | null = null;
    // visibility conditions editor (visual builder + advanced JSON)
    conditionsInput: ConditionEditor | null = null;
    /**
     * Grid categories: the variant the new tool is created in (the one the
     * user is editing), or null for a static grid. There is no separate
     * "contextual" switch — the variant selector above the grid decides.
     */
    private readonly targetVariantId: string | null;
    /**
     * Grid categories: the slot the user pointed at when opening this modal
     * (the `+` of an empty cell). The position is part of the gesture, so the
     * tool lands exactly there; null falls back to the lowest free slot.
     */
    private readonly targetSlot: number | null;

    /**
     * Initializes the modal and its working copy of the button.
     * @param app Obsidian app instance
     * @param plugin Plugin instance
     * @param parentCategory Category the button belongs to
     * @param onSave Called after a successful save
     * @param targetVariantId Target variant (dynamic grid categories only)
     * @param targetSlot Target slot (grid categories only)
     */
	constructor(app: App, plugin: ButtonsPanelPlugin, parentCategory: ButtonModalCategoryRef, onSave?: () => void, targetVariantId: string | null = null, targetSlot: number | null = null) {
        super(app);
        this.plugin = plugin;
        this.parentCategory = parentCategory;
        this.onSave = onSave;
        this.targetVariantId = targetVariantId;
        this.targetSlot = targetSlot;
        this.tempButton = createDefaultButtonConfig();
        this.actionSequence = new ActionSequence(this.tempButton.actions);
        // A new button starts with one default action.
        if (this.tempButton.actions.length === 0) {
            this.actionSequence.addDefaultAction();
        }
    }

    /**
     * Called when the modal opens; renders the form.
     */
    onOpen(): void {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass('buttons-panel');
        contentEl.addClass('button-edit');

        // Use the title bar provided by the Obsidian Modal.
        titleEl.setText(t('add_button'));

        const formContainer = contentEl.createDiv('form-container');
        // Split the body into two independent containers.
        const basicInfoContainer = formContainer.createDiv('basic-info-container');
        const actionSettingsContainer = formContainer.createDiv('action-settings-container');
        this.createBasicSettings(basicInfoContainer);
        this.createActionSettings(actionSettingsContainer);
        this.createActionButtons(contentEl);
    }

    /**
     * Renders the basic settings section.
     * @param container Container element
     */
    createBasicSettings(container: HTMLElement): void {
        container.createEl('h3', { text: t('basic_info') });

        // Reusable name input component.
        this.nameInput = new NameInput(container, {
            name: t('button_name'),
            description: t('button_name_desc'),
            placeholder: t('button_name_placeholder'),
            value: this.tempButton.name,
            onValueChange: (value: string) => {
                this.tempButton.name = value;
            },
            onEnter: () => {
                // Enter saves the button.
                void this.saveButton();
            },
            onValidationError: (error: string) => {
                console.warn('Name validation error:', error);
            },
        });

        // Reusable icon input component.
        this.iconInput = new IconInput(
            container,
            {
                name: t('button_icon'),
                description: t('button_icon_desc'),
                placeholder: t('button_icon_placeholder'),
                searchTooltip: t('search_icons_tooltip'),
                uploadTooltip: t('upload_svg_icon_tooltip'),
            },
            { app: this.app, plugin: this.plugin },
            (value: string) => {
                this.tempButton.icon = value;
            }
        );

        // Apply the initial values.
        this.nameInput.setValue(this.tempButton.name || '');
        this.iconInput.setValue(this.tempButton.icon || '');

        // Inside a grid category, contextuality is a property of the
        // VARIANT the tool is created in, not of the individual button — so
        // the per-button condition editor is replaced by a statement of where
        // it will land.
        if (isGridCategory(this.parentCategory)) {
            renderGridTargetNotice(container, this.parentCategory, this.targetVariantId);
            return;
        }

        // Visual visibility-conditions editor (validated on save)
        this.conditionsInput = new ConditionEditor(container, this.tempButton.conditions);
    }

    /**
     * Renders the action settings section.
     * @param container Container element
     */
    createActionSettings(container: HTMLElement): void {
        container.empty();
        container.createEl('h3', { text: t('action_sequence') });
        // Sub-heading and container for the basic action options.
        const basicActionSettings = container.createDiv('basic-action-options');
        basicActionSettings.createEl('h4', { text: t('basic_options') });
        // Execution mode.
        new Setting(basicActionSettings)
            .setName(t('execution_mode'))
            .setDesc(t('execution_mode_desc'))
            .addDropdown((drop) => {
                drop.addOption('sequential', t('sequential'));
                drop.addOption('parallel', t('parallel'));
                drop.setValue(this.tempButton.executionMode || 'sequential');
                drop.onChange((value: string) => {
                    this.tempButton.executionMode = value as 'sequential' | 'parallel';
                    // Re-render so the dependent options are enabled or disabled.
                    container.empty();
                    this.createActionSettings(container);
                });
            });
        const isParallel = this.tempButton.executionMode === 'parallel';
        // Whether to stop on error.
        const stopSetting = new Setting(basicActionSettings)
            .setName(t('stop_on_error'))
            .setDesc(t('stop_on_error_desc'))
            .addToggle((toggle) => {
                toggle.setValue(this.tempButton.stopOnError ?? true);
                toggle.onChange((value) => {
                    this.tempButton.stopOnError = value;
                });
                if (isParallel) toggle.setDisabled(true);
            });
        if (isParallel) {
            stopSetting.settingEl.addClass('is-disabled');
            stopSetting.settingEl.addClass('is-hidden');
            stopSetting.setDesc(t('only_sequential_effective'));
        }
        // Delay between actions.
        const delaySetting = new Setting(basicActionSettings)
            .setName(t('delay_between_actions'))
            .setDesc(t('delay_between_actions_desc'))
            .addText((text) => {
                text.inputEl.type = 'number';
                text.setValue(String(this.tempButton.delayBetweenActions ?? 100));
                text.onChange((value) => {
                    this.tempButton.delayBetweenActions = Number(value) || 100;
                });
                if (isParallel) text.setDisabled(true);
            });
        if (isParallel) {
            delaySetting.settingEl.addClass('is-disabled');
            delaySetting.settingEl.addClass('is-hidden');
            delaySetting.setDesc(t('only_sequential_effective'));
        }
        const actionValueContainer = container.createDiv({ cls: 'action-list' });
        // Let ActionSequence render all actions.
        this.actionSequence.renderAll(actionValueContainer, { app: this.app, plugin: this.plugin });
    }

    /**
     * Creates the save and cancel buttons.
     * @param container Container element
     */
    private createActionButtons(container: HTMLElement): void {
        new Setting(container)
            .addButton((btn) => {
                btn.setButtonText(t('save'))
                    .setCta()
                    .setClass('save-btn')
                    .onClick(() => this.saveButton());
            })
            .addButton((btn) => {
                btn.setButtonText(t('cancel'))
                    .setClass('cancel-btn')
                    .onClick(() => this.close());
            });
    }

    /** Returns the current working copy of the button */
    getCurrentButton(): ButtonConfig {
        return this.tempButton;
    }

    /**
     * Validates and saves the button, then closes the modal.
     */
    async saveButton(): Promise<void> {
        let hasError = false;

        // Validate the name input.
        if (!this.nameInput?.getValue()?.trim()) {
            this.nameInput?.setError(t('please_complete_required_fields'));
            hasError = true;
        } else {
            this.nameInput?.clearError();
        }

        // Actions: untouched rows are dropped, half-filled ones block. A tool
        // without any action is a legitimate state (see collectConfiguredActions).
        const actionResult = this.actionSequence.collectConfiguredActions();
        if (!actionResult.ok) {
            hasError = true;
        }

        // Validate the visibility conditions input (JSON plus structural checks).
        const conditionsResult = this.conditionsInput?.getResult();
        if (conditionsResult && !conditionsResult.ok) {
            new Notice(conditionsResult.error);
            return;
        }

        // On any error, show a notice and stop.
        if (hasError || !actionResult.ok) {
            new Notice(t('please_complete_required_fields'));
            return;
        }

        // Take over the serialized ActionSequence result as ButtonAction[].
        this.tempButton.actions = actionResult.actions as ButtonAction[];
        this.tempButton.conditions = conditionsResult ? conditionsResult.conditions : undefined;

        // Always write into the STORED category: the object this modal was
        // opened with can be a projection copy. createToolInCategory
        // registers the definition and places it in ONE step — in the slot
        // the gesture pointed at (grid) or appended to the flow list.
        const stored = findStoredCategory(this.plugin, this.parentCategory.id);
        if (!stored) {
            new Notice(t('category_not_found'));
            return;
        }
        const next = createToolInCategory(
            toolStateOf(this.plugin),
            stored.id,
            this.targetVariantId,
            this.tempButton,
            this.targetSlot
        );
        if (!next) {
            new Notice(t('variant_grid_full'));
            return;
        }
        await commitToolState(this.plugin, next);

        new Notice(t('button_create_success'));
        this.close();
        this.onSave?.();
    }
}

/**
 * Explains, inside a grid category's button modal, where the tool lives — a
 * variant of a dynamic category, or the static grid — replacing the
 * per-button condition editor, which a grid deliberately does not use.
 */
export function renderGridTargetNotice(
    container: HTMLElement,
    category: ButtonModalCategoryRef,
    variantId: string | null
): void {
    const variantName =
        variantId !== null ? (findVariant(category, variantId)?.name ?? null) : null;

    const setting = new Setting(container)
        .setName(t('grid_button_target_label'))
        .setDesc(
            variantName === null
                ? t('grid_button_target_static_desc')
                : t('grid_button_target_variant_desc').replace('{name}', variantName)
        );
    setting.settingEl.addClass('ocap-grid-target-notice');
    setting.controlEl.createSpan({
        cls: 'ocap-grid-target-notice-value',
        text: variantName ?? t('grid_button_target_static'),
    });
}
