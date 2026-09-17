import type { App } from 'obsidian';
import { Setting, TextComponent } from 'obsidian';
import { FolderInputSuggest } from '@/components/suggest/FolderInputSuggest';
import type { ButtonsPanelPlugin } from '@/types/plugin';

/**
 * Folder picker input for the settings forms.
 */
export interface FolderInputOptions {
    /** Setting name */
    name: string;
    /** Setting description */
    description: string;
    /** Input placeholder */
    placeholder: string;
    /** Tooltip of the search button */
    searchTooltip: string;
}

/**
 * Wraps the folder input and its selection logic.
 */
export class FolderInput {
    private input!: TextComponent;
    private setting: Setting;
    private suggest: FolderInputSuggest | null = null;

    /**
     * Creates the component.
     * @param container Container element
     * @param options Component options
     * @param context Render context (app and plugin)
     * @param onValueChange Called when the value changes
     */
    constructor(
        container: HTMLElement,
        options: FolderInputOptions,
		context: { app: App; plugin: ButtonsPanelPlugin },
        onValueChange?: (value: string) => void
    ) {
        this.setting = new Setting(container).setName(options.name).setDesc(options.description);

        // Text input.
        this.setting.addText((text) => {
            this.input = text;
            text.setPlaceholder(options.placeholder);
        });

        // Attach the folder path dropdown.
        this.suggest = new FolderInputSuggest(context.app, this.input.inputEl);
        this.suggest.onSelect((folderPath, _evt) => {
            this.input.setValue(folderPath);
            onValueChange?.(folderPath);
            this.suggest?.close();
        });

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
