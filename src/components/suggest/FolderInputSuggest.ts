/**
 * FolderInputSuggest - folder input suggestions
 * Stylesheet: FolderInputSuggest.css
 */
import type { App } from 'obsidian';
import { AbstractInputSuggest, TFolder } from 'obsidian';

/**
 * Dropdown suggestions for the folder path input, built on AbstractInputSuggest.
 */
export class FolderInputSuggest extends AbstractInputSuggest<string> {
    /** Preloaded and sorted list of folder paths */
    private folders: string[] = [];

    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
        this.loadFolders();
    }

    /**
     * Loads every folder path from the vault and sorts them.
     */
    private loadFolders(): void {
        const folders: string[] = [];
        const allFiles = this.app.vault.getAllLoadedFiles();
        for (const file of allFiles) {
            if (file instanceof TFolder) {
                // The vault root has an empty path, so normalize it to "/".
                folders.push(file.path.replace(/\/$/, '') || '/');
            }
        }
        folders.sort((a, b) => a.localeCompare(b));
        this.folders = folders;
    }

    protected async getSuggestions(query: string): Promise<string[]> {
        const normalized = query.trim().toLowerCase();

        // Empty query: offer the first 50 folders as the default suggestions.
        if (!normalized) {
            return this.folders.slice(0, 50);
        }

        const matches = this.folders.filter((folderPath) =>
            folderPath.toLowerCase().includes(normalized)
        );

        // Cap the result at 50 suggestions.
        return matches.slice(0, 50);
    }

    /**
     * Renders one folder suggestion.
     */
    renderSuggestion(folder: string, el: HTMLElement): void {
        el.addClass('buttons-panel');
        el.createDiv({
            text: folder,
            cls: 'folder-suggestion',
        });
    }
}


