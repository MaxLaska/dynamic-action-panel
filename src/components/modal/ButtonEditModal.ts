/**
 * ButtonEditModal - modal for editing a button
 * Stylesheet: ButtonEditModal.css
 */
import type { App } from 'obsidian';
import { Modal, Setting, Notice } from 'obsidian';
import { ButtonConfig } from '@/types';
import type { ButtonAction } from '@/types/action';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import { t } from '@/utils/i18n';
import { ActionSequence } from '@/actions/ActionSequence';
import { NameInput, IconInput, ConditionEditor } from '@/components/input';
import {
    renderGridTargetNotice,
    type ButtonModalCategoryRef,
} from '@/components/modal/ButtonCreateModal';
import { isGridCategory } from '@/utils/categoryGrid';
import { commitToolState, findStoredCategory, toolStateOf } from '@/utils/categoryStore';
import { updateToolDefinition } from '@/domain/categoryOps';
import { findToolVariantId } from '@/domain/tools';

/**
 * Modal for editing an existing button.
 * Edits the basic fields and the action configuration of a button, validating them on save.
 */
export class ButtonEditModal extends Modal {
    // Plugin instance
	plugin: ButtonsPanelPlugin;
    // Button being edited
    button: ButtonConfig;
    // Category the button belongs to
    parentCategory: ButtonModalCategoryRef;
    // Called after a successful save
    onSave?: () => void;
    // Working copy that holds the edits until they are saved
    tempButton: ButtonConfig;
    // Action sequence, which manages adding, removing and validating actions
    actionSequence: ActionSequence;
    // Name input component
    nameInput: NameInput | null = null;
    // Icon input component
    iconInput: IconInput | null = null;
    // visibility conditions editor (visual builder + advanced JSON)
    conditionsInput: ConditionEditor | null = null;

    /**
     * Initializes the modal and its working copy of the button.
     * @param app Obsidian app instance
     * @param plugin Plugin instance
     * @param button Button to edit
     * @param parentCategory Category the button belongs to
     * @param onSave Called after a successful save
     */
    constructor(
		app: App,
		plugin: ButtonsPanelPlugin,
        button: ButtonConfig,
        parentCategory: ButtonModalCategoryRef,
        onSave?: () => void
    ) {
        super(app);
        this.plugin = plugin;
        this.button = button;
        this.parentCategory = parentCategory;
        this.onSave = onSave;
        // Deep-copy the button field by field (no `any`) so the original data is never mutated.
        this.tempButton = {
            ...button,
            actions: button.actions.map((action) => ({ ...action })),
        };
        // Drop invalid actions.
        const validActions = Array.isArray(this.tempButton.actions)
            ? this.tempButton.actions.filter((a) => a && typeof a === 'object' && a.type)
            : [];
        this.actionSequence = new ActionSequence(validActions);
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
        titleEl.setText(t('edit_button'));

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

        // inside a grid category the variant decides contextuality, so
        // the per-button condition editor is replaced by the target statement.
        if (isGridCategory(this.parentCategory)) {
            const stored = findStoredCategory(this.plugin, this.parentCategory.id);
            renderGridTargetNotice(
                container,
                stored ?? this.parentCategory,
                stored ? findToolVariantId(stored, this.button.id) : null
            );
            return;
        }

        // visual visibility-conditions editor (validated on save)
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

        // Actions: untouched rows are dropped, half-filled ones block. An
        // existing tool may also have its last action removed again.
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
        // Explicitly assign (possibly undefined) so clearing the textarea
        // removes previously saved conditions through the spread below.
        this.tempButton.conditions = conditionsResult ? conditionsResult.conditions : undefined;

        // Replace the button with a new object instead of mutating it in place:
        // React.memo comparisons rely on a changed object identity to detect
        // edited button content (see areButtonItemPropsEqual in ButtonItem).
        const updatedButton: ButtonConfig = { ...this.button, ...this.tempButton };

        // v5: an edit changes only the TOOL DEFINITION in the registry —
        // the placement (which grid/variant/slot or flow position holds it)
        // is untouched, so this one write covers grid and flow alike.
        await commitToolState(
            this.plugin,
            updateToolDefinition(toolStateOf(this.plugin), updatedButton)
        );

        new Notice(t('button_update_success'));
        this.close();
        this.onSave?.();
    }
}
