// export/templateLibrary.ts
// The managed template library: one fixed, visible folder in the vault that is
// both the export destination and the import source.
//
// Why a fixed folder rather than a picker: a save dialog makes the user answer
// "where?" every single time, and an OS open dialog cannot even be told where
// to start (no web API can set a file input's initial directory), so it kept
// landing in whatever folder the user last visited. A folder the user can
// always name, always find and always open in Explorer/Finder answers the
// question once. The folder IS the collection — there is no index, no
// database and no import history to keep in sync with it, which is what makes
// "copy a `.ocap.json` in from a backup drive and import it" work with no
// further machinery.
//
// The name is spelled out in full on purpose: it shows up in the user's file
// explorer next to their notes, so it has to read as something the plugin owns
// rather than as an abbreviation. The FILE extension stays `.ocap.json` for
// compatibility with templates exported before the rename.

import { App, TFile } from 'obsidian';
import { OCAP_TEMPLATE_FILE_EXTENSION } from '@/export/templateFormat';

/** The one folder templates are written to and read from, vault-relative. */
export const TEMPLATE_LIBRARY_FOLDER = 'Dynamic Action Panel/Templates';

/**
 * Hoisted, because the picker re-lists on every keystroke: building a collator
 * per comparison is thousands of constructions per character typed.
 */
const NAME_ORDER = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

/**
 * The library folder and every folder above it, outermost first.
 *
 * `createFolder` creates intermediate folders in current Obsidian, but walking
 * the chain explicitly makes that an implementation detail rather than a
 * requirement, and it keeps each step individually guarded.
 */
function folderChain(): string[] {
    const parts = TEMPLATE_LIBRARY_FOLDER.split('/');
    return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

/** The library-relative path a template file with this name would have. */
export function templateLibraryPath(fileName: string): string {
    return `${TEMPLATE_LIBRARY_FOLDER}/${fileName}`;
}

/**
 * Makes sure the library folder exists, creating it if it does not.
 *
 * Idempotent and safe to call on every export: an existing folder is left
 * exactly as it is, including anything the user put there.
 *
 * Returns `null` when the folder is usable afterwards, otherwise the reason it
 * is not — so a caller can refuse to write rather than failing halfway, and
 * can tell the user something more useful than "it did not work".
 */
export async function ensureTemplateLibraryFolder(app: App): Promise<string | null> {
    for (const path of folderChain()) {
        if (app.vault.getFolderByPath(path)) {
            continue;
        }
        try {
            await app.vault.createFolder(path);
        } catch (error) {
            // Losing the race against another create is fine — what matters is
            // that the folder is there now, not who made it.
            if (app.vault.getFolderByPath(path)) {
                continue;
            }
            // Anything else is reported verbatim rather than swallowed. The
            // realistic cause is a folder that already exists under a
            // different casing, which Obsidian's case-sensitive lookup cannot
            // see but the filesystem refuses to create over — and a caller
            // that only knows "it failed" would leave the user with no way to
            // find that out.
            return error instanceof Error ? error.message : String(error);
        }
    }
    return null;
}

/**
 * A path inside the library that is still free, derived from `Name.ocap.json`.
 *
 * Collisions are numbered rather than overwritten: an export never destroys a
 * template the user already has, and the numbering is what makes repeated
 * exports of the same category read as a history.
 */
export function freeTemplateLibraryPath(app: App, fileName: string): string {
    const direct = templateLibraryPath(fileName);
    if (!app.vault.getAbstractFileByPath(direct)) {
        return direct;
    }
    const base = fileName.endsWith(OCAP_TEMPLATE_FILE_EXTENSION)
        ? fileName.slice(0, -OCAP_TEMPLATE_FILE_EXTENSION.length)
        : fileName;
    for (let n = 1; n < 1000; n += 1) {
        const candidate = templateLibraryPath(
            `${base} ${n}${OCAP_TEMPLATE_FILE_EXTENSION}`
        );
        if (!app.vault.getAbstractFileByPath(candidate)) {
            return candidate;
        }
    }
    return templateLibraryPath(`${base} ${Date.now()}${OCAP_TEMPLATE_FILE_EXTENSION}`);
}

/**
 * Whether a vault file is a template file by name.
 *
 * Case-insensitive, because the extension is not always ours by the time we
 * see it: a zip round trip, a copy from a case-normalizing filesystem or a
 * sync client can hand back `Research.OCAP.JSON`. Refusing it would hide a
 * file the user can plainly see in the folder.
 */
export function isTemplateFile(file: { name?: string }): boolean {
    return (file.name ?? '').toLowerCase().endsWith(OCAP_TEMPLATE_FILE_EXTENSION);
}

/** The display name of a template file: its own name without the extension. */
export function templateDisplayName(file: { name?: string }): string {
    const name = file.name ?? '';
    return isTemplateFile(file)
        ? name.slice(0, -OCAP_TEMPLATE_FILE_EXTENSION.length)
        : name;
}

/**
 * Every template in the library, sorted by name.
 *
 * Deliberately NOT a vault-wide search: the library is a defined handover
 * folder, so a stray `.ocap.json` sitting next to a note is not offered as
 * something to import. Direct children only — a subfolder the user makes is
 * their own filing, not part of the list.
 *
 * Sorting is locale-aware and numeric so `Research 2` precedes `Research 10`,
 * and it is total: names inside one folder are unique, so the order is stable
 * across calls. It compares the DISPLAYED name rather than the file name —
 * otherwise the extension takes part in the comparison and `Research 2` sorts
 * ahead of `Research`, splitting an export from its own numbered siblings.
 */
export function listTemplateFiles(app: App): TFile[] {
    const folder = app.vault.getFolderByPath(TEMPLATE_LIBRARY_FOLDER);
    if (!folder) {
        return [];
    }
    const files = folder.children.filter(
        (child): child is TFile => child instanceof TFile && isTemplateFile(child)
    );
    return files.sort((a, b) =>
        NAME_ORDER.compare(templateDisplayName(a), templateDisplayName(b))
    );
}
