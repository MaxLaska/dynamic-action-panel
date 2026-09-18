import { App, Notice, WorkspaceLeaf } from 'obsidian';
import { ButtonsPanelPlugin } from '@/types/plugin';
import { ButtonAction, FileActionParams } from '@/types/action';
import { t, tWithParams } from '@/utils/i18n';

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
        const { filePath, subpath } = this.validateAndExtractParams(action);
        const file = this.getFileByPath(filePath);
        if (!file) {
            return;
        }

        const existingLeaf = this.findOpenLeafForFile(filePath);
        if (existingLeaf) {
            this.activateLeaf(existingLeaf);
            // The file is already on screen, so there is nothing to open — only
            // a position to move to. Reopening it instead would be worse than
            // useless: a view that refuses a second leaf for the same file
            // (Obsidian's PDF/reader views do) discards the navigation with the
            // duplicate leaf, and the click would appear to do nothing.
            if (subpath) {
                // A background leaf is deferred: its real view does not exist
                // yet, so it has nowhere to put the position.
                await this.loadIfDeferred(existingLeaf);
                this.applyEphemeralSubpath(existingLeaf, subpath);
            }
            return;
        }

        if (subpath) {
            // Only warned about for a positioned open: that is the case where
            // silence would be baffling, because the tool promised a place
            // inside the file. A plain file tool keeps its old behaviour, and
            // plenty of extensions legitimately have no view (`.js`, `.txt`).
            this.warnIfNoViewRegistered(file.extension);
        }
        await this.openFileInNewLeaf(filePath, subpath);
    }

    /**
     * Validates the action type and extracts its parameters.
     * @param action Button action config
     * @returns The file path and the optional subpath
     * @throws When the action type is not 'file'
     */
    private validateAndExtractParams(action: ButtonAction): {
        filePath: string;
        subpath?: string;
    } {
        if (action.type !== 'file') {
            throw new Error('Invalid action type for file opening');
        }
        const fileParams: FileActionParams = action.parameters;
        const subpath = fileParams.subpath?.trim();
        return {
            filePath: fileParams.filePath,
            ...(subpath ? { subpath } : {}),
        };
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
            if (this.leafFilePath(leaf) === filePath) {
                return leaf;
            }
        }
        return null;
    }

    /**
     * The file a leaf is showing.
     *
     * Two sources, because a leaf in the background is *deferred*: its real view
     * has not been built yet, so `view.file` does not exist and only the
     * persisted view state knows the path. Missing that case would treat every
     * background tab as "not open" and open a duplicate.
     * @param leaf The leaf to inspect
     * @returns The vault path, or undefined when the leaf shows no file
     */
    private leafFilePath(leaf: WorkspaceLeaf): string | undefined {
        const view = leaf.view as unknown;
        const fromView =
            view && typeof view === 'object'
                ? (view as { file?: { path?: unknown } }).file?.path
                : undefined;
        if (typeof fromView === 'string') {
            return fromView;
        }
        try {
            const state = leaf.getViewState?.()?.state;
            const fromState = state?.['file'];
            return typeof fromState === 'string' ? fromState : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Builds a deferred leaf's real view before anything is asked of it.
     * Never fatal: an older Obsidian has no such concept, and a leaf that
     * refuses to load is still worth activating.
     * @param leaf The leaf to materialize
     */
    private async loadIfDeferred(leaf: WorkspaceLeaf): Promise<void> {
        try {
            if (leaf.isDeferred && typeof leaf.loadIfDeferred === 'function') {
                await leaf.loadIfDeferred();
            }
        } catch (error) {
            console.warn('[Dynamic Action Panel] Could not load a deferred leaf', error);
        }
    }

    /**
     * Activates the given leaf.
     * @param leaf The leaf to activate
     */
    private activateLeaf(leaf: WorkspaceLeaf): void {
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
    }

    /**
     * Opens the file in a new tab, at the subpath when there is one.
     *
     * The subpath travels as part of the link text rather than as `eState`,
     * because that is the form a view receives when the user follows a normal
     * Obsidian link — the same path the target view is already known to handle.
     * @param filePath File path
     * @param subpath Optional link subpath, including its leading `#`
     */
    private async openFileInNewLeaf(filePath: string, subpath?: string): Promise<void> {
        if (!subpath) {
            await this.app.workspace.openLinkText(filePath, '', true);
            return;
        }
        try {
            await this.app.workspace.openLinkText(`${filePath}${subpath}`, '', true);
        } catch (error) {
            // Obsidian hands the subpath straight to the target view, which may
            // reject one it cannot parse (a stale or hand-edited annotation, an
            // imported template from another vault). Same rule as the already
            // open case: show the file rather than fail the click.
            console.warn('[Dynamic Action Panel] Could not open at the subpath', subpath, error);
            // The view was built before it rejected the position, so the file is
            // usually on screen already; opening it again would add a second tab
            // for the same document.
            const opened = this.findOpenLeafForFile(filePath);
            if (opened) {
                this.activateLeaf(opened);
                return;
            }
            await this.app.workspace.openLinkText(filePath, '', true);
        }
    }

    /**
     * Moves an already open leaf to the subpath.
     *
     * Wrapped on purpose: `setEphemeralState` runs the target view's own
     * handler, and a view is free to throw on a subpath it cannot parse (the
     * ZotFlow reader does, for instance). A position we cannot reach is not a
     * reason to fail the click — the file is open, which is most of the intent.
     * @param leaf The leaf showing the file
     * @param subpath Link subpath, including its leading `#`
     */
    private applyEphemeralSubpath(leaf: WorkspaceLeaf, subpath: string): void {
        try {
            leaf.setEphemeralState({ subpath });
        } catch (error) {
            console.warn('[Dynamic Action Panel] Could not navigate to the subpath', subpath, error);
        }
    }

    /**
     * Warns when no view is registered for this extension, which is the one
     * case where opening the file silently does nothing at all (it happens when
     * the plugin that registered the type — a PDF reader, say — was disabled
     * without a restart). Read defensively: the registry is not public API, and
     * failing to consult it must never block the open attempt.
     * @param extension File extension without the dot
     */
    private warnIfNoViewRegistered(extension: string): void {
        const registry = (
            this.app as unknown as {
                viewRegistry?: { getTypeByExtension?: (ext: string) => string | undefined };
            }
        ).viewRegistry;
        if (typeof registry?.getTypeByExtension !== 'function') {
            return;
        }
        try {
            if (!registry.getTypeByExtension(extension)) {
                new Notice(tWithParams('no_view_for_extension', { extension }));
            }
        } catch {
            // Consulting the registry is a courtesy; never let it break the open.
        }
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
