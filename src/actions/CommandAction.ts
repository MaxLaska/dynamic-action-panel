import type { App } from 'obsidian';
import { IButtonAction } from '@/actions/IButtonAction';
import { t } from '@/utils/i18n';
import { CommandInput } from '@/components/input';
import type { ButtonsPanelPlugin } from '@/types/plugin';

type ActionRenderContext = { app: App; plugin: ButtonsPanelPlugin };

/**
 * The run-command action: form rendering, data handling, validation and serialization.
 */
export class CommandAction implements IButtonAction {
    type = 'command';
    commandId: string;
    args?: unknown[];
    private commandInput: CommandInput | null = null;

    /**
     * Initializes the command parameters.
     */
    constructor(params: { commandId: string; args?: unknown[] }) {
        this.commandId = params.commandId;
        this.args = params.args;
    }

    /**
     * Renders the form controls and keeps them in sync with the action data.
     */
    render(container: HTMLElement, context: ActionRenderContext) {
        // Reusable command input component.
        this.commandInput = new CommandInput(
            container,
            {
                name: t('command'),
                description: t('command_desc'),
                placeholder: t('command_id_placeholder'),
                searchTooltip: t('search_commands_tooltip'),
            },
            { app: context.app, plugin: context.plugin },
            (value: string) => {
                this.commandId = value;
                // Clear the error as soon as a valid command id is typed or picked.
                if (this.validate()) {
                    this.clearError();
                }
            }
        );

        // Apply the initial value.
        this.commandInput.setValue(this.commandId || '');
    }

    /**
     * Validates the form data.
     */
    validate() {
        return !!(this.commandId && this.commandId.trim());
    }

    /** Single-field action: untouched and invalid are the same state. */
    isEmpty() {
        return !this.validate();
    }

    setError(message: string): void {
        this.commandInput?.setError(message);
    }

    clearError(): void {
        this.commandInput?.clearError();
    }

    /**
     * Serializes the action to its JSON shape.
     */
    toJSON() {
        return {
            type: this.type,
            parameters: {
                commandId: this.commandId,
                args: this.args,
            },
        };
    }
}


