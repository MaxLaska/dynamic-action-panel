/**
 * Minimal mock of the `obsidian` module for unit tests.
 *
 * The real `obsidian` package only ships type declarations (the runtime is
 * provided by the Obsidian app), so tests that touch modules importing
 * `obsidian` need this mock (wired up via the resolve alias in
 * vitest.config.ts). Only the members actually reached by tests are
 * implemented; extend as needed.
 */

/**
 * Every notice raised during a test, newest last. Tests that assert on
 * user-facing messages read this and clear it themselves.
 */
export const noticeLog: string[] = [];

export class Notice {
    constructor(
        public message?: string,
        public duration?: number
    ) {
        noticeLog.push(message ?? '');
    }
}

export class WorkspaceLeaf {}

/**
 * The slice of `ItemView` a workspace view's own code reaches: a leaf, an app,
 * and a content element inside a container element.
 *
 * The elements are created in the constructor, not at module load, so that the
 * many node-environment tests which merely import something touching
 * `obsidian` never need a DOM. Only a test that constructs a view — and runs
 * under happy-dom — pays for one.
 */
export class ItemView {
    app: unknown;
    leaf: WorkspaceLeaf;
    containerEl: HTMLElement;
    contentEl: HTMLElement;
    constructor(leaf: WorkspaceLeaf) {
        this.leaf = leaf;
        this.app = (leaf as { app?: unknown }).app;
        this.containerEl = document.createElement('div');
        this.contentEl = document.createElement('div');
        this.containerEl.appendChild(this.contentEl);
    }
}

export class TAbstractFile {
    path = '';
    name = '';
}

export class TFile extends TAbstractFile {
    basename = '';
    extension = '';
    stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
    children: TAbstractFile[] = [];
    isRoot(): boolean {
        return this.path === '' || this.path === '/';
    }
}

export class Modal {}

/**
 * Every suggest modal that has been opened during a test, newest last. There is
 * no jsdom here, so a test cannot click a suggestion — it takes the modal from
 * this list and calls `getItems()` / `onChooseItem()` on it, which runs the
 * real subclass against the real production code path. Tests clear it
 * themselves.
 */
export const openedSuggestModals: FuzzySuggestModal<unknown>[] = [];

export class FuzzySuggestModal<T> {
    app: unknown;
    limit = 50;
    emptyStateText = '';
    placeholder = '';
    constructor(app: unknown) {
        this.app = app;
    }
    setPlaceholder(placeholder: string): void {
        this.placeholder = placeholder;
    }
    setInstructions(_instructions: unknown[]): void {}
    getItems(): T[] {
        return [];
    }
    getItemText(_item: T): string {
        return '';
    }
    onChooseItem(_item: T, _evt?: unknown): void {}
    open(): void {
        openedSuggestModals.push(this);
    }
    close(): void {}
}

/**
 * Platform flags. Unit tests run the desktop branch, which is the one with
 * behaviour worth pinning; the mobile branch is a guard, not logic.
 */
export const Platform = {
    isDesktopApp: true,
    isMobile: false,
    isDesktop: true,
    /** Windows/Linux branch: Ctrl is the subtractive selection modifier there. */
    isMacOS: false,
};

/**
 * Only ever reached through `instanceof` to decide whether an absolute path can
 * be derived. A test's fake adapter is deliberately NOT an instance, so the
 * code under test takes the no-absolute-path branch.
 */
export class FileSystemAdapter {
    getBasePath(): string {
        return '/vault';
    }
    getFullPath(normalizedPath: string): string {
        return `/vault/${normalizedPath}`;
    }
    getFilePath(normalizedPath: string): string {
        return `file:///vault/${encodeURI(normalizedPath)}`;
    }
}

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
