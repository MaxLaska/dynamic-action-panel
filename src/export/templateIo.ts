// export/templateIo.ts
// The Obsidian-facing half of the template feature: getting a document out of
// the vault and a file back into it. Everything that decides WHAT travels and
// WHAT it becomes lives in the pure modules next door; this file only does
// I/O, user feedback, and the single commit.
//
// File mechanics, chosen for robustness over cleverness:
// - EXPORT writes into the managed library folder (see templateLibrary.ts)
//   through `app.vault.create`. The vault is a plain folder, so the file is
//   immediately visible in the file explorer and on disk, ready to be copied
//   elsewhere. No save dialog: the destination is known, so the user is never
//   asked a question they already answered. No Electron internals, no download
//   sandbox, works the same on desktop and mobile;
// - IMPORT has two doors. The normal one lists what is in the library folder,
//   which is also where a file copied in by hand shows up. The second one is
//   the OS file picker, kept for a file that lives ANYWHERE else — including
//   another vault — which no in-vault list can reach.
//
// Atomicity: parse -> validate -> plan -> ONE commitToolState. Every failure
// path returns before the commit, so a broken file cannot leave half a
// category, half a tool or a registry corpse behind. Both import doors end in
// the same `importTemplateContent`, so they cannot drift apart.

import { App, FileSystemAdapter, Notice, Platform } from 'obsidian';
import type { ButtonsPanelPlugin } from '@/types/plugin';
import { commitToolState, toolStateOf } from '@/utils/categoryStore';
import { freshId } from '@/utils/id';
import { t, tWithParams } from '@/utils/i18n';
import {
    buildTemplateDocument,
    serializeTemplateDocument,
    templateFileName,
} from '@/export/templateExport';
import { parseTemplateDocument } from '@/export/templateParse';
import {
    collectTemplateExternalReferences,
    planTemplateImport,
    type TemplateIdKind,
} from '@/export/templateImport';
import { type TemplateDocument, type TemplateParseError } from '@/export/templateFormat';
import {
    TEMPLATE_LIBRARY_FOLDER,
    ensureTemplateLibraryFolder,
    freeTemplateLibraryPath,
} from '@/export/templateLibrary';
import { TemplateSuggestModal } from '@/export/TemplateSuggestModal';
import { futureSettingsBlock } from '@/utils/settingsWriteGuard';

/**
 * A counted phrase with its own singular form — "1 tool" reads wrong as
 * "1 tools", and the counts here are routinely 1.
 */
function counted(key: string, count: number): string {
    return count === 1
        ? t(`${key}_one`)
        : tWithParams(`${key}_other`, { count });
}

/**
 * Export one category as a portable template file in the template library.
 *
 * Read-only with respect to the settings: nothing is renumbered, collected or
 * saved — the plugin state after an export is byte-identical to the state
 * before it.
 */
