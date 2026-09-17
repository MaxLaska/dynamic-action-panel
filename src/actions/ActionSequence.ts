import type { App } from 'obsidian';
import { Setting, ButtonComponent } from 'obsidian';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import { IButtonAction } from '@/actions/IButtonAction';
import { ButtonActionFactory } from '@/actions/ButtonActionFactory';
import { t } from '@/utils/i18n';

type ActionRenderContext = { app: App; plugin: ButtonsPanelPlugin };

/**
 * Manages the action list of one button: adding, removing, reordering,
 * rendering the form, validating it and serializing it back to JSON.
 * Used by the add/edit button modals.
 */
export class ActionSequence {
    actions: IButtonAction[] = [];
    private container: HTMLElement | null = null;
    private context: ActionRenderContext | null = null;

    /**
     * Turns raw persisted action data into action instances.
     * @param rawActions Raw action configuration array
     */
    constructor(rawActions: Array<{ type: string; parameters?: unknown }>) {
        this.actions = rawActions.map((raw) => ButtonActionFactory.fromRaw(raw));
    }

    /**
     * Appends an action to the sequence and renders it.
     * @param action The action instance to add
     */
    addAction(action: IButtonAction) {
        this.actions.push(action);
        // When the container already exists, render only the newly added action.
        if (this.container && this.context) {
            // Locate the action list container (excluding the heading and buttons).
            const actionsContainer =
                (this.container.querySelector('.actions-list-container') as HTMLElement) ||
                this.container;
            this.renderActionItem(actionsContainer, action, this.actions.length - 1, this.context);
        }
    }

    /**
     * Removes the action at the given index and re-renders.
     * @param idx Index of the action to remove
     */
    removeAction(idx: number) {
        this.actions.splice(idx, 1);
        // Re-render so the remaining indices stay correct.
        if (this.container && this.context) {
            this.renderAll(this.container, this.context);
        }
    }

    /**
     * Renders the form for the whole action sequence.
     * @param container Container element
     * @param context Render context (app and plugin instance)
     */
    renderAll(container: HTMLElement, context: ActionRenderContext) {
        // Keep the container and context for later partial re-renders.
        this.container = container;
        this.context = context;

        // Clear the container.
        container.empty();

        // Action list heading.
        container.createEl('h4', { text: t('actions_list') });

        // Action list container.
        const actionsContainer = container.createDiv('actions-list-container');

        // Render every action.
        this.actions.forEach((action, index) => {
            this.renderActionItem(actionsContainer, action, index, context);
        });

        // Add-action button.
        const addActionCard = container.createDiv('add-action');
        new ButtonComponent(addActionCard)
            .setIcon('plus')
            .setTooltip(t('add_action'))
            .setClass('add-action-btn')
            .onClick(() => {
                this.addDefaultAction();
            });
    }

    /**
     * Renders one action row: type dropdown, action content, move up/down and remove.
     */
    private renderActionItem(
        container: HTMLElement,
        action: IButtonAction,
        index: number,
        context: ActionRenderContext
    ) {
        const actionEl = container.createDiv('action-item');

        // Action type dropdown.
        new Setting(actionEl)
            .setName(`${t('action')} ${index + 1}`)
            .setDesc(t('action_type_desc'))
            .addDropdown((dropdown) => {
                // Current type of the action instance.
                const currentType = action.type;

                // All action types known to ButtonActionFactory.
                const availableTypes = ButtonActionFactory.getAvailableActionTypes();

                // Add an option per available action type.
                availableTypes.forEach((type) => {
                    dropdown.addOption(type, t(type));
                });

                dropdown.setValue(currentType).onChange((value) => {
                    // Reject unknown action types.
                    if (!ButtonActionFactory.isValidActionType(value)) {
                        console.error('Invalid action type:', value);
                        return;
                    }
                    // Replace the current action with a fresh instance of the chosen type
                    // and re-render only the action content.
                    const newAction = ButtonActionFactory.createAction(value, {});
                    this.actions[index] = newAction;
                    this.renderActionContent(actionEl, newAction, context);
                });
            });

        // Render the action-specific content.
        this.renderActionContent(actionEl, action, context);

        // Footer: all row buttons share one Setting.
        const footer = actionEl.createDiv('action-footer setting-item');
        const btnSetting = new Setting(footer).setClass('action-btn-setting');
        if (this.actions.length > 1) {
            if (index > 0) {
                btnSetting.addButton((btn) => {
                    btn.setIcon('arrow-up')
                        .setTooltip(t('move_up'))
                        .setClass('action-move-btn')
                        .onClick(() => this.moveAction(index, 'up'));
                });
            }
            if (index < this.actions.length - 1) {
                btnSetting.addButton((btn) => {
                    btn.setIcon('arrow-down')
                        .setTooltip(t('move_down'))
                        .setClass('action-move-btn')
                        .onClick(() => this.moveAction(index, 'down'));
                });
            }
        }
        btnSetting.addButton((btn) => {
            btn.setIcon('trash-2')
                .setTooltip(t('remove_action'))
                .setClass('action-delete-btn')
                .onClick(() => this.removeAction(index));
        });
    }

