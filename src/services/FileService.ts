import { App, Notice, WorkspaceLeaf } from 'obsidian';
import { ButtonsPanelPlugin } from '@/types/plugin';
import { ButtonAction, FileActionParams } from '@/types/action';
import { t } from '@/utils/i18n';

/**
 * Handles the open-file action.
 * Reuses an already open tab for the file and checks that the file exists.
 */
export class FileService {
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
     * Opens the file at the given path.
     * If the file is already open in a tab, that tab is activated; otherwise a new tab is opened.
     * @param action Button action config; must be type: 'file' with its parameters
     */
    async openFile(action: ButtonAction): Promise<void> {
        const filePath = this.validateAndExtractFilePath(action);
        const file = this.getFileByPath(filePath);
        if (!file) {
            return;
        }

        const existingLeaf = this.findOpenLeafForFile(filePath);
        if (existingLeaf) {
            this.activateLeaf(existingLeaf);
            return;
        }

        await this.openFileInNewLeaf(filePath);
    }

    /**
     * Validates the action type and extracts the file path.
     * @param action Button action config
     * @returns The file path
     * @throws When the action type is not 'file'
     */
    private validateAndExtractFilePath(action: ButtonAction): string {
        if (action.type !== 'file') {
            throw new Error('Invalid action type for file opening');
        }
        const fileParams: FileActionParams = action.parameters;
        return fileParams.filePath;
    }

    /**
     * Resolves a path to a file, showing a notice when it does not exist.
     * @param filePath File path
     * @returns The file, or null when it does not exist
     */
    private getFileByPath(filePath: string) {
        const file = this.app.vault.getFileByPath(filePath);
        if (!file) {
            new Notice(t('file_not_found') + `: ${filePath}`);
            return null;
        }
        return file;
    }

    /**
     * Finds a leaf that already has the given file open.
     * @param filePath File path
     * @returns The open leaf, or null when there is none
     */
    private findOpenLeafForFile(filePath: string): WorkspaceLeaf | null {
        const allLeaves = this.getAllLeaves();
        for (const leaf of allLeaves) {
            const view = leaf.view as unknown;
            const fileFromView =
                view && typeof view === 'object'
                    ? (view as { file?: { path?: string } }).file
                    : undefined;
            if (fileFromView?.path === filePath) {
                return leaf;
            }
        }
        return null;
    }

    /**
     * Activates the given leaf.
     * @param leaf The leaf to activate
     */
    private activateLeaf(leaf: WorkspaceLeaf): void {
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
    }

    /**
     * Opens the file in a new tab.
     * @param filePath File path
     */
    private async openFileInNewLeaf(filePath: string): Promise<void> {
        await this.app.workspace.openLinkText(filePath, '', true);
    }

    /**
     * Returns every WorkspaceLeaf.
     * Uses the Obsidian API iterateAllLeaves, which covers the main area, popouts and sidebars.
     */
    private getAllLeaves(): WorkspaceLeaf[] {
        const leaves: WorkspaceLeaf[] = [];
        this.app.workspace.iterateAllLeaves((leaf) => {
            leaves.push(leaf);
        });
        return leaves;
    }
}
