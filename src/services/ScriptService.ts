import * as obsidian from 'obsidian';
import { ButtonAction } from '@/types/action';
import { ButtonsPanelPlugin } from '@/types/plugin';
import { t, tWithParams, getCurrentLang } from '@/utils/i18n';
import { getSafeLastContentLeaf } from '@/utils/obsidian';
import type {
    LocalizedText,
    ScriptContext,
    ScriptEntry,
    ScriptFileMeta,
    ScriptMeta,
    ScriptThis,
} from '@/types/script';
import { parseScriptMeta } from '@/utils/scriptMetaParser';

/**
 * Runs user-defined script files.
 *
 * A script exports in CommonJS style:
 * module.exports = { entry, name, description, tags }
 * The entry function reads its runtime context from `this.$context`.
 */
export class ScriptService {
    /**
     * Initializes the service with the app and plugin instance.
     * @param app Obsidian app instance
     * @param plugin Plugin instance (optional)
     */
    constructor(
        private app: obsidian.App,
        private plugin?: ButtonsPanelPlugin
    ) {}

    /** Script metadata cache, keyed by the full script file path, to avoid re-parsing. */
    private metaCache: Map<string, ScriptFileMeta | null> = new Map();

    /**
     * Runs a user-defined script file.
     *
     * This lets a button run a JS script from the script folder for custom automation
     * or batch processing. A script must export via
     * module.exports = { entry, name, description, tags }, and its entry function reaches
     * app / plugin / obsidian / requestUrl / notice through `this.$context`.
     *
     * @param action Button action config; must be type: 'script' with its parameters
     */
    async runScript(action: ButtonAction): Promise<void> {
        try {
            // Focus the last active content leaf (never the buttons panel) before running.
            const lastContentLeaf = getSafeLastContentLeaf(this.app, this.plugin);
            if (lastContentLeaf) {
                this.app.workspace.setActiveLeaf(lastContentLeaf, { focus: true });
            }

            // Resolve the script path.
            const { scriptFilePath, scriptFileName } = this.resolveScriptPath(action);

            // Read the script source.
            const scriptContent = await this.readScriptContent(scriptFilePath);
            if (!scriptContent) {
                return;
            }

            // Evaluate the script module to obtain module.exports.
            const module = await this.evaluateModule(scriptContent);

            // Run the exported entry function.
            await this.executeEntry(module, scriptFileName);
        } catch (error) {
            // Report any script failure as a notice.
            const errorMessage = error instanceof Error ? error.message : String(error);
            new obsidian.Notice(t('script_run_failed') + `: ${errorMessage}`);
        }
    }

    /**
     * Reads structured metadata (module.exports = { entry, name, description,
     * tags }) from a script file by STATIC PARSING ONLY. The script is never
     * executed for metadata retrieval — running arbitrary top-level code just
     * because a suggestion dropdown prefetches metadata would be a security
     * hazard. Results are cached per file path.
     *
     * @param file the script file
     * @returns statically extracted metadata; null when the script has no
     *          statically analyzable `module.exports = { entry, ... }` object
     */
    async getScriptMeta(file: obsidian.TFile): Promise<ScriptFileMeta | null> {
        const cacheKey = file.path;
        if (this.metaCache.has(cacheKey)) {
            return this.metaCache.get(cacheKey) ?? null;
        }

        let meta: ScriptFileMeta | null = null;
        try {
            const scriptContent = await this.app.vault.read(file);
            if (scriptContent) {
                const parsed = parseScriptMeta(scriptContent);
                // Mirror the runtime contract: only scripts that declare an
                // `entry` export count as valid script modules.
                if (parsed && parsed.hasEntry) {
                    meta = {
                        name: parsed.name,
                        description: parsed.description,
                        tags: parsed.tags,
                    };
                }
            }
        } catch {
            meta = null;
        }
        this.metaCache.set(cacheKey, meta);
        return meta;
    }

    /**
     * Picks the display text for the current language from a localized object or a plain string.
     * Fallback order: current language -> en -> zh -> first non-empty value -> `fallback`.
     *
     * @param text Localized text object or plain string
     * @param fallback Text used when nothing else resolves
     * @returns Display text for the current language
     */
    resolveLocalizedText(
        text: LocalizedText | Record<string, string> | string | undefined,
        fallback = ''
    ): string {
        if (!text) return fallback;
        if (typeof text === 'string') return text || fallback;
        const lang = getCurrentLang();
        return (
            text[lang] ||
            text['en'] ||
            text['zh'] ||
            Object.values(text).find((v) => !!v) ||
            fallback
        );
    }

