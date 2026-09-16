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

export class Modal {}

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
