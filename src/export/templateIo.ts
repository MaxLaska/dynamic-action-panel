// export/templateIo.ts
// The Obsidian-facing half of the template feature: getting a document out of
// the vault and a file back into it. Everything that decides WHAT travels and
// WHAT it becomes lives in the pure modules next door; this file only does
// I/O, user feedback, and the single commit.
//
// File mechanics, chosen for robustness over cleverness:
// - EXPORT writes into the vault itself (`app.vault.create`). The vault is a
//   plain folder, so the file is immediately visible in the file explorer and
//   on disk, ready to be copied to another vault. No Electron internals, no
//   download sandbox, works the same on desktop and mobile;
// - IMPORT uses a transient `<input type="file">`, i.e. the OS file picker.
//   It can reach a file ANYWHERE — including another vault — which is the
//   whole point, and it is a plain DOM API rather than a hand-built browser.
//
// Atomicity: parse -> validate -> plan -> ONE commitToolState. Every failure
// path returns before the commit, so a broken file cannot leave half a
// category, half a tool or a registry corpse behind.

import { App, Notice } from 'obsidian';
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
import {
    OCAP_TEMPLATE_FILE_EXTENSION,
    type TemplateDocument,
    type TemplateParseError,
} from '@/export/templateFormat';

/**
 * A counted phrase with its own singular form — "1 tool" reads wrong as
 * "1 tools", and the counts here are routinely 1.
 */
function counted(key: string, count: number): string {
    return count === 1
        ? t(`${key}_one`)
        : tWithParams(`${key}_other`, { count });
}

/** A vault path that is still free, derived from `Name.ocap.json`. */
function freeVaultPath(app: App, fileName: string): string {
    if (!app.vault.getAbstractFileByPath(fileName)) {
        return fileName;
    }
    const base = fileName.endsWith(OCAP_TEMPLATE_FILE_EXTENSION)
        ? fileName.slice(0, -OCAP_TEMPLATE_FILE_EXTENSION.length)
        : fileName;
    for (let n = 1; n < 1000; n += 1) {
        const candidate = `${base} ${n}${OCAP_TEMPLATE_FILE_EXTENSION}`;
        if (!app.vault.getAbstractFileByPath(candidate)) {
            return candidate;
        }
    }
    return `${base} ${Date.now()}${OCAP_TEMPLATE_FILE_EXTENSION}`;
}

/**
 * Export one category as a portable template file in the vault root.
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
    const state = toolStateOf(plugin);
    const category = state.categories.find((entry) => entry.id === categoryId);
    if (!category) {
        new Notice(t('category_not_found'));
        return;
    }

    const document = buildTemplateDocument(state, [categoryId], {
        pluginVersion: plugin.manifest?.version,
        exportedAt: new Date().toISOString(),
    });

    try {
        const path = freeVaultPath(app, templateFileName(category.name));
        await app.vault.create(path, serializeTemplateDocument(document));
        new Notice(
            tWithParams('template_export_done', {
                path,
                tools: counted('template_count_tool', Object.keys(document.tools).length),
            })
        );
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

    // Everything above is pure planning; this is the ONE write.
    await commitToolState(plugin, plan.state);

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
 * Open the OS file picker and import the chosen template.
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
