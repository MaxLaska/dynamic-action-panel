import { App, Notice, normalizePath, moment } from 'obsidian';

type SafeMoment = () => { format(fmt: string): string };
import { ButtonsPanelPlugin } from '@/types/plugin';
import { t } from '@/utils/i18n';
import { FileService } from '@/services/FileService';
import { ButtonAction, CreateFileActionParams } from '@/types/action';

/**
 * Handles the create-file action.
 * Supports date variables, template content and opening the new file.
 */
export class CreateFileService {
    /**
     * Initializes the service with the app and plugin instance.
     * @param app Obsidian app instance
     * @param plugin Plugin instance (optional)
     */
    constructor(
        private app: App,
        private plugin?: ButtonsPanelPlugin
    ) {}

    /**
     * Creates a new file (optionally from a template) and opens it.
     * @param action Button action config; must be type: 'create_file' with its parameters
     */
    async createFile(action: ButtonAction): Promise<void> {
        // Type guard: this must be a create-file action.
        if (action.type !== 'create_file') {
            throw new Error('Invalid action type for file creation');
        }

        // In the ButtonAction union, parameters is already CreateFileActionParams when type === 'create_file'.
        const createParams: CreateFileActionParams = action.parameters;

        if (!createParams.fileName) {
            new Notice(t('file_name_empty'));
            return;
        }

        try {
            // Build the target file path.
            const filePath = this.buildTargetFilePath(createParams);

            // If the file already exists, just open it.
            const existingFile = this.app.vault.getFileByPath(filePath);
            if (existingFile) {
                await this.ensureFileCreatedAndOpened(filePath);
                return;
            }

            // Read the template content, if a template was selected.
            const fileContent = await this.readTemplateContent(createParams.templateName);

            // Create the new file and open it.
            await this.ensureFileCreatedAndOpened(filePath, fileContent);
        } catch (error) {
            console.error('Error while creating the file:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            new Notice(t('file_creation_failed') + `: ${errorMessage}`);
        }
    }

    /**
     * Builds the target file path, resolving date variables.
     * @param params Create-file parameters
     * @returns The normalized file path
     */
    private buildTargetFilePath(params: CreateFileActionParams): string {
        // Resolve date variables in the file name.
        let fileName = this.resolveDateVariables(params.fileName);
        if (!fileName.endsWith('.md')) fileName = fileName + '.md';

        let filePath = fileName;
        if (params.folderPath) {
            const folderPath = this.resolveDateVariables(params.folderPath);
            filePath = `${folderPath}/${fileName}`;
        }

        // Normalize the assembled path.
        return normalizePath(filePath);
    }

    /**
     * Reads the content of a template file.
     * @param templateName Template file name (optional)
     * @returns The template content, or an empty string when there is no usable template
     */
    private async readTemplateContent(templateName?: string): Promise<string> {
        if (!templateName) {
            return '';
        }

        let templateFolder = this.plugin?.settings?.pathConfig?.templateFolderPath ?? '';
        // Normalize the template folder path.
        templateFolder = normalizePath(templateFolder);
        let templatePath = templateFolder ? `${templateFolder}/${templateName}` : templateName;
        templatePath = normalizePath(templatePath);

        const templateFile = this.app.vault.getFileByPath(templatePath);
        if (templateFile) {
            return await this.app.vault.read(templateFile);
        } else {
            new Notice(t('template_file_not_found') + `: ${templatePath}`);
            return '';
        }
    }

    /**
     * Ensures the file exists and opens it.
     * @param filePath File path
     * @param fileContent File content (optional; ignored when the file already exists)
     */
    private async ensureFileCreatedAndOpened(
        filePath: string,
        fileContent: string = ''
    ): Promise<void> {
        const existingFile = this.app.vault.getFileByPath(filePath);
        const openFileService = new FileService(this.app, this.plugin);

        if (!existingFile) {
            // The file does not exist yet, so create it.
            await this.app.vault.create(filePath, fileContent);
        }

        // Open the file.
        await openFileService.openFile({
            type: 'file',
            parameters: { filePath: filePath },
        });
    }

    /**
     * Resolves date variables in a path, such as {{DATE:YYYY-MM-DD}}.
     * @param filePath Raw path
     * @returns The path with all date variables substituted
     */
    private resolveDateVariables(filePath: string): string {
        return filePath.replace(/{{DATE:(.*?)}}/g, (_match: string, format: string): string => {
            return (moment as unknown as SafeMoment)().format(format);
        });
    }
}
