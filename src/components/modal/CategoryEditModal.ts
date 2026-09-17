import { App, Modal, Setting, Notice, TextComponent, setIcon } from 'obsidian';
import { ButtonsPanelPlugin } from '@/types/plugin';
import { CategoryConfig } from '@/types';
import type { StoredCategory } from '@/types/settings';
import { t, tWithParams } from '@/utils/i18n';
import { ConditionEditor } from '@/components/input';
import { getCategoryLayout, type CategoryLayout } from '@/utils/categoryGrid';
import {
    findFallbackVariant,
    findVariant,
    getCategoryVariants,
    isDynamicCategory,
    moveVariant,
    triggeredVariants,
    updateVariant,
} from '@/utils/categoryVariants';
import { applyStoredCategoryLayout } from '@/domain/categoryOps';
import { summarizeVariantTrigger } from '@/utils/conditionSummary';
import { VariantModal } from '@/components/modal/VariantModal';
import {
    commitStoredCategory,
    commitToolState,
    findStoredCategory,
    toolStateOf,
} from '@/utils/categoryStore';

/**
 * Modal for editing a category.
 * Renames the category, submitting on Enter and rejecting an empty name.
 * Additionally edits the category's visibility conditions with the
 * shared visual ConditionEditor.
 */
export class CategoryEditModal extends Modal {
    // Plugin instance
    plugin: ButtonsPanelPlugin;
    // Id of the category being renamed
    categoryId: string;
    // Previous category name
    oldCategoryName: string;
    // Previous category visibility conditions
    private oldConditions: CategoryConfig['conditions'];
    // Called after the rename
    onRename: () => void;
    // New category name currently entered
    newName: string;
    // Reference to the text control of the Obsidian Setting
    private nameInput: TextComponent | null = null;
    // visibility conditions editor (visual builder + advanced JSON)
    private conditionsInput: ConditionEditor | null = null;
    // Palette: selected button layout (flow / resizable grid)
    private selectedLayout: CategoryLayout;
    // Explanation line below the layout dropdown
    private layoutHintEl: HTMLElement | null = null;
    // Container of the variant overview; redrawn in place after every edit
    private variantsSectionEl: HTMLElement | null = null;

    /**
     * Initializes the modal.
     * @param app Obsidian app instance
     * @param plugin Plugin instance
     * @param category Category to rename
     * @param onRename Called after the rename
     */
    constructor(
        app: App,
        plugin: ButtonsPanelPlugin,
        category: CategoryConfig,
        onRename: () => void
    ) {
        super(app);
        this.plugin = plugin;
        this.categoryId = category.id;
        this.oldCategoryName = category.name;
        this.oldConditions = category.conditions;
        this.onRename = onRename;
        this.newName = category.name;
        this.selectedLayout = getCategoryLayout(category);
    }

