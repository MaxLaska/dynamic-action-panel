// action.ts
// Types for button actions.

/**
 * Parameters of the "open file" action.
 */
export interface FileActionParams {
    /** Vault-relative file path */
    filePath: string;
    /**
     * Optional Obsidian link subpath, stored WITH its leading `#`
     * (`#heading`, `#^block`, `#page=3`). It is handed to the target view as
     * ephemeral state, so what it means is the view's business, not this
     * plugin's — a heading for a Markdown view, a page for a PDF view.
     * Absent means "just open the file", which is the historical behaviour.
     */
    subpath?: string;
}

/**
 * Parameters of the "run command" action.
 */
export interface CommandActionParams {
    /** Obsidian command id */
    commandId: string;
    /** Command arguments (optional) */
	args?: unknown[];
}

/**
 * Parameters of the "open URL" action.
 */
export interface UrlActionParams {
    /** Target URL */
    url: string;
}

/**
 * Parameters of the "create file" action.
 */
export interface CreateFileActionParams {
    /** Folder path (optional) */
    folderPath?: string;
    /** File name */
    fileName: string;
    /** Template name (optional) */
    templateName?: string;
}

/**
 * Parameters of the "run script" action.
 */
export interface ScriptActionParams {
    /** Script name */
    scriptName: string;
}

/**
 * ButtonAction is the union of every supported action type and its parameters.
 */
export type ButtonAction =
    | { type: 'file'; parameters: FileActionParams }
    | { type: 'command'; parameters: CommandActionParams }
    | { type: 'url'; parameters: UrlActionParams }
    | { type: 'create_file'; parameters: CreateFileActionParams }
    | { type: 'script'; parameters: ScriptActionParams };
