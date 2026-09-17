import { Setting, TextComponent } from 'obsidian';
import { t } from '@/utils/i18n';

/**
 * Name input for the settings forms, with validation, error display, disabling and focus control.
 */
export interface NameInputOptions {
    /** Setting name */
    name?: string;
    /** Setting description */
    description?: string;
    /** Input placeholder */
    placeholder?: string;
    /** Initial value */
    value?: string;
    /** Called when the value changes */
    onValueChange?: (value: string) => void;
    /** Called when Enter is pressed */
    onEnter?: () => void;
    /** Called when validation fails */
    onValidationError?: (error: string) => void;
    /** Whether the error state is shown */
    showError?: boolean;
    /** Error message */
    errorMessage?: string;
    /** Whether the input is disabled */
    disabled?: boolean;
}

/**
 * Wraps the name input together with validation, error display, disabling and focus control.
 */
export class NameInput {
    private container: HTMLElement;
    private setting!: Setting;
    private textComponent!: TextComponent;
    private options: NameInputOptions;
    private inputEl!: HTMLInputElement;

    /**
     * Creates the component.
     * @param container Container element
     * @param options Component options
     */
    constructor(container: HTMLElement, options: NameInputOptions = {}) {
        this.container = container;
        this.options = {
            placeholder: t('button_name_placeholder'),
            value: '',
            ...options,
        };
        this.render();
    }

    /** Renders the input and its surrounding UI */
    private render(): void {
        // Create the Setting instance.
        this.setting = new Setting(this.container);

        // Apply name and description.
        if (this.options.name) {
            this.setting.setName(this.options.name);
        }
        if (this.options.description) {
            this.setting.setDesc(this.options.description);
        }

        // Create the text input.
        this.textComponent = new TextComponent(this.setting.controlEl);
        this.inputEl = this.textComponent.inputEl;

        // Apply the input properties.
        this.textComponent
            .setPlaceholder(this.options.placeholder || '')
            .setValue(this.options.value || '')
            .onChange((value) => {
                this.handleValueChange(value);
            });

        // Enter key listener.
        this.inputEl.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                this.handleEnter();
            }
        });

        // Apply the disabled state.
        if (this.options.disabled) {
            this.textComponent.setDisabled(true);
        }

        // Apply the initial error state.
        this.updateErrorState();
    }

    /** Validates the new value and forwards it to the callback */
    private handleValueChange(value: string): void {
        // Validate the new value.
        const validationError = this.validateInput(value);

        if (validationError) {
            this.setErrorInternal(validationError);
            this.options.onValidationError?.(validationError);
        } else {
            this.clearErrorInternal();
        }

        // Forward it to the caller.
        this.options.onValueChange?.(value);
    }

    /** Handles the Enter key */
    private handleEnter(): void {
        this.options.onEnter?.();
    }

    /** Validates a value and returns an error message, or null when it is valid */
    private validateInput(value: string): string | null {
        if (!value || value.trim() === '') {
            return t('button_name_required');
        }

        if (value.length > 50) {
            return t('button_name_too_long');
        }

        // Reject characters that are invalid in file names.
        const invalidChars = /[<>:"/\\|?*]/;
        if (invalidChars.test(value)) {
            return t('button_name_invalid_chars');
        }

        return null;
    }

    /** Applies the error state to the input element */
    private setErrorInternal(message: string): void {
        this.inputEl.classList.add('input-error');
        this.inputEl.setAttribute('title', message);
    }

    /** Removes the error state from the input element */
    private clearErrorInternal(): void {
        this.inputEl.classList.remove('input-error');
        this.inputEl.removeAttribute('title');
    }

    /** Syncs the error state with the current options */
    private updateErrorState(): void {
        if (this.options.showError && this.options.errorMessage) {
            this.setErrorInternal(this.options.errorMessage);
        } else {
            this.clearErrorInternal();
        }
    }

    // Public API
    /** Returns the input value */
    public getValue(): string {
        return this.textComponent.getValue();
    }

    /** Sets the input value */
    public setValue(value: string): void {
        this.textComponent.setValue(value);
    }

    /** Sets the disabled state */
    public setDisabled(disabled: boolean): void {
        this.textComponent.setDisabled(disabled);
    }

    /** Marks the input as invalid */
    public setError(message: string): void {
        this.options.showError = true;
        this.options.errorMessage = message;
        this.updateErrorState();
    }

    /** Clears the error state */
    public clearError(): void {
        this.options.showError = false;
        this.options.errorMessage = '';
        this.updateErrorState();
    }

    /** Focuses the input */
    public focus(): void {
        this.inputEl.focus();
    }

    /** Removes focus from the input */
    public blur(): void {
        this.inputEl.blur();
    }

    /** Destroys the component and clears its container */
    public destroy(): void {
        this.container.empty();
    }

    // Chainable setters
    /** Sets the setting name */
    public setName(name: string): this {
        this.setting.setName(name);
        return this;
    }

    /** Sets the setting description */
    public setDesc(description: string): this {
        this.setting.setDesc(description);
        return this;
    }
}
