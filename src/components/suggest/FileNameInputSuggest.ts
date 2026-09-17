/**
 * FileNameInputSuggest - file name input suggestions
 * Stylesheet: FileNameInputSuggest.css
 */
import type { App } from 'obsidian';
import { AbstractInputSuggest, moment } from 'obsidian';

type SafeMoment = () => { format(fmt: string): string };

/**
 * Dropdown suggestions of date variable formats for the file name input.
 */
export class FileNameInputSuggest extends AbstractInputSuggest<string> {
    private readonly dateFormats: string[] = [
        'YYYY-MM-DD',
        'YYYY-MM-DD-HH-mm',
        'YYYY-MM-DD-HH-mm-ss',
        'YYYYMMDD',
        'YYYYMMDDHHmm',
        'YYYYMMDDHHmmss',
        'YYMMDD',
        'gggg-[W]WW',
    ];

    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
    }

    protected async getSuggestions(query: string): Promise<string[]> {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return this.dateFormats;
        return this.dateFormats.filter((format) => format.toLowerCase().includes(normalized));
    }

    /**
     * Writes the selected format into the input using the {{DATE:...}} syntax.
     */
    override selectSuggestion(format: string, evt: MouseEvent | KeyboardEvent): void {
        const value = `{{DATE:${format}}}`;
        this.setValue(value);
        super.selectSuggestion(format, evt);
    }

    /**
     * Renders one date format suggestion, including its preview.
     */
    renderSuggestion(format: string, el: HTMLElement): void {
        const preview = (moment as unknown as SafeMoment)().format(format);
        el.addClass('buttons-panel');
        el.addClass('filename-suggestion');
        el.createDiv({ text: `{{DATE:${format}}}` });
        el.createDiv({
            text: `${preview}.md`,
            cls: 'format-preview',
        });
    }

    /**
     * Returns the display text of a format, for callers that render it themselves.
     */
    getDisplayValue(format: string): string {
        const preview = (moment as unknown as SafeMoment)().format(format);
        return `{{DATE:${format}}} — ${preview}.md`;
    }
}


