import type { App } from 'obsidian';
import { Setting, TextComponent } from 'obsidian';
import { CommandInputSuggest } from '@/components/suggest/CommandInputSuggest';
import type { ButtonsPanelPlugin } from '@/types/plugin';

/**
 * Command picker input for the settings forms.
 * Provides the text input, the suggestion dropdown and the change callbacks.
 */
export interface CommandInputOptions {
    /** Setting name */
    name: string;
    /** Setting description */
    description: string;
    /** Input placeholder */
    placeholder: string;
    /** Tooltip of the search button */
    searchTooltip: string;
    /** Called when the command changes */
    onCommandChange?: (commandId: string) => void;
    /** Called when Enter is pressed */
    onEnterKey?: () => void;
}

/**
 * Wraps the command input and its selection logic.
 */
export class CommandInput {
    private input!: TextComponent;
    private setting: Setting;
    private suggest: CommandInputSuggest | null = null;

    /**
     * Creates the component.
     * @param container Container element
     * @param options Component options
	 * @param context Render context (app and plugin)
     * @param onValueChange Called when the value changes
     */
    constructor(
        container: HTMLElement,
        options: CommandInputOptions,
		context: { app: App; plugin: ButtonsPanelPlugin },
        onValueChange?: (value: string) => void
    ) {
        this.setting = new Setting(container).setName(options.name).setDesc(options.description);

        // Text input.
        this.setting.addText((text) => {
            this.input = text;
            text.setPlaceholder(options.placeholder);
        });

        // Attach the native Obsidian input suggestion dropdown.
        this.suggest = new CommandInputSuggest(context.app, this.input.inputEl);
        this.suggest.onSelect((cmd, _evt) => {
            const commandId = cmd.id;
            this.input.setValue(commandId);
            onValueChange?.(commandId);
            options.onCommandChange?.(commandId);
            // Close the suggestion popup after a selection.
            this.suggest?.close();
        });

        // Open the dropdown on focus (listing every command) to make the commands discoverable.
        this.input.inputEl.addEventListener('focus', () => {
            this.suggest?.open();
        });

        // Value change callback.
        this.input.onChange((value) => {
            onValueChange?.(value);
            options.onCommandChange?.(value);
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
