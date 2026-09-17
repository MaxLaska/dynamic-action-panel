import { App, Notice } from 'obsidian';
import { ButtonAction } from '@/types';
import { ButtonsPanelPlugin } from '@/types/plugin';
import { t } from '@/utils/i18n';
import { FileService } from '@/services/FileService';
import { CreateFileService } from '@/services/CreateFileService';
import { CommandService } from '@/services/CommandService';
import { UrlService } from '@/services/UrlService';
import { ScriptService } from '@/services/ScriptService';

/**
 * Dispatches and runs every kind of button action.
 * The concrete work is delegated to the service layer, which keeps the form config
 * separate from execution.
 * Supports sequential and parallel execution, stop-on-error and inter-action delays.
 */
export class ActionDispatcher {
    private fileService: FileService;
    private createFileService: CreateFileService;
    private commandService: CommandService;
    private urlService: UrlService;
    /** Script action service; the form layer (e.g. ScriptAction) reads script metadata through it. */
    scriptService: ScriptService;

    /**
     * Initializes the individual services.
     * @param app Obsidian app instance
     * @param plugin Plugin instance
     */
    constructor(
        private app: App,
        private plugin?: ButtonsPanelPlugin
    ) {
        this.fileService = new FileService(app, plugin);
        this.createFileService = new CreateFileService(app, plugin);
        this.commandService = new CommandService(app, plugin);
        this.urlService = new UrlService(app, plugin);
        this.scriptService = new ScriptService(app, plugin);
    }

    /**
     * Runs a list of button actions, sequentially or in parallel.
     * @param actions Button actions to run
     * @param executionMode 'sequential' or 'parallel'
     * @param stopOnError Whether to abort on the first error (sequential mode only)
     * @param delayBetweenActions Delay between actions in milliseconds (sequential mode only)
     */
    async executeActions(
        actions: ButtonAction[],
        executionMode: 'sequential' | 'parallel' = 'sequential',
        stopOnError: boolean = true,
        delayBetweenActions: number = 100
    ): Promise<void> {
        if (!actions || actions.length === 0) {
            new Notice(t('no_actions_in_sequence'));
            return;
        }

        if (executionMode === 'parallel') {
            await this.executeParallel(actions);
        } else {
            await this.executeSequential(actions, stopOnError, delayBetweenActions);
        }
    }

    /**
     * Runs all actions in parallel.
     * @param actions Button actions to run
     */
    private async executeParallel(actions: ButtonAction[]): Promise<void> {
        const promises = actions.map((action) => this.executeSingleAction(action));
        await Promise.all(promises);
    }

    /**
     * Runs the actions one after another, honouring the delay and the error policy.
     * @param actions Button actions to run
     * @param stopOnError Whether to abort on the first error
     * @param delayBetweenActions Delay between actions in milliseconds
     */
    private async executeSequential(
        actions: ButtonAction[],
        stopOnError: boolean,
        delayBetweenActions: number
    ): Promise<void> {
        for (let i = 0; i < actions.length; i++) {
            try {
                await this.executeSingleAction(actions[i]!);
                // Delay between actions (not needed after the last one).
                if (i < actions.length - 1 && delayBetweenActions > 0) {
                    await new Promise((resolve) => window.setTimeout(resolve, delayBetweenActions));
                }
            } catch (error) {
                this.handleActionError(error, i, stopOnError);
                if (stopOnError) {
                    break;
                }
            }
        }
    }

    /**
     * Handles an error raised by a single action.
     * @param error The error
     * @param index Zero-based index of the failing action
     * @param stopOnError Whether execution is aborted
     */
    private handleActionError(error: unknown, index: number, stopOnError: boolean): void {
        console.error(`Error in action ${index + 1} of the action sequence:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (stopOnError) {
            new Notice(t('sequence_stopped_on_error') + `: ${errorMessage}`);
        } else {
            new Notice(t('action_in_sequence_failed') + `: ${errorMessage}`);
        }
    }

    /**
     * Runs a single button action by dispatching it to the matching service.
     * @param action The button action
     */
    private async executeSingleAction(action: ButtonAction): Promise<void> {
        switch (action.type) {
            case 'file':
                await this.fileService.openFile(action);
                break;
            case 'command':
                await this.commandService.executeCommand(action);
                break;
            case 'url':
                await this.urlService.openUrl(action);
                break;
            case 'create_file':
                await this.createFileService.createFile(action);
                break;
            case 'script':
                await this.scriptService.runScript(action);
                break;
            default:
                // Unreachable unless an action type is not registered here.
                return;
        }
    }
}


