import type { App } from 'obsidian';
import { Setting, TextComponent } from 'obsidian';
import { FileNameInputSuggest } from '@/components/suggest/FileNameInputSuggest';
import type { ButtonsPanelPlugin } from '@/types/plugin';

/**
 * File name input for the settings forms, with date-variable suggestions.
 */
export interface FileNameInputOptions {
    /** Setting name */
    name: string;
    /** Setting description */
    description: string;
    /** Input placeholder */
    placeholder: string;
    /** Tooltip of the search button */
    searchTooltip: string;
    /** Tooltip of the suggestion button */
    suggestTooltip: string;
    /** Called when the file name changes */
    onFileNameChange?: (fileName: string) => void;
    /** Called when Enter is pressed */
    onEnterKey?: () => void;
}

/**
 * Wraps the file name input and its suggestion logic.
 */
export class FileNameInput {
    private input!: TextComponent;
    private setting: Setting;
    private suggest: FileNameInputSuggest | null = null;

    /**
     * Creates the component.
     * @param container Container element
     * @param options Component options
     * @param context Render context (app and plugin)
     * @param onValueChange Called when the value changes
     */
    constructor(
        container: HTMLElement,
        options: FileNameInputOptions,
		context: { app: App; plugin: ButtonsPanelPlugin },
        onValueChange?: (value: string) => void
    ) {
        this.setting = new Setting(container).setName(options.name).setDesc(options.description);

        // Text input.
        this.setting.addText((text) => {
            this.input = text;
            text.setPlaceholder(options.placeholder);
        });

        // Attach the dropdown with the date variable formats.
        this.suggest = new FileNameInputSuggest(context.app, this.input.inputEl);
        this.suggest.onSelect((format, _evt) => {
            const value = `{{DATE:${format}}}`;
            this.input.setValue(value);
            onValueChange?.(value);
            options.onFileNameChange?.(value);
            this.suggest?.close();
        });

        this.input.inputEl.addEventListener('focus', () => {
            this.suggest?.open();
        });

        // Value change callback.
        this.input.onChange((value) => {
            onValueChange?.(value);
            options.onFileNameChange?.(value);
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
