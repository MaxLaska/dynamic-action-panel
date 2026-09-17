import type { App } from 'obsidian';
import { IButtonAction } from '@/actions/IButtonAction';
import { t } from '@/utils/i18n';
import { FileInput, FolderInput, FileNameInput } from '@/components/input';
import type { ButtonsPanelPlugin } from '@/types/plugin';

type ActionRenderContext = { app: App; plugin: ButtonsPanelPlugin };

/**
 * The create-file action: form rendering, data handling, validation and serialization.
 */
export class CreateFileAction implements IButtonAction {
    type = 'create_file';
    folderPath: string = '';
    fileName: string = '';
    templateName: string = '';
    private fileNameInput: FileNameInput | null = null;
    private folderInput: FolderInput | null = null;

    /**
     * Initializes the action parameters.
     */
    constructor(params: { folderPath?: string; fileName?: string; templateName?: string }) {
        this.folderPath = params.folderPath || '';
        this.fileName = params.fileName || '';
        this.templateName = params.templateName || '';
    }

    /**
     * Renders the form controls and keeps them in sync with the action data.
     */
    render(container: HTMLElement, context: ActionRenderContext) {
        // Reusable folder input component.
        this.folderInput = new FolderInput(
            container,
            {
                name: t('folder'),
                description: t('folder_placeholder'),
                placeholder: t('folder_placeholder'),
                searchTooltip: t('search_folders_tooltip'),
            },
            { app: context.app, plugin: context.plugin },
            (value: string) => {
                this.folderPath = value;
                // Clear the error of this field as soon as it is non-empty.
                if (this.folderPath && this.folderPath.trim()) {
                    this.folderInput?.clearError();
                }
                // Clear the action-level error once both required fields are valid.
                if (this.validate()) {
                    this.clearError();
                }
            }
        );

        // Reusable file name input component.
        this.fileNameInput = new FileNameInput(
            container,
            {
                name: t('file_name'),
                description: t('file_name_desc'),
                placeholder: t('file_name_placeholder'),
                searchTooltip: t('search'),
                suggestTooltip: t('search_date_variables_tooltip'),
                onFileNameChange: (fileName: string) => {
                    this.fileName = fileName;
                },
            },
            { app: context.app, plugin: context.plugin },
            (value: string) => {
                this.fileName = value;
                // Clear the error of this field as soon as it is non-empty.
                if (this.fileName && this.fileName.trim()) {
                    this.fileNameInput?.clearError();
                }
                // Clear the action-level error once both required fields are valid.
                if (this.validate()) {
                    this.clearError();
                }
            }
        );

        // Reusable file input component, used here to pick the template.
        const templateInput = new FileInput(
            container,
            {
                name: t('template_file'),
                description: t('template_file_desc'),
                placeholder: t('template_file_placeholder'),
                searchTooltip: t('search_files_tooltip'),
                rootFolder: context.plugin?.settings?.pathConfig?.templateFolderPath || '',
                fileExts: ['md'],
                showFileNameOnly: true,
            },
            { app: context.app, plugin: context.plugin },
            (value: string) => {
                this.templateName = value;
            }
        );

        // Apply the initial values.
        this.folderInput.setValue(this.folderPath || '');
        this.fileNameInput.setValue(this.fileName || '');
        templateInput.setValue(this.templateName || '');
    }

    /**
     * Validates the form data.
     */
    validate() {
        // Both the folder path and the file name are required.
        return !!(
            this.folderPath &&
            this.folderPath.trim() &&
            this.fileName &&
            this.fileName.trim()
        );
    }

    /**
     * Untouched only when NONE of the three fields carries anything. A row
     * with a folder but no file name is half-filled, not unconfigured: it must
     * keep blocking the save rather than being dropped silently.
     */
    isEmpty() {
        return !(
            this.folderPath.trim() ||
            this.fileName.trim() ||
            this.templateName.trim()
        );
    }

    setError(message: string): void {
        // Mark every required field that is still empty.
        if (!this.folderPath || !this.folderPath.trim()) {
            this.folderInput?.setError(message);
        }
        if (!this.fileName || !this.fileName.trim()) {
            this.fileNameInput?.setError(message);
        }
    }

    clearError(): void {
        // Clear the error state of every input.
        this.fileNameInput?.clearError();
        this.folderInput?.clearError();
    }

    /**
     * Returns the full path of the file that would be created.
     */
    getFullPath(): string {
        if (!this.fileName) return '';
        if (!this.folderPath) return this.fileName;
        return `${this.folderPath}/${this.fileName}`;
    }

    /**
     * Serializes the action to its JSON shape.
     */
    toJSON() {
        return {
            type: this.type,
            parameters: {
                folderPath: this.folderPath,
                fileName: this.fileName,
                templateName: this.templateName,
            },
        };
    }
}