    /**
     * Renders the action-specific part of the form.
     */
    private renderActionContent(
        actionEl: HTMLElement,
        action: IButtonAction,
        context: ActionRenderContext
    ) {
        // Remove only .action-content so the footer buttons survive.
        const existingContent = actionEl.querySelector('.action-content');
        if (existingContent) {
            existingContent.remove();
        }
        // The footer always exists, so insert the content right before it.
        const footer = actionEl.querySelector('.action-footer');
        const actionContentEl = actionEl.createDiv({ cls: 'action-content' });
        actionEl.insertBefore(actionContentEl, footer);
        action.render(actionContentEl, context);
    }

    /**
     * Moves an action one position up or down.
     */
    private moveAction(index: number, direction: 'up' | 'down') {
        if (direction === 'up' && index > 0) {
            [this.actions[index], this.actions[index - 1]] = [
                this.actions[index - 1]!,
                this.actions[index]!,
            ];
        } else if (direction === 'down' && index < this.actions.length - 1) {
            [this.actions[index], this.actions[index + 1]] = [
                this.actions[index + 1]!,
                this.actions[index]!,
            ];
        }
        // Re-render so the new order is reflected.
        if (this.container && this.context) {
            this.renderAll(this.container, this.context);
        }
    }

    /**
     * Appends a default open-file action.
     */
    public addDefaultAction() {
        // A new button starts with an empty open-file action.
        const defaultAction = ButtonActionFactory.createAction('file', { filePath: '' });
        this.addAction(defaultAction);
    }

    /** An action row the user never filled in. */
    private static isUnconfigured(action: IButtonAction): boolean {
        return action.isEmpty ? action.isEmpty() : !action.validate();
    }

    /**
     * The actions to persist, or a failure that has already marked the
     * offending rows.
     *
     * Untouched rows are DROPPED instead of blocking the save: OCAP does not
     * prescribe the order in which a tool is configured, so a name, an icon
     * and a slot are enough — the action may follow later (a tool without one
     * reports that when it is run). A row that carries content but does not
     * validate still blocks, because dropping it would silently discard what
     * the user typed.
     *
     * The create modal starts with one empty default row, so "no action" is
     * simply what that row collapses to.
     */
    collectConfiguredActions():
        | { ok: true; actions: unknown[] }
        | { ok: false } {
        const configured = this.actions.filter(
            (action) => !ActionSequence.isUnconfigured(action)
        );
        const invalid = configured.filter((action) => !action.validate());
        if (invalid.length > 0) {
            invalid.forEach((action) =>
                action.setError?.(t('please_complete_required_fields'))
            );
            return { ok: false };
        }
        this.clearAllErrors();
        return { ok: true, actions: configured.map((action) => action.toJSON()) };
    }

    /**
     * Clears the error state of every action.
     */
    clearAllErrors(): void {
        this.actions.forEach((action) => {
            action.clearError?.();
        });
    }

    /**
     * Serializes the sequence to the JSON shape stored in the settings.
     */
    toJSON() {
        return this.actions.map((a) => a.toJSON());
    }
}


