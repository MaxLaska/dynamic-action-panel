import { App, Modal, Setting, Notice, TextComponent } from 'obsidian';
import { ButtonsPanelPlugin } from '@/types/plugin';
import { CategoryConfig } from '@/types';
import { t, tWithParams } from '@/utils/i18n';
import { ConditionEditor } from '@/components/input';
import {
    GRID_SLOT_COUNT,
    applyCategoryLayout,
    getCategoryLayout,
    type CategoryLayout,
} from '@/utils/categoryGrid';

/**
 * CategoryEditModal 分类编辑模态框类。
 * 用于输入新分类名称并保存，支持回车提交、空名校验。
 * OCAP: additionally edits the category's visibility conditions with the
 * shared visual ConditionEditor.
 */
export class CategoryEditModal extends Modal {
    // 插件主类实例
    plugin: ButtonsPanelPlugin;
    // 要重命名的分类ID
    categoryId: string;
    // 旧的分类名称
    oldCategoryName: string;
    // 旧的分类可见性条件
    private oldConditions: CategoryConfig['conditions'];
    // 重命名后的回调函数
    onRename: () => void;
    // 输入框当前的新分类名称
    newName: string;
    // 输入框组件引用（Obsidian Setting 的 text 控件）
    private nameInput: TextComponent | null = null;
    // OCAP visibility conditions editor (visual builder + advanced JSON)
    private conditionsInput: ConditionEditor | null = null;
    // OCAP palette: selected button layout (flow / 4x4 grid)
    private selectedLayout: CategoryLayout;
    // Explanation line below the layout dropdown
    private layoutHintEl: HTMLElement | null = null;

    /**
     * 构造函数，初始化模态框。
     * @param app Obsidian应用实例
     * @param plugin 插件主类实例
     * @param category 要重命名的分类对象
     * @param onRename 重命名后的回调
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

    private updateLayoutHint(): void {
        if (!this.layoutHintEl) return;
        this.layoutHintEl.setText(
            this.selectedLayout === 'grid'
                ? tWithParams('category_layout_grid_hint', { slots: GRID_SLOT_COUNT })
                : t('category_layout_flow_hint')
        );
    }

    /**
     * 打开模态框时自动调用，渲染界面。
     */
    onOpen() {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass('buttons-panel');
        contentEl.addClass('category-edit');

        // 使用 Obsidian Modal 自带的标题栏
        titleEl.setText(t('edit_category'));

        // 分类名称输入框
        const nameSetting = new Setting(contentEl).setName(t('category_name'));

        nameSetting.addText((text) => {
            this.nameInput = text;
            text.setValue(this.oldCategoryName).onChange((value) => {
                this.newName = value;
                // 清除错误状态
                this.nameInput?.inputEl.classList.remove('input-error');
            });
            // 支持回车直接提交
            text.inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.handleSave();
                }
            });
        });

        // OCAP palette: button layout of this category
        this.renderLayoutSetting(contentEl);

        // OCAP: visual visibility-conditions editor (validated on save)
        this.conditionsInput = new ConditionEditor(contentEl, this.oldConditions, {
            description: t('conditions_category_desc'),
        });

        // 底部操作按钮：保存/取消
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
     * 处理保存逻辑，校验输入并更新分类名称与可见性条件。
     */
    handleSave() {
        if (!this.newName || this.newName.trim() === '') {
            this.nameInput?.inputEl.classList.add('input-error');
            new Notice(t('category_name_empty'));
            return;
        }

        // 清除错误状态
        this.nameInput?.inputEl.classList.remove('input-error');

        // 验证 OCAP 条件输入（可视化编辑器 / JSON）
        const conditionsResult = this.conditionsInput?.getResult();
        if (conditionsResult && !conditionsResult.ok) {
            new Notice(conditionsResult.error);
            return;
        }

        // 不再检测重名，允许同名分类

        // 根据ID查找分类并用新对象替换：
        // 对象身份约定（DECISIONS.md）——内容变化必须产生新的对象引用。
        const categories = this.plugin.settings.categories;
        const index = categories.findIndex((c) => c.id === this.categoryId);
        if (index === -1) {
            new Notice(t('category_not_found'));
            return;
        }

        // Layout first: switching to the grid rewrites the buttons (assigning
        // slots), and it can legitimately refuse — nothing must be saved then.
        const layoutResult = applyCategoryLayout(categories[index]!, this.selectedLayout);
        if (!layoutResult.ok) {
            new Notice(
                tWithParams('category_layout_too_many_buttons', {
                    count: layoutResult.buttonCount,
                    slots: layoutResult.slotCount,
                })
            );
            return;
        }

        const updated: CategoryConfig = {
            ...layoutResult.category,
            name: this.newName.trim(),
            // Explicitly assign (possibly undefined) so clearing the editor
            // removes previously saved conditions (undefined is dropped by
            // JSON serialization on save).
            conditions: conditionsResult ? conditionsResult.conditions : undefined,
        };
        categories[index] = updated;
        void this.plugin.saveSettings();
        this.onRename();
        this.close();
    }

    /**
     * 关闭模态框时自动调用，清理内容。
     */
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