    /** Layout dropdown + a one-line explanation of the selected layout. */
    private renderLayoutSetting(contentEl: HTMLElement): void {
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
                        this.updateLayoutHint();
                    });
            });

        this.layoutHintEl = contentEl.createDiv({ cls: 'ocap-layout-hint' });
        this.updateLayoutHint();
    }

    /**
     * Overview of a dynamic category's variants, in priority order: one
     * scannable row per variant with its name, its trigger in words and its
     * position, plus the controls to edit and reorder it.
     *
     * The point is that configuring a dynamic category never requires picking
     * every variant in turn just to find out what it reacts to. Editing reuses
     * the same VariantModal and the same pure variant operations as the
     * variant selector next to the grid — this is a second entry point, not a
     * second implementation.
     */
    private renderVariantsOverview(contentEl: HTMLElement): void {
        this.variantsSectionEl = contentEl.createDiv('ocap-variants-section');
        this.renderVariantRows();
    }

    /** The stored category, or null if it was deleted while the modal is open. */
    private storedCategory(): StoredCategory | null {
        return findStoredCategory(this.plugin, this.categoryId);
    }

    /**
     * Apply a pure variant operation to the STORED category and redraw the
     * rows. The name/layout/conditions the modal is editing live in its own
     * fields and are read fresh on save, so writing variants through here
     * cannot collide with them.
     */
    private updateStoredCategory(update: (category: StoredCategory) => StoredCategory): void {
        const stored = this.storedCategory();
        if (!stored) {
            new Notice(t('category_not_found'));
            return;
        }
        void commitStoredCategory(this.plugin, update(stored));
        this.renderVariantRows();
    }

    private renderVariantRows(): void {
        const section = this.variantsSectionEl;
        if (!section) return;
        section.empty();

        const category = this.storedCategory();
        if (!category || !isDynamicCategory(category)) {
            return;
        }

        const heading = new Setting(section)
            .setName(t('variants_section'))
            .setDesc(t('variants_section_desc'));
        heading.settingEl.addClass('ocap-variants-heading');

        const variants = getCategoryVariants(category);
        const list = section.createDiv('ocap-variants-list');
        if (variants.length === 0) {
            list.createDiv({ cls: 'ocap-variants-empty', text: t('variant_none_yet') });
            return;
        }

        // Column headers, so the three columns are readable as a table even
        // though they are flex rows (Obsidian modals are narrow and a real
        // table would not wrap gracefully).
        const header = list.createDiv('ocap-variants-row ocap-variants-row--header');
        header.createSpan({
            cls: 'ocap-variants-priority',
            text: t('variants_header_priority'),
        });
        header.createSpan({ cls: 'ocap-variants-name', text: t('variants_header_variant') });
        header.createSpan({
            cls: 'ocap-variants-trigger',
            text: t('variants_header_trigger'),
        });
        header.createSpan({ cls: 'ocap-variants-actions' });

        // Reordering only applies to triggered variants: the fallback is always
        // evaluated last regardless of its position.
        const ordered = triggeredVariants(category);
        let priority = 0;

        for (const variant of variants) {
            const isFallback = variant.fallback === true;
            const summary = summarizeVariantTrigger(variant);
            const row = list.createDiv('ocap-variants-row');

            row.createSpan({
                cls: 'ocap-variants-priority',
                text: isFallback ? '—' : String(++priority),
            });
            row.createSpan({ cls: 'ocap-variants-name', text: variant.name });
            const triggerEl = row.createSpan({
                cls: 'ocap-variants-trigger',
                text: summary.summary,
            });
            triggerEl.setAttribute('title', summary.summary);
            if (summary.broken) {
                triggerEl.addClass('ocap-variants-trigger--broken');
            }
            if (isFallback) {
                triggerEl.addClass('ocap-variants-trigger--fallback');
            }

            const actions = row.createDiv('ocap-variants-actions');
            this.createRowButton(actions, 'pencil', t('variants_overview_edit'), () =>
                this.openVariantEditor(variant.id)
            );

            const index = ordered.findIndex((v) => v.id === variant.id);
            this.createRowButton(
                actions,
                'arrow-up',
                t('variants_overview_move_up'),
                () => this.updateStoredCategory((stored) => moveVariant(stored, variant.id, -1)),
                isFallback || index <= 0
            );
            this.createRowButton(
                actions,
                'arrow-down',
                t('variants_overview_move_down'),
                () => this.updateStoredCategory((stored) => moveVariant(stored, variant.id, 1)),
                isFallback || index === -1 || index >= ordered.length - 1
            );

            row.createSpan({
                cls: 'ocap-variants-count',
                text: tWithParams('variant_tools_count', {
                    count: variant.placements?.length ?? 0,
                }),
            });
        }
    }

    private createRowButton(
        parent: HTMLElement,
        icon: string,
        label: string,
        onClick: () => void,
        disabled = false
    ): HTMLButtonElement {
        const button = parent.createEl('button', {
            cls: 'clickable-icon ocap-variants-action',
        });
        button.type = 'button';
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
        setIcon(button, icon);
        button.disabled = disabled;
        button.addEventListener('click', onClick);
        return button;
    }

    /** Same modal the variant selector opens — name, fallback flag, trigger. */
    private openVariantEditor(variantId: string): void {
        const category = this.storedCategory();
        const variant = category ? findVariant(category, variantId) : null;
        if (!category || !variant) {
            new Notice(t('category_not_found'));
            return;
        }
        const fallback = findFallbackVariant(category);
        new VariantModal(this.app, {
            title: t('variant_edit_title'),
            name: variant.name,
            trigger: variant.trigger,
            fallback: variant.fallback === true,
            fallbackTaken: fallback !== null && fallback.id !== variantId,
            onSubmit: ({ name, trigger, fallback: isFallback }) => {
                this.updateStoredCategory((stored) =>
                    updateVariant(stored, variantId, { name, trigger, fallback: isFallback })
                );
            },
        }).open();
    }

    private updateLayoutHint(): void {
        if (!this.layoutHintEl) return;
        this.layoutHintEl.setText(
            this.selectedLayout === 'grid'
                ? t('category_layout_grid_hint')
                : t('category_layout_flow_hint')
        );
    }

    /**
     * Called when the modal opens; renders the UI.
     */
    onOpen() {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass('buttons-panel');
        contentEl.addClass('category-edit');

        // Use the title bar provided by the Obsidian Modal.
        titleEl.setText(t('edit_category'));

        // Category name input.
        const nameSetting = new Setting(contentEl).setName(t('category_name'));

        nameSetting.addText((text) => {
            this.nameInput = text;
            text.setValue(this.oldCategoryName).onChange((value) => {
                this.newName = value;
                // Clear the error state.
                this.nameInput?.inputEl.classList.remove('input-error');
            });
            // Enter submits the form.
            text.inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.handleSave();
                }
            });
        });

        // Grid: button layout of this category
        this.renderLayoutSetting(contentEl);

        // Dynamic category: priority overview of the variants
        this.renderVariantsOverview(contentEl);

        // Visual visibility-conditions editor (validated on save)
        this.conditionsInput = new ConditionEditor(contentEl, this.oldConditions, {
            description: t('conditions_category_desc'),
        });

        // Footer buttons: save and cancel.
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

    /**
     * Validates the input and updates the category name and visibility conditions.
     */
    handleSave() {
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

        // Duplicate names are allowed; no uniqueness check.

        // Resolve the stored category by id and replace it with a new object:
        // the object identity contract (DECISIONS.md) requires a new reference on every content change.
        const stored = this.storedCategory();
        if (!stored) {
            new Notice(t('category_not_found'));
            return;
        }

        // Layout first: switching to the grid rewrites the placements
        // (assigning slots, lifting conditions into variants), and it can
        // legitimately refuse — nothing must be saved then.
        const layoutResult = applyStoredCategoryLayout(
            toolStateOf(this.plugin),
            this.categoryId,
            this.selectedLayout
        );
        if (!layoutResult.ok) {
            new Notice(
                layoutResult.reason === 'dynamic_category'
                    ? t('category_layout_dynamic_refused')
                    : tWithParams('category_layout_too_many_buttons', {
                          count: layoutResult.buttonCount,
                          slots: layoutResult.slotCount,
                      })
            );
            return;
        }

        const state = layoutResult.state;
        const categories = state.categories.map((category) =>
            category.id !== this.categoryId
                ? category
                : {
                      ...category,
                      name: this.newName.trim(),
                      // Explicitly assign (possibly undefined) so clearing the
                      // editor removes previously saved conditions (undefined
                      // is dropped by JSON serialization on save).
                      conditions: conditionsResult
                          ? conditionsResult.conditions
                          : undefined,
                  }
        );
        void commitToolState(this.plugin, { tools: state.tools, categories });
        this.onRename();
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