export async function exportCategoryTemplate(
    app: App,
    plugin: ButtonsPanelPlugin,
    categoryId: string
): Promise<void> {
    // The whole body is guarded, not just the write: the caller invokes this
    // with a bare `void`, so anything escaping here becomes an unhandled
    // rejection and the user simply sees nothing happen. Building the document
    // serializes the category, which is not obviously incapable of throwing.
    try {
        const state = toolStateOf(plugin);
        const category = state.categories.find((entry) => entry.id === categoryId);
        if (!category) {
            new Notice(t('template_export_no_category'));
            return;
        }

        const document = buildTemplateDocument(state, [categoryId], {
            pluginVersion: plugin.manifest?.version,
            exportedAt: new Date().toISOString(),
        });

        // Refused before anything is written rather than after: `vault.create`
        // on a path whose folder is missing fails.
        const folderError = await ensureTemplateLibraryFolder(app);
        if (folderError !== null) {
            new Notice(
                `${t('create_folder_failed')}: ${TEMPLATE_LIBRARY_FOLDER} (${folderError})`
            );
            return;
        }

        const path = freeTemplateLibraryPath(app, templateFileName(category.name));
        await app.vault.create(path, serializeTemplateDocument(document));
        const done = tWithParams('template_export_done', {
            file: path.slice(TEMPLATE_LIBRARY_FOLDER.length + 1),
            folder: TEMPLATE_LIBRARY_FOLDER,
            tools: counted('template_count_tool', Object.keys(document.tools).length),
        });
        // Exporting stays allowed when the configuration comes from a newer
        // build — it only reads, and writes a separate file, so nothing is at
        // risk. But it is built from what THIS build could read, so it may not
        // carry everything the newer one stored, and calling that a complete
        // copy would be the kind of quiet half-truth that costs someone a
        // configuration later.
        const partial = futureSettingsBlock(plugin) ? ` ${t('template_export_partial')}` : '';
        new Notice(`${done}${partial}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`${t('template_export_failed')}: ${message}`);
    }
}

/** Human-readable reason an import was refused. */
function describeParseError(error: TemplateParseError): string {
    switch (error.kind) {
        case 'invalid_json':
            return t('template_error_invalid_json');
        case 'not_a_template':
            return t('template_error_not_a_template');
        case 'unsupported_version':
            return tWithParams('template_error_unsupported_version', {
                version: error.detail ?? '?',
            });
        case 'dangling_tool_reference':
            return tWithParams('template_error_dangling_tool', {
                detail: error.detail ?? '',
            });
        default:
            return tWithParams('template_error_invalid_structure', {
                detail: error.detail ?? '',
            });
    }
}

/**
 * External targets the document names that this vault does not have.
 *
 * Reported, never repaired: no path rewriting, no fuzzy search, no substitute
 * file. A missing target is a runtime concern (`File not found: …` on click),
 * which is exactly what makes a template importable before its files exist.
 */
function countMissingReferences(
    app: App,
    plugin: ButtonsPanelPlugin,
    document: TemplateDocument
): number {
    const { filePaths, scriptNames } = collectTemplateExternalReferences(document);
    const scriptFolder = (plugin.settings.pathConfig?.scriptFolderPath ?? '').replace(
        /^\/+|\/+$/g,
        ''
    );
    let missing = 0;
    for (const filePath of filePaths) {
        if (!app.vault.getAbstractFileByPath(filePath)) missing += 1;
    }
    for (const scriptName of scriptNames) {
        const path = scriptFolder ? `${scriptFolder}/${scriptName}` : scriptName;
        if (!app.vault.getAbstractFileByPath(path)) missing += 1;
    }
    return missing;
}

/**
 * Import a template document into the current vault: fresh ids for everything,
 * appended as new categories, committed in one step.
 */
export async function importTemplateContent(
    app: App,
    plugin: ButtonsPanelPlugin,
    content: string
): Promise<boolean> {
    const parsed = parseTemplateDocument(content);
    if (!parsed.ok) {
        new Notice(`${t('template_import_failed')}: ${describeParseError(parsed.error)}`);
        return false;
    }

    const plan = planTemplateImport(toolStateOf(plugin), parsed.document, {
        newId: (kind: TemplateIdKind) => freshId(kind),
        importedSuffix: t('template_imported_suffix'),
    });

    // Everything above is pure planning; this is the ONE write. It refuses
    // when the loaded configuration came from a newer build, and then there is
    // nothing to report as imported — reporting success for a template that
    // vanishes on the next reload would be worse than refusing plainly. The
    // commit funnel has already explained why.
    if (!(await commitToolState(plugin, plan.state))) {
        return false;
    }

    const missing = countMissingReferences(app, plugin, parsed.document);
    const summary = tWithParams('template_import_done', {
        categories: counted('template_count_category', plan.summary.categoryCount),
        tools: counted('template_count_tool', plan.summary.toolCount),
    });
    const missingNote =
        missing === 1
            ? t('template_import_missing_one')
            : tWithParams('template_import_missing', { missing });
    new Notice(missing > 0 ? `${summary} ${missingNote}` : summary);
    return true;
}

/**
 * Open the template library folder in the operating system's file manager.
 *
 * This is the action that makes the library a real place rather than a plugin
 * concept: it is how a user gets to the files to copy them off a backup drive,
 * hand one to somebody, or just see that they exist.
 *
 * Mechanism, and it is entirely public API: `getFilePath` turns the
 * vault-relative path into a `file://` URL, and Obsidian's main process
 * intercepts `window.open(url, '_external')` and hands a file URL to the
 * platform shell — which, for a directory, opens the directory itself. This is
 * what Obsidian's own `openWithDefaultApp` does (the "Open in default app"
 * command), NOT what "Show in system explorer" does: the latter is
 * `shell.showItemInFolder`, which selects an item inside its parent instead.
 * Opening is the wanted behaviour here, and this route needs no Electron
 * import and no undocumented `App` member.
 *
 * The folder is created first — before the platform check, so the notice
 * mobile gets names a folder that actually exists. "Show me where these go"
 * has to work BEFORE there is anything in it, which is exactly the state
 * someone restoring from a backup is in.
 */
export async function openTemplateLibraryFolder(app: App): Promise<void> {
    const folderError = await ensureTemplateLibraryFolder(app);
    if (folderError !== null) {
        new Notice(
            `${t('create_folder_failed')}: ${TEMPLATE_LIBRARY_FOLDER} (${folderError})`
        );
        return;
    }

    // On mobile there is no file manager a plugin can hand a folder to, and
    // `CapacitorAdapter` has no `getFilePath` at all. This check must come
    // before the `instanceof` below: `FileSystemAdapter` is a desktop-only
    // export, and `x instanceof undefined` is a TypeError.
    if (!Platform.isDesktopApp) {
        new Notice(
            tWithParams('template_open_folder_unsupported', {
                folder: TEMPLATE_LIBRARY_FOLDER,
            })
        );
        return;
    }

    const adapter = app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
        new Notice(t('template_open_folder_failed'));
        return;
    }

    try {
        // The return value is deliberately ignored: Obsidian's window-open
        // handler answers `{ action: 'deny' }` after dispatching to the shell,
        // so `window.open` yields null on SUCCESS too. It reports neither
        // outcome, which means a refusal by the OS cannot be detected here.
        window.open(adapter.getFilePath(TEMPLATE_LIBRARY_FOLDER), '_external');
    } catch {
        new Notice(t('template_open_folder_failed'));
    }
}

/**
 * Pick a template from the library and import it.
 *
 * The normal way in. The list is the folder's current contents, so a file the
 * user copied in from a backup a second ago is offered without any refresh
 * step, and a file they deleted is simply gone.
 *
 * The folder is created when it is missing so the picker can explain an empty
 * library instead of failing — and so "Import" followed by "Open template
 * folder" lands somewhere real on a vault that has never exported anything.
 */
export async function importTemplateFromLibrary(
    app: App,
    plugin: ButtonsPanelPlugin
): Promise<void> {
    const folderError = await ensureTemplateLibraryFolder(app);
    if (folderError !== null) {
        // Without this the picker would open and tell the user to copy files
        // into a folder that could not be created, naming no reason.
        new Notice(
            `${t('create_folder_failed')}: ${TEMPLATE_LIBRARY_FOLDER} (${folderError})`
        );
        return;
    }
    new TemplateSuggestModal(app, (file) => {
        void (async () => {
            try {
                // `read`, not `cachedRead`: the file may have been written
                // outside Obsidian moments ago, and this is a one-shot import
                // rather than a render path.
                const content = await app.vault.read(file);
                await importTemplateContent(app, plugin, content);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                new Notice(`${t('template_import_failed')}: ${message}`);
            }
        })();
    }).open();
}

/**
 * Open the OS file picker and import the chosen template.
 *
 * The secondary way in, for a file that is NOT in the library: on a backup
 * drive, in another vault, in a download folder. It reaches anywhere, which is
 * exactly what an in-vault list cannot do, and it is the reason this path
 * survives the library. Where the dialog opens is left to the OS — no web API
 * can set it, and it no longer matters now that it is not the normal route.
 *
 * A transient `<input type="file">` is the one file chooser that works in
 * Obsidian on every platform without touching Electron internals; it is
 * removed again as soon as the dialog resolves.
 */
export function pickAndImportTemplate(app: App, plugin: ButtonsPanelPlugin): void {
    const input = activeDocument.body.createEl('input', {
        cls: 'ocap-template-file-input',
        attr: { type: 'file', accept: '.json,application/json' },
    });

    const cleanup = (): void => {
        input.remove();
    };

    input.addEventListener('change', () => {
        const file = input.files?.[0];
        cleanup();
        if (!file) {
            return;
        }
        void (async () => {
            try {
                const content = await file.text();
                await importTemplateContent(app, plugin, content);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                new Notice(`${t('template_import_failed')}: ${message}`);
            }
        })();
    });
    // A cancelled dialog fires no `change`; `cancel` is supported in current
    // Chromium and simply never arrives on older ones, where the detached
    // input is collected with the document instead.
    input.addEventListener('cancel', cleanup);

    input.click();
}
