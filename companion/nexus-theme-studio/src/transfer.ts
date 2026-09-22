// transfer.ts
// A profile as a file, and back.
//
// The scope is deliberately one profile, not the whole plugin state: an export
// is something the user hands to a future self or another vault, and "here is
// the palette I was working on" is that. "Here is my entire editor, including
// which profile I had selected" is not.
//
// It is not a theme format. It cannot describe a theme, it cannot be read by
// Obsidian, and it converts nothing from anywhere else. It is this plugin's
// overrides, named, with enough header to refuse the wrong file.

import { sanitizeOverrides, type TokenOverrides } from './overrides';
import { normalizeName, type NexusProfile } from './profiles';

/** The format marker. A file without exactly this is not one of ours. */
export const PROFILE_FORMAT = 'nexus-theme-profile';

/** The format version, bumped only by a change a v1 reader could not survive. */
export const PROFILE_FORMAT_VERSION = 1;

/** The extension suggested when saving one. */
export const PROFILE_FILE_SUFFIX = '.nexus-theme-profile.json';

export interface ProfileDocument {
    format: typeof PROFILE_FORMAT;
    formatVersion: number;
    name: string;
    overrides: TokenOverrides;
    scratchCss?: string;
}

/** One profile as the text of a file. */
export function exportProfile(profile: NexusProfile): string {
    const document: ProfileDocument = {
        format: PROFILE_FORMAT,
        formatVersion: PROFILE_FORMAT_VERSION,
        name: profile.name,
        overrides: { ...profile.overrides },
    };
    // Omitted rather than exported empty: scratch CSS is a development note,
    // and an export that always carries an empty one invites the reader to
    // think it is part of the palette.
    if (profile.scratchCss.trim().length > 0) document.scratchCss = profile.scratchCss;
    return `${JSON.stringify(document, null, 2)}\n`;
}

export type ParseResult =
    | { ok: true; document: ProfileDocument }
    | { ok: false; reason: string };

/**
 * Reads a file back, refusing anything that is not one of ours.
 *
 * Three levels of strictness, and they are different on purpose:
 *
 *   - the FORMAT marker and a newer FORMAT VERSION are refused outright, with a
 *     reason the user can act on;
 *   - UNKNOWN FIELDS are ignored, so a file written by a later version that
 *     only ADDED something still imports;
 *   - unknown or invalid OVERRIDES are dropped by `sanitizeOverrides`, so a
 *     file naming a token this build does not have imports the rest.
 *
 * The import never throws. A bad file produces a message, not a broken editor.
 */
export function parseProfileDocument(text: string): ParseResult {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return { ok: false, reason: 'That is not JSON.' };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, reason: 'That file does not contain a profile object.' };
    }
    const record = raw as Record<string, unknown>;
    if (record.format !== PROFILE_FORMAT) {
        return {
            ok: false,
            reason: `That is not a ${PROFILE_FORMAT} file.`,
        };
    }
    const version = record.formatVersion;
    if (typeof version !== 'number' || !Number.isFinite(version)) {
        return { ok: false, reason: 'That profile has no usable format version.' };
    }
    if (version > PROFILE_FORMAT_VERSION) {
        return {
            ok: false,
            reason: `That profile was written by a newer version (format ${version}).`,
        };
    }
    const name = normalizeName(record.name);
    if (!name) return { ok: false, reason: 'That profile has no name.' };

    const scratchCss = typeof record.scratchCss === 'string' ? record.scratchCss : undefined;
    const document: ProfileDocument = {
        format: PROFILE_FORMAT,
        formatVersion: version,
        name,
        overrides: sanitizeOverrides(record.overrides),
    };
    if (scratchCss !== undefined) document.scratchCss = scratchCss;
    return { ok: true, document };
}

/** A file name that says what it holds without needing the file open. */
export function profileFileName(profile: NexusProfile): string {
    const slug = profile.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `${slug || 'profile'}${PROFILE_FILE_SUFFIX}`;
}
