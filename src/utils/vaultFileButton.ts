// vaultFileButton.ts
// Pure mapping from a vault file to the tool created for it.
//
// This is the whole decision layer of the "drag a file from Obsidian's file
// explorer onto an empty slot" gesture: what the tool is called, which of the
// EXISTING actions it gets and with which parameters. It is deliberately free
// of Obsidian runtime objects so it can be unit-tested directly; reading the
// drag itself lives in src/utils/obsidianFileDrag.ts and the persistence in
// src/hooks/useSlotFileDrop.ts.
//
// No new action type is introduced here: a dropped file maps onto `file`
// (Open file) or `script` (Run script), exactly as the button modal would have
// configured it by hand.

import { normalizePath } from 'obsidian';
import type { ButtonAction } from '@/types/action';

/** The minimum an Obsidian TFile has to offer for this mapping. */
export interface DroppedVaultFile {
    /** Vault-relative path including the extension. */
    path: string;
    /** File name without the extension. */
    basename: string;
    /** Extension without the dot (Obsidian stores it lower-case). */
    extension: string;
}

export type VaultFileButtonMapping = 'file' | 'script';

export interface VaultFileButtonDraft {
    /** Tool name: the file's basename, without folders or extension. */
    name: string;
    /**
     * Obsidian icon id. Resolved to the SVG markup stored in
     * `ButtonConfig.icon` by the caller (the icon picker does the same).
     */
    iconId: string;
    action: ButtonAction;
    mapping: VaultFileButtonMapping;
    /**
     * A `.js` file that could NOT become a Run script tool because it lies
     * outside the configured script folder — the only place ScriptService
     * resolves script names against. It becomes an Open file tool instead and
     * the caller says why, rather than writing a script name that would fail
     * at run time.
     */
    scriptFolderMismatch: boolean;
}

/** A folder setting that means "the vault root". */
function isVaultRoot(folder: string): boolean {
    return folder === '' || folder === '/' || folder === '.';
}

/**
 * The `scriptName` the EXISTING `script` action needs for this file, or null
 * when the file is not reachable that way.
 *
 * ScriptService resolves a script as `<scriptFolderPath>/<scriptName>`, so the
 * stored name is relative to the configured script folder — not a vault path.
 * A file below that folder therefore yields the remaining path; a file outside
 * it has no representable name at all (`../` is not resolved), which is the
 * one case this mapping reports instead of guessing.
 */
export function resolveScriptName(
    filePath: string,
    scriptFolderPath: string | undefined
): string | null {
    const path = normalizePath(filePath);
    const raw = (scriptFolderPath ?? '').trim();
    const folder = raw === '' ? '' : normalizePath(raw);
    if (isVaultRoot(folder)) {
        return path;
    }
    const prefix = `${folder}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/** Icon id for a file the plugin opens; `file` is the neutral default. */
function openFileIconId(extension: string): string {
    return extension === 'md' ? 'file-text' : 'file';
}

function openFileDraft(file: DroppedVaultFile, name: string, mismatch: boolean): VaultFileButtonDraft {
    return {
        name,
        iconId: openFileIconId(file.extension.toLowerCase()),
        action: { type: 'file', parameters: { filePath: file.path } },
        mapping: 'file',
        scriptFolderMismatch: mismatch,
    };
}

/**
 * The tool a dropped vault file becomes.
 *
 * - `.js` inside the configured script folder -> the existing `script` action
 *   (Run script) with the script name that folder expects;
 * - `.js` outside it -> `file`, flagged, because Run script cannot address it;
 * - everything else -> the existing `file` action (Open file) with the exact
 *   vault path, which is what Open file already accepts for any file type.
 */
export function buildVaultFileButtonDraft(
    file: DroppedVaultFile,
    options: { scriptFolderPath?: string } = {}
): VaultFileButtonDraft {
    const name = file.basename.trim() || file.path;

    if (file.extension.toLowerCase() !== 'js') {
        return openFileDraft(file, name, false);
    }

    const scriptName = resolveScriptName(file.path, options.scriptFolderPath);
    if (scriptName === null) {
        return openFileDraft(file, name, true);
    }
    return {
        name,
        iconId: 'file-code',
        action: { type: 'script', parameters: { scriptName } },
        mapping: 'script',
        scriptFolderMismatch: false,
    };
}
