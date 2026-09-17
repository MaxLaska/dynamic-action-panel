import { Setting, TextComponent } from 'obsidian';

/**
 * URL input for the settings forms, with change and Enter callbacks.
 */
export interface UrlInputOptions {
    /** Setting name */
    name: string;
    /** Setting description */
    description: string;
    /** Input placeholder */
    placeholder: string;
    /** Called when the URL changes */
    onUrlChange?: (url: string) => void;
    /** Called when Enter is pressed */
    onEnterKey?: () => void;
}

/**
 * Wraps the URL input and its callbacks.
 */
export class UrlInput {
    private input!: TextComponent;
    private setting: Setting;

    /**
     * Creates the component.
     * @param container Container element
     * @param options Component options
     * @param context Unused; kept so the signature matches the other input components
     * @param onValueChange Called when the value changes
     */
	constructor(
		container: HTMLElement,
		options: UrlInputOptions,
		// context is currently unused; the parameter only keeps the signature aligned with the other inputs.
		context: unknown,
		onValueChange?: (value: string) => void
	) {
        this.setting = new Setting(container).setName(options.name).setDesc(options.description);

        // Text input.
        this.setting.addText((text) => {
            this.input = text;
            text.setPlaceholder(options.placeholder || 'https://example.com');
        });

        // Value change callback.
        this.input.onChange((value) => {
            onValueChange?.(value);
            options.onUrlChange?.(value);
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