    /**
     * Builds the script runtime context, the only way a script reaches host capabilities.
     * @returns The script context object
     */
    private createContext(): ScriptContext {
        return {
            app: this.app,
            plugin: this.plugin,
            obsidian,
            requestUrl: obsidian.requestUrl,
            notice: (message: string, duration?: number) =>
                new obsidian.Notice(message, duration),
        };
    }

    /**
     * Extracts the script metadata from module.exports.
     * @param exports The value of module.exports
     * @returns The extracted ScriptMeta, or null
     */
    private parseMetaFromExports(exports: unknown): ScriptMeta | null {
        if (!exports || typeof exports !== 'object') return null;
        const obj = exports as Record<string, unknown>;
        if (typeof obj.entry !== 'function') return null;
        return {
            entry: obj.entry as ScriptEntry,
            name: obj.name as ScriptMeta['name'],
            description: obj.description as ScriptMeta['description'],
            tags: Array.isArray(obj.tags)
                ? obj.tags.filter((tag): tag is string => typeof tag === 'string')
                : undefined,
        };
    }

    /**
     * Resolves the script path.
     * @param action Button action config
     * @returns The script file path and file name
     */
    private resolveScriptPath(action: ButtonAction): {
        scriptFilePath: string;
        scriptFileName: string;
    } {
        // In the ButtonAction union, parameters already carries scriptName when type === 'script'.
        const scriptFileName =
            action.type === 'script' ? action.parameters.scriptName : '';

        // Read the script folder path from the plugin settings.
        let scriptFolderPath = this.plugin?.settings?.pathConfig?.scriptFolderPath ?? '';
        // Normalize it.
        scriptFolderPath = obsidian.normalizePath(scriptFolderPath);

        // Assemble the full script file path.
        let scriptFilePath = scriptFolderPath
            ? `${scriptFolderPath}/${scriptFileName}`
            : scriptFileName;
        scriptFilePath = obsidian.normalizePath(scriptFilePath);

        return { scriptFilePath, scriptFileName };
    }

    /**
     * Reads the content of a script file.
     * @param scriptFilePath Script file path
     * @returns The script source, or null when the file does not exist
     */
    private async readScriptContent(
        scriptFilePath: string
    ): Promise<string | null> {
        const scriptFile = this.app.vault.getFileByPath(scriptFilePath);
        if (!scriptFile) {
            // Script file not found: show a notice.
            new obsidian.Notice(t('script_file_not_found') + `: ${scriptFilePath}`);
            return null;
        }

        // Read the script source as text.
        return await this.app.vault.read(scriptFile);
    }

    /**
     * Evaluates the script inside a CommonJS-style sandbox scope and returns its module exports.
     * Only module / exports are injected; every other capability comes from `this.$context`
     * inside the entry function.
     *
     * @param scriptContent Script source
     * @returns The module object (carrying exports)
     */
    private async evaluateModule(
        scriptContent: string
    ): Promise<{ exports: unknown }> {
        const module: { exports: unknown } = { exports: {} };

        type AsyncFunctionConstructor = new (...args: string[]) => (
            ...args: unknown[]
        ) => Promise<unknown>;
        const asyncFunctionPrototype = Object.getPrototypeOf(
            async function () {}
        ) as { constructor: AsyncFunctionConstructor };
        const AsyncFunctionConstructor = asyncFunctionPrototype.constructor;

        // Build an async function dynamically, injecting only module and exports.
        const fn: (...args: unknown[]) => Promise<unknown> = new AsyncFunctionConstructor(
            'module',
            'exports',
            scriptContent
        );

        // Run the script body; it replaces the exports object via module.exports = { ... }.
        await fn.call(undefined, module, module.exports);

        return module;
    }

    /**
     * Runs the entry function exported by the module, with `this.$context` injected.
     * @param module The module object
     * @param scriptFileName Script file name (used in the error notice)
     */
    private async executeEntry(
        module: { exports: unknown },
        scriptFileName: string
    ): Promise<void> {
        const meta = this.parseMetaFromExports(module.exports);

        if (!meta) {
            // The script did not use the module.exports = { entry, ... } shape: show a notice.
            new obsidian.Notice(tWithParams('script_invalid_export', { scriptFileName }));
            return;
        }

        const scriptThis: ScriptThis = { $context: this.createContext() };
        await meta.entry.call(scriptThis);
    }
}
