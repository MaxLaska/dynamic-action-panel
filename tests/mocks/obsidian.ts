/**
 * Minimal mock of the `obsidian` module for unit tests.
 *
 * The real `obsidian` package only ships type declarations (the runtime is
 * provided by the Obsidian app), so tests that touch modules importing
 * `obsidian` need this mock (wired up via the resolve alias in
 * vitest.config.ts). Only the members actually reached by tests are
 * implemented; extend as needed.
 */

export class Notice {
    constructor(
        public message?: string,
        public duration?: number
    ) {}
}

export class WorkspaceLeaf {}

export class TAbstractFile {
    path = '';
    name = '';
}

export class TFile extends TAbstractFile {
    basename = '';
    extension = '';
}

export class Modal {}

/**
 * Suggestion popups only need to EXIST for the action classes to import; the
 * tests construct and validate actions, they never render a form.
 */
export class AbstractInputSuggest<T> {
    constructor(..._args: unknown[]) {}
    getSuggestions(_query: string): T[] {
        return [];
    }
    renderSuggestion(_value: T, _el: unknown): void {}
    selectSuggestion(_value: T): void {}
    setValue(_value: string): void {}
    close(): void {}
}

export class Menu {}

export class MenuItem {}

export function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export function getLanguage(): string {
    return 'en';
}

export async function requestUrl(): Promise<never> {
    throw new Error('requestUrl is not available in unit tests');
}

export function setIcon(): void {}

export function setTooltip(): void {}
