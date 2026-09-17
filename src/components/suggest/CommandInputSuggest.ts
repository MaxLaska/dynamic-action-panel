/**
 * CommandInputSuggest - command input suggestions
 * Stylesheet: CommandInputSuggest.css
 */
import type { App, Command } from 'obsidian';
import { AbstractInputSuggest } from 'obsidian';

/**
 * Dropdown suggestions for the command input, built on Obsidian's AbstractInputSuggest.
 * It attaches to the input element and floats the matching commands below it while typing.
 */
export class CommandInputSuggest extends AbstractInputSuggest<Command> {
    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
    }

    protected async getSuggestions(query: string): Promise<Command[]> {
        const anyApp = this.app as unknown as {
            commands?: {
                listCommands?: () => Command[];
                // Internal field, used only as a compatibility fallback.
                commands?: Record<string, Command>;
            };
        };

        let allCommands: Command[] = [];

        if (anyApp.commands && typeof anyApp.commands.listCommands === 'function') {
            // Keep the `this` binding: listCommands must not be destructured and called on its own.
            allCommands = anyApp.commands.listCommands() ?? [];
        }

        // Compatibility fallback: some versions expose the commands through the internal map.
        if (!allCommands.length && anyApp.commands && anyApp.commands.commands) {
            allCommands = Object.values(anyApp.commands.commands);
        }

        if (!allCommands.length) {
            // Still no command list: degrade to an empty result instead of throwing.
            console.warn('[Dynamic Action Panel] Could not read the Obsidian command list; command suggestions are empty.');
            return [];
        }

        const normalized = query.trim().toLowerCase();
        if (!normalized) return allCommands;

        return allCommands.filter(
            (cmd) =>
                cmd.name?.toLowerCase().includes(normalized) ||
                cmd.id.toLowerCase().includes(normalized)
        );
    }

    /**
     * Renders one command suggestion.
     */
    renderSuggestion(cmd: Command, el: HTMLElement): void {
        el.addClass('buttons-panel');
        const name = cmd?.name || cmd.id;
        el.createDiv({
            text: `${name} (${cmd.id})`,
            cls: 'command-suggestion',
        });
    }
}


