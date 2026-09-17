/**
 * FileInputSuggest - file input suggestions
 * Stylesheet: FileInputSuggest.css
 */
import type { App, TFile } from 'obsidian';
import { AbstractInputSuggest, normalizePath } from 'obsidian';

/** Optional metadata attached to a suggestion, used for the richer name + description rows. */
export interface SuggestionMeta {
    /** Display name, already resolved for the current language */
    name?: string;
    /** Display description, already resolved for the current language */
    description?: string;
}

export interface FileInputSuggestOptions {
    rootFolder?: string;
    fileExts?: string[];
    /**
     * Whether the suggestion list shows only the file name instead of the path.
     * - false (default): show the full path
     * - true: show only the file name, as ScriptInput does
     */
    showFileNameOnly?: boolean;
    /**
     * Optional metadata resolver: returns a name/description for a file, used for the richer rows.
     * When it returns null/undefined the row falls back to the plain file name.
     */
    getMeta?: (file: TFile) => SuggestionMeta | null | Promise<SuggestionMeta | null>;
    /** Whether the muted second line is shown. Default true, and only when getMeta returns a description. */
    showDescription?: boolean;
}

/**
 * File dropdown suggestions for the file input, built on AbstractInputSuggest.
 * - Capped at 50 suggestions so the list stays usable
 */
export class FileInputSuggest extends AbstractInputSuggest<TFile> {
    private readonly options: FileInputSuggestOptions;
    /** Preloaded file list, sorted by path and already filtered by rootFolder/fileExts */
    private files: TFile[] = [];
    /** Metadata cache keyed by file path, used for the richer suggestion rows. */
    private metaCache: Map<string, SuggestionMeta | null> = new Map();

    constructor(app: App, inputEl: HTMLInputElement, options: FileInputSuggestOptions) {
        super(app, inputEl);
        this.options = options;
        this.loadFiles();
    }

    /**
     * Loads every matching file from the vault and sorts them.
     */
    private loadFiles(): void {
        let files = this.app.vault.getFiles();

        if (this.options.fileExts && this.options.fileExts.length > 0) {
            files = files.filter((file) => this.options.fileExts!.includes(file.extension));
        }

        if (this.options.rootFolder) {
            const root = normalizePath(this.options.rootFolder);
            const prefix = root.endsWith('/') ? root : root + '/';
            files = files.filter((file) => file.path.startsWith(prefix));
        }

        files.sort((a, b) => a.path.localeCompare(b.path));
        this.files = files;
    }

    protected async getSuggestions(query: string): Promise<TFile[]> {
        const normalized = query.trim().toLowerCase();

        // Empty query: offer the first 50 files as the default suggestions.
        if (!normalized) {
            const top = this.files.slice(0, 50);
            await this.prefetchMeta(top);
            return top;
        }

        const matches = this.files.filter(
            (file) =>
                file.path.toLowerCase().includes(normalized) ||
                file.basename.toLowerCase().includes(normalized)
        );

        const sliced = matches.slice(0, 50);
        await this.prefetchMeta(sliced);
        return sliced;
    }

    /**
     * Prefetches the metadata of a batch of files so renderSuggestion can read it synchronously.
     */
    private async prefetchMeta(files: TFile[]): Promise<void> {
        if (!this.options.getMeta) return;
        await Promise.all(
            files.map(async (file) => {
                if (this.metaCache.has(file.path)) return;
                try {
                    const meta = await this.options.getMeta!(file);
                    this.metaCache.set(file.path, meta ?? null);
                } catch {
                    this.metaCache.set(file.path, null);
                }
            })
        );
    }

    /**
     * Renders one file suggestion.
     * With a getMeta callback that returns usable metadata the row shows name and description;
     * otherwise it falls back to just the file name or path.
     */
    renderSuggestion(file: TFile, el: HTMLElement): void {
        el.addClass('buttons-panel');

        const meta = this.metaCache.get(file.path) ?? null;
        const showDescription = this.options.showDescription ?? true;

        // Main line: the file name (the value that is actually inserted), or the path.
        const title = this.options.showFileNameOnly ? file.name : file.path;
        const titleEl = el.createDiv({ cls: 'file-suggestion-title' });
        titleEl.setText(title);

        // Second line: name and description when both exist, otherwise whichever one does.
        const name = meta?.name?.trim();
        const desc = meta?.description?.trim();
        let subLine = '';
        if (name && desc) {
            subLine = `${name}：${desc}`;
        } else if (desc) {
            subLine = desc;
        } else if (name) {
            subLine = name;
        }
        if (showDescription && subLine) {
            const descEl = el.createDiv({ cls: 'file-suggestion-desc' });
            descEl.setText(subLine);
        }
    }
}


