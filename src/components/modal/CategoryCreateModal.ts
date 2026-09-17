import { App, Modal, Setting, Notice, TextComponent } from 'obsidian';
import { ButtonsPanelPlugin } from '@/types/plugin';
import type { ButtonCondition } from '@/types/conditions';
import { t } from '@/utils/i18n';
import { ConditionEditor } from '@/components/input';
import {
    DEFAULT_CATEGORY_LAYOUT,
    type CategoryLayout,
} from '@/utils/categoryGrid';

/**
 * Modal for creating a category.
 * Collects the name of the new category and hands it to the create callback.
 * Optionally sets the category's visibility conditions with the shared
 * visual ConditionEditor.
 */
export class CategoryCreateModal extends Modal {
    /** Plugin instance */
    plugin: ButtonsPanelPlugin;
    /** Called after creation, with the new category name and the optional visibility conditions and layout */
    onCreate: (
        categoryName: string,
        conditions: ButtonCondition | undefined,
        layout: CategoryLayout
    ) => void;
    /** Category name currently entered */
    newName: string;
    /** Reference to the text control of the Obsidian Setting */
    private nameInput: TextComponent | null = null;
    /** visibility conditions editor (visual builder + advanced JSON) */
    private conditionsInput: ConditionEditor | null = null;
    /** Palette: button layout of the new category */
    private selectedLayout: CategoryLayout = DEFAULT_CATEGORY_LAYOUT;

    /**
     * Initializes the modal.
     * @param app Obsidian app instance
     * @param plugin Plugin instance
     * @param onCreate Called to create the category
     */
    constructor(
        app: App,
        plugin: ButtonsPanelPlugin,
        onCreate: (
            categoryName: string,
            conditions: ButtonCondition | undefined,
            layout: CategoryLayout
        ) => void
    ) {
        super(app);
        this.plugin = plugin;
        this.onCreate = onCreate;
        this.newName = '';
    }

    /**
     * Called when the modal opens; renders the input UI.
     */
    onOpen() {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass('buttons-panel');
        contentEl.addClass('category-create');

        // Use the title bar provided by the Obsidian Modal.
        titleEl.setText(t('create_new_category'));

        // Category name input.
        const nameSetting = new Setting(contentEl).setName(t('category_name'));

        nameSetting.addText((text) => {
            this.nameInput = text;
            text.setValue(this.newName).onChange((value) => {
                this.newName = value;
                // Clear the error state.
                this.nameInput?.inputEl.classList.remove('input-error');
            });
            // Enter submits the form.
            text.inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleCreate();
                }
            });
        });

        // Palette: button layout of the new category
        new Setting(contentEl)
            .setName(t('category_layout'))
            .setDesc(t('category_layout_desc'))
            .addDropdown((dropdown) => {
                dropdown
                    .addOption('flow', t('category_layout_flow'))
                    .addOption('grid', t('category_layout_grid'))
                    .setValue(this.selectedLayout)
                    .onChange((value) => {
                        this.selectedLayout = value === 'grid' ? 'grid' : 'flow';
                    });
            });

        // Visual visibility-conditions editor (validated on save)
        this.conditionsInput = new ConditionEditor(contentEl, undefined, {
            description: t('conditions_category_desc'),
        });

        // Footer buttons: save and cancel.
        new Setting(contentEl)
            .addButton((button) =>
                button
                    .setButtonText(t('save'))
                    .setCta()
                    .setClass('save-btn')
                    .onClick(() => this.handleCreate())
            )
            .addButton((button) =>
                button
                    .setButtonText(t('cancel'))
                    .setClass('cancel-btn')
                    .onClick(() => this.close())
            );
    }

    /**
     * Validates the input and invokes the create callback.
     */
    handleCreate() {
        // The category name must not be empty.
        if (!this.newName || this.newName.trim() === '') {
            this.nameInput?.inputEl.classList.add('input-error');
            new Notice(t('category_name_empty'));
            return;
        }

        // Clear the error state.
        this.nameInput?.inputEl.classList.remove('input-error');

        // Validate the visibility conditions input (visual editor or JSON).
        const conditionsResult = this.conditionsInput?.getResult();
        if (conditionsResult && !conditionsResult.ok) {
            new Notice(conditionsResult.error);
            return;
        }

        // Hand over to the create callback.
        this.onCreate(
            this.newName.trim(),
            conditionsResult ? conditionsResult.conditions : undefined,
            this.selectedLayout
        );
        this.close();
    }

    /**
     * Called when the modal closes; clears its content.
     */
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
