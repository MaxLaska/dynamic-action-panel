/**
 * Types for script metadata and the script runtime context.
 *
 * User scripts (stored in the script folder) export in CommonJS style:
 *
 * module.exports = {
 *     entry: main,
 *     name: { zh: '...', en: '...', ru: '...' },
 *     description: { zh: '...', en: '...', ru: '...' },
 *     tags: ['file', 'batch'],
 * };
 *
 * async function main() {
 *     const { app, obsidian, notice } = this.$context;
 *     // ...
 * }
 *
 * The entry function reads its runtime context from `this.$context`; there are no
 * function parameters and no module-level injected variables.
 */

import type * as obsidian from 'obsidian';
import type { ButtonsPanelPlugin } from '@/types/plugin';

/** Localized text keyed by language code. */
export type LocalizedText = {
    zh: string;
    en: string;
    ru: string;
    [lang: string]: string;
};

/** Script entry function. At runtime it reads its context from `this.$context`. */
export type ScriptEntry = (this: ScriptThis) => unknown;

/**
 * Script runtime context.
 * Read inside the entry function via `this.$context`; it is the only way a script
 * reaches host capabilities.
 */
export interface ScriptContext {
    /** The running Obsidian App instance (an instance, not a constructor). */
    app: obsidian.App;
    /** The buttons panel plugin instance. */
    plugin?: ButtonsPanelPlugin;
    /** The obsidian module namespace; destructure Notice / TFile / Modal etc. from it. */
    obsidian: typeof obsidian;
    /** Performs an HTTP request (equivalent to obsidian.requestUrl), bypassing CORS. */
    requestUrl: typeof obsidian.requestUrl;
    /** Shows a notice, equivalent to new obsidian.Notice(message). */
    notice: (message: string, duration?: number) => obsidian.Notice;
}

/** The object bound as `this` inside the entry function. */
export interface ScriptThis {
    /** Script runtime context. */
    $context: ScriptContext;
}

/** Script metadata. name/description accept a localized object or a plain string. */
export interface ScriptMeta {
    /** Script entry function (required). */
    entry: ScriptEntry;
    /** Script name (localizable, or a plain string). */
    name?: LocalizedText | string;
    /** Script description (localizable, or a plain string). */
    description?: LocalizedText | string;
    /** Script tags, used for grouping and lookup. */
    tags?: string[];
}

/** Shape of a script module's exports: module.exports = ScriptMeta. */
export type ScriptModuleExports = ScriptMeta;

/**
 * Statically extracted script metadata for display purposes (suggestion
 * dropdowns etc.). Produced WITHOUT executing the script, so it carries no
 * entry function and localized texts may be partial.
 */
export interface ScriptFileMeta {
    name?: Record<string, string> | string;
    description?: Record<string, string> | string;
    tags?: string[];
}
