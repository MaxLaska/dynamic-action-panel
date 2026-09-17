import { App, Notice } from 'obsidian';
import { ButtonsPanelPlugin } from '@/types/plugin';
import { t } from '@/utils/i18n';
import { ButtonAction, CommandActionParams } from '@/types/action';
import { getSafeLastContentLeaf } from '@/utils/obsidian';

/**
 * Handles the run-command action.
 * It calls the Obsidian command system with the command id from the button config.
 */
export class CommandService {
    /**
     * Initializes the service with the app and plugin instance.
     * @param app Obsidian app instance
     * @param plugin Plugin instance (optional)
     */
    constructor(
        private app: App,
        private plugin?: ButtonsPanelPlugin
    ) {}

    /**
     * Runs an Obsidian command.
     * @param action Button action config; must be type: 'command' with its parameters
     */
    async executeCommand(action: ButtonAction): Promise<void> {
        try {
            // Type guard: this must be a command action.
            if (action.type !== 'command') {
                throw new Error('Invalid action type for command execution');
            }
            // In the ButtonAction union, parameters is already CommandActionParams when type === 'command'.
            const commandParams: CommandActionParams = action.parameters;

            // Focus the last active content leaf (never the buttons panel) before running.
            const lastContentLeaf = getSafeLastContentLeaf(this.app, this.plugin);
            if (lastContentLeaf) {
                this.app.workspace.setActiveLeaf(lastContentLeaf, { focus: true });
            }

            // Run the command.
            const commandsApi = this.getCommandsApi();
            if (
                commandsApi &&
                typeof commandsApi.executeCommandById === 'function'
            ) {
                // Call it on the object so `this` stays bound correctly.
                commandsApi.executeCommandById(commandParams.commandId);
            } else {
                throw new Error('commands.executeCommandById is not available');
            }
        } catch (error) {
            console.error('Error while running the command:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            // Show the commandId for command actions, a generic error otherwise.
            const commandId =
                action.type === 'command' ? action.parameters.commandId : 'unknown';
            new Notice(
                t('command_execution_failed') +
                    `: ${commandId} - ${errorMessage}`
            );
        }
    }

    /**
     * Returns the Obsidian commands API.
     * Note: executeCommandById must not be destructured and called on its own, because it
     * would lose its `this` binding and fail inside Obsidian with errors such as
     * "Cannot read properties of undefined (reading 'findCommand')".
     * @returns The commands API, or undefined when it is unavailable
     */
    private getCommandsApi(): { executeCommandById?: (id: string) => boolean | void } | undefined {
        return (this.app as unknown as {
            commands?: { executeCommandById?: (id: string) => boolean | void };
        }).commands;
    }
}
