/**
 * IconInputSuggest - icon input suggestions
 * Stylesheet: IconInputSuggest.css
 */
import type { App } from 'obsidian';
import { AbstractInputSuggest, getIconIds, setIcon } from 'obsidian';

/**
 * Dropdown suggestions of icon ids for the icon input.
 */
export class IconInputSuggest extends AbstractInputSuggest<string> {
    private readonly allIconIds: string[];
    /** Maximum suggestions rendered at once, so loading every icon never stalls the UI */
    private readonly maxResults: number = 200;

    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
        this.allIconIds = getIconIds?.() ?? [];
        // Cap the rendered suggestions (supported by Obsidian itself).
        this.limit = this.maxResults;
    }

    protected async getSuggestions(query: string): Promise<string[]> {
        const normalized = query.trim().toLowerCase();
        // Empty query: return only the first maxResults icons instead of all of them.
        if (!normalized) {
            return this.allIconIds.slice(0, this.maxResults);
        }

        // Stop scanning as soon as maxResults matches have been collected.
        const results: string[] = [];
        for (const id of this.allIconIds) {
            if (id && id.toLowerCase().includes(normalized)) {
                results.push(id);
                if (results.length >= this.maxResults) break;
            }
        }
        return results;
    }

    renderSuggestion(iconId: string, el: HTMLElement): void {
        el.addClass('buttons-panel');
        const container = el.createDiv({
            cls: 'icon-suggestion',
        });
        container.createSpan({ cls: 'icon-suggestion__icon' });
        if (iconId) {
            setIcon(container, iconId);
        }
        container.createSpan({ text: iconId, cls: 'icon-suggestion__label' });
    }
}


