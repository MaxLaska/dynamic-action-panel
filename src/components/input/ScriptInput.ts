import type { App, TFile } from 'obsidian';
import { Setting, TextComponent } from 'obsidian';
import {
    FileInputSuggest,
    type SuggestionMeta,
} from '@/components/suggest/FileInputSuggest';
import type { ButtonsPanelPlugin } from '@/types/plugin';

/**
 * Script file picker for the settings forms, restricted to .js files.
 */
export interface ScriptInputOptions {
    /** Setting name */
    name: string;
    /** Setting description */
    description: string;
    /** Input placeholder */
    placeholder: string;
    /** Tooltip of the search button */
    searchTooltip: string;
    /** Restrict suggestions to this root folder */
    rootFolder?: string;
    /** Called when the script changes */
    onScriptChange?: (scriptName: string) => void;
    /** Called when Enter is pressed */
    onEnterKey?: () => void;
    /** Resolves suggestion metadata, used to show a script's localized name and description */
    getMeta?: (file: TFile) => SuggestionMeta | null | Promise<SuggestionMeta | null>;
}

/**
 * Wraps the script file input and its selection logic.
 */
export class ScriptInput {
    private input!: TextComponent;
    private setting: Setting;
    private suggest: FileInputSuggest | null = null;

    /**
     * Creates the component.
     * @param container Container element
     * @param options Component options
     * @param context Render context (app and plugin)
     * @param onValueChange Called when the value changes
     */
    constructor(
        container: HTMLElement,
        options: ScriptInputOptions,
		context: { app: App; plugin: ButtonsPanelPlugin },
        onValueChange?: (value: string) => void
    ) {
        this.setting = new Setting(container).setName(options.name).setDesc(options.description);

        // Text input.
        this.setting.addText((text) => {
            this.input = text;
            text.setPlaceholder(options.placeholder);
        });

        // Attach the script file dropdown (.js only; rows show the localized name and description).
        this.suggest = new FileInputSuggest(context.app, this.input.inputEl, {
            rootFolder: options.rootFolder || '',
            fileExts: ['js'],
            showFileNameOnly: true,
            getMeta: options.getMeta,
        });
        this.suggest.onSelect((file: TFile, _evt) => {
            const fileName = file.name;
            if (!fileName.endsWith('.js')) return;
            this.input.setValue(fileName);
            onValueChange?.(fileName);
            options.onScriptChange?.(fileName);
            this.suggest?.close();
        });

        this.input.inputEl.addEventListener('focus', () => {
            this.suggest?.open();
        });

        // Value change callback.
        this.input.onChange((value) => {
            onValueChange?.(value);
            options.onScriptChange?.(value);
        });

        // Enter key listener.
        if (options.onEnterKey) {
            this.input.inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && options.onEnterKey) {
                    options.onEnterKey();
                }
            });
        }
    }

    /** Sets the input value */
    setValue(value: string) {
        this.input.setValue(value);
    }

    /** Returns the input value */
    getValue(): string {
        return this.input.getValue();
    }

    /** Returns the underlying input element */
    getInputElement(): HTMLInputElement {
        return this.input.inputEl;
    }

    /** Marks the input as invalid */
    setError(message: string): void {
        this.input.inputEl.classList.add('input-error');
        this.input.inputEl.setAttribute('title', message);
    }

    /** Clears the error state */
    clearError(): void {
        this.input.inputEl.classList.remove('input-error');
        this.input.inputEl.removeAttribute('title');
    }
}
