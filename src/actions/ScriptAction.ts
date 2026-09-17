import type { App, TFile } from 'obsidian';
import { IButtonAction } from '@/actions/IButtonAction';
import { t } from '@/utils/i18n';
import { ScriptInput } from '@/components/input';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import type { ActionDispatcher } from '@/services/ActionDispatcher';
import type { SuggestionMeta } from '@/components/suggest/FileInputSuggest';

type ActionRenderContext = { app: App; plugin: ButtonsPanelPlugin };

/**
 * The run-script action: form rendering, data handling, validation and serialization.
 */
export class ScriptAction implements IButtonAction {
    type = 'script';
    scriptName: string;
    private scriptInput: ScriptInput | null = null;

    /**
     * Initializes the action parameters.
     */
    constructor(params: { scriptName: string }) {
        this.scriptName = params.scriptName;
    }

    /**
     * Renders the form controls and keeps them in sync with the action data.
     */
    render(container: HTMLElement, context: ActionRenderContext) {
        // Metadata resolver so suggestion rows can show the localized name and description.
        const getMeta = context.plugin
            ? this.createScriptMetaGetter(context.plugin)
            : undefined;

        // Reusable script input component.
        this.scriptInput = new ScriptInput(
            container,
            {
                name: t('script_file'),
                description: t('script_file_desc'),
                placeholder: t('script_file_placeholder'),
                searchTooltip: t('search_files_tooltip'),
                rootFolder: context.plugin?.settings?.pathConfig?.scriptFolderPath || '',
                getMeta,
            },
            { app: context.app, plugin: context.plugin },
            (value: string) => {
                this.scriptName = value;
                // Clear the error as soon as a valid script file is typed or picked.
                if (this.validate()) {
                    this.clearError();
                }
            }
        );

        // Apply the initial value.
        this.scriptInput.setValue(this.scriptName || '');
    }

    /**
     * Builds the script metadata resolver: it reads name and description through the
     * ScriptService of the ActionDispatcher and resolves them for the current language.
     */
    private createScriptMetaGetter(
        plugin: ButtonsPanelPlugin
    ): (file: TFile) => Promise<SuggestionMeta | null> {
        const dispatcher = plugin.actionDispatcher as ActionDispatcher | undefined;
        const scriptService = dispatcher?.scriptService;
        if (!scriptService) return async () => null;
        return async (file: TFile): Promise<SuggestionMeta | null> => {
            const meta = await scriptService.getScriptMeta(file);
            if (!meta) return null;
            return {
                name: scriptService.resolveLocalizedText(meta.name, file.basename),
                description: scriptService.resolveLocalizedText(meta.description, ''),
            };
        };
    }

    /**
     * Validates the form data.
     */
    validate() {
        return !!(this.scriptName && this.scriptName.trim());
    }

    /** Single-field action: untouched and invalid are the same state. */
    isEmpty() {
        return !this.validate();
    }

    setError(message: string): void {
        this.scriptInput?.setError(message);
    }

    clearError(): void {
        this.scriptInput?.clearError();
    }

    /**
     * Serializes the action to its JSON shape.
     */
    toJSON() {
        return {
            type: this.type,
            parameters: {
                scriptName: this.scriptName,
            },
        };
    }
}


