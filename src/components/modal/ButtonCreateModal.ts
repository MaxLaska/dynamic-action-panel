/**
 * ButtonCreateModal - 按钮创建模态框
 * 样式文件: ButtonCreateModal.css
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
 * ButtonCreateModal 按钮创建模态框类。
 * 用于在指定分类下创建新按钮，支持基本信息填写、动作配置、保存校验等。
 */
export class ButtonCreateModal extends Modal {
    // 插件主类实例
	plugin: ButtonsPanelPlugin;
    // 按钮所属分类
    parentCategory: ButtonModalCategoryRef;
    // 保存成功回调
    onSave?: () => void;
    // 临时按钮对象
    tempButton: ButtonConfig;
    // 动作序列对象
    actionSequence: ActionSequence;
    // 名称输入组件
    nameInput: NameInput | null = null;
    // 图标输入组件
    iconInput: IconInput | null = null;
    // OCAP visibility conditions editor (visual builder + advanced JSON)
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
     * 构造函数，初始化模态框和临时按钮对象。
     * @param app Obsidian应用实例
     * @param plugin 插件主类实例
     * @param parentCategory 按钮所属分类
     * @param onSave 保存成功回调
     * @param targetVariantId 目标 variant（仅 dynamic grid 分类）
     * @param targetSlot 目标槽位（仅 grid 分类）
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
        // 新建时如果没有动作，自动添加一个默认动作
        if (this.tempButton.actions.length === 0) {
            this.actionSequence.addDefaultAction();
        }
    }

    /**
     * 打开模态框时自动调用，渲染表单界面。
     */
    onOpen(): void {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        contentEl.addClass('buttons-panel');
        contentEl.addClass('button-edit');

        // 使用 Obsidian Modal 自带的标题栏
        titleEl.setText(t('add_button'));

        const formContainer = contentEl.createDiv('form-container');
        // 拆分为两个独立容器
        const basicInfoContainer = formContainer.createDiv('basic-info-container');
        const actionSettingsContainer = formContainer.createDiv('action-settings-container');
        this.createBasicSettings(basicInfoContainer);
        this.createActionSettings(actionSettingsContainer);
        this.createActionButtons(contentEl);
    }

    /**
     * 渲染基本信息设置区域。
     * @param container 容器元素
     */
    createBasicSettings(container: HTMLElement): void {
        container.createEl('h3', { text: t('basic_info') });

        // 使用可复用的名称输入组件
        this.nameInput = new NameInput(container, {
            name: t('button_name'),
            description: t('button_name_desc'),
            placeholder: t('button_name_placeholder'),
            value: this.tempButton.name,
            onValueChange: (value: string) => {
                this.tempButton.name = value;
            },
            onEnter: () => {
                // 回车时保存按钮
                void this.saveButton();
            },
            onValidationError: (error: string) => {
                console.warn('Name validation error:', error);
            },
        });

        // 使用可复用的图标输入组件
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

        // 设置初始值
        this.nameInput.setValue(this.tempButton.name || '');
        this.iconInput.setValue(this.tempButton.icon || '');

        // OCAP: inside a grid category, contextuality is a property of the
        // VARIANT the tool is created in, not of the individual button — so
        // the per-button condition editor is replaced by a statement of where
        // it will land.
        if (isGridCategory(this.parentCategory)) {
            renderGridTargetNotice(container, this.parentCategory, this.targetVariantId);
            return;
        }

        // OCAP: visual visibility-conditions editor (validated on save)
        this.conditionsInput = new ConditionEditor(container, this.tempButton.conditions);
    }

    /**
     * 渲染动作设置区域。
     * @param container 容器元素
     */
    createActionSettings(container: HTMLElement): void {
        container.empty();
        container.createEl('h3', { text: t('action_sequence') });
        // 新增：基本设置小标题和容器
        const basicActionSettings = container.createDiv('basic-action-options');
        basicActionSettings.createEl('h4', { text: t('basic_options') });
        // 执行模式
        new Setting(basicActionSettings)
            .setName(t('execution_mode'))
            .setDesc(t('execution_mode_desc'))
            .addDropdown((drop) => {
                drop.addOption('sequential', t('sequential'));
                drop.addOption('parallel', t('parallel'));
                drop.setValue(this.tempButton.executionMode || 'sequential');
                drop.onChange((value: string) => {
                    this.tempButton.executionMode = value as 'sequential' | 'parallel';
                    // 触发UI刷新以禁用/启用相关选项
                    container.empty();
                    this.createActionSettings(container);
                });
            });
        const isParallel = this.tempButton.executionMode === 'parallel';
        // 错误时是否中断
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
        // 动作间延迟
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
        // 用面向对象的 ActionSequence 渲染所有动作
        this.actionSequence.renderAll(actionValueContainer, { app: this.app, plugin: this.plugin });
    }

    /**
     * 创建保存和取消按钮。
     * @param container 容器元素
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

    /** 获取当前临时按钮对象 */
    getCurrentButton(): ButtonConfig {
        return this.tempButton;
    }

    /**
     * 校验并保存按钮，保存成功后关闭模态框。
     */
    async saveButton(): Promise<void> {
        let hasError = false;

        // 验证名称输入
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

        // 验证 OCAP 条件输入（JSON + 结构校验）
        const conditionsResult = this.conditionsInput?.getResult();
        if (conditionsResult && !conditionsResult.ok) {
            new Notice(conditionsResult.error);
            return;
        }

        // 如果有错误，显示通知并返回
        if (hasError || !actionResult.ok) {
            new Notice(t('please_complete_required_fields'));
            return;
        }

        // 保存按钮（ActionSequence 序列化结果转为 ButtonAction[]）
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
