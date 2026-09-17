import type { App } from 'obsidian';
import { IButtonAction } from '@/actions/IButtonAction';
import { t } from '@/utils/i18n';
import { FileInput } from '@/components/input';
import type { ButtonsPanelPlugin } from '@/types/plugin';

type ActionRenderContext = { app: App; plugin: ButtonsPanelPlugin };

/**
 * The open-file action: form rendering, data handling, validation and serialization.
 */
export class FileAction implements IButtonAction {
    type = 'file';
    filePath: string;
    private fileInput: FileInput | null = null;

    /**
     * Initializes the action parameters.
     */
    constructor(params: { filePath: string }) {
        this.filePath = params.filePath;
    }

    /**
     * Renders the form controls and keeps them in sync with the action data.
     */
    render(container: HTMLElement, context: ActionRenderContext) {
        // Reusable file input component.
        this.fileInput = new FileInput(
            container,
            {
                name: t('file'),
                description: t('file_desc'),
                placeholder: t('file_path_placeholder'),
                searchTooltip: t('search_files_tooltip'),
                rootFolder: '',
                fileExts: [],
                showFileNameOnly: false,
            },
            { app: context.app, plugin: context.plugin },
            (value: string) => {
                this.filePath = value;
                // Clear the error as soon as a valid path is typed or picked.
                if (this.validate()) {
                    this.clearError();
                }
            }
        );

        // Apply the initial value.
        this.fileInput.setValue(this.filePath || '');
    }

    /**
     * Validates the form data.
     */
    validate() {
        return !!(this.filePath && this.filePath.trim());
    }

    /** Single-field action: untouched and invalid are the same state. */
    isEmpty() {
        return !this.validate();
    }

    setError(message: string): void {
        this.fileInput?.setError(message);
    }

    clearError(): void {
        this.fileInput?.clearError();
    }

    /**
     * Serializes the action to its JSON shape.
     */
    toJSON() {
        return { type: this.type, parameters: { filePath: this.filePath } };
    }
}


