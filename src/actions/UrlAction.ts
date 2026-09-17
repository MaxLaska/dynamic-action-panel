import type { App } from 'obsidian';
import { IButtonAction } from '@/actions/IButtonAction';
import { t } from '@/utils/i18n';
import { UrlInput } from '@/components/input';
import type { ButtonsPanelPlugin } from '@/types/plugin';

type ActionRenderContext = { app: App; plugin: ButtonsPanelPlugin };

/**
 * The open-URL action: form rendering, data handling, validation and serialization.
 */
export class UrlAction implements IButtonAction {
    type = 'url';
    url: string;
    private urlInput: UrlInput | null = null;

    /**
     * Initializes the action parameters.
     */
    constructor(params: { url: string }) {
        this.url = params.url;
    }

    /**
     * Renders the form controls and keeps them in sync with the action data.
     */
    render(container: HTMLElement, context: ActionRenderContext) {
        // Reusable URL input component.
        this.urlInput = new UrlInput(
            container,
            {
                name: t('url'),
                description: t('url_desc'),
                placeholder: t('url_placeholder'),
            },
            context,
            (value: string) => {
                this.url = value;
                // Clear the error as soon as the entered URL is valid.
                if (this.validate()) {
                    this.clearError();
                }
            }
        );

        // Apply the initial value.
        this.urlInput.setValue(this.url || '');
    }

    /**
     * Validates the form data.
     */
    validate() {
        return !!(this.url && this.url.trim());
    }

    /** Single-field action: untouched and invalid are the same state. */
    isEmpty() {
        return !this.validate();
    }

    /**
     * Marks the URL input as invalid.
     */
    setError(message: string): void {
        this.urlInput?.setError(message);
    }

    /**
     * Clears the error state of the URL input.
     */
    clearError(): void {
        this.urlInput?.clearError();
    }

    /**
     * Serializes the action to its JSON shape.
     */
    toJSON() {
        return { type: this.type, parameters: { url: this.url } };
    }
}


