import type { App, TFile } from 'obsidian';
import { Setting, TextComponent } from 'obsidian';
import { FileInputSuggest } from '@/components/suggest/FileInputSuggest';
import type { ButtonsPanelPlugin } from '@/types/plugin';

/**
 * File picker input for the settings forms.
 * Can show either the bare file name or the full path.
 */
export interface FileInputOptions {
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
    /** Allowed file extensions */
    fileExts?: string[];
    /** Show only the file name instead of the full path */
    showFileNameOnly?: boolean;
}

/**
 * Wraps the file input and its selection logic.
 */
export class FileInput {
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
        options: FileInputOptions,
		context: { app: App; plugin: ButtonsPanelPlugin },
        onValueChange?: (value: string) => void
    ) {
        this.setting = new Setting(container).setName(options.name).setDesc(options.description);

        // Text input.
        this.setting.addText((text) => {
            this.input = text;
            text.setPlaceholder(options.placeholder);
        });

        // Attach the AbstractInputSuggest-based file dropdown.
        this.suggest = new FileInputSuggest(context.app, this.input.inputEl, {
            rootFolder: options.rootFolder || '',
            fileExts: options.fileExts || ['md'],
            showFileNameOnly: options.showFileNameOnly,
        });
        this.suggest.onSelect((file: TFile, _evt) => {
            const valueToSet = options.showFileNameOnly ? file.name : file.path;
            this.input.setValue(valueToSet);
            onValueChange?.(valueToSet);
            this.suggest?.close();
        });

        // Open the dropdown on focus so a file can be picked right away.
        this.input.inputEl.addEventListener('focus', () => {
            this.suggest?.open();
        });

        // Value change callback.
        this.input.onChange((value) => {
            onValueChange?.(value);
        });
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
