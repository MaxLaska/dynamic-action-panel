// colorLibrary.ts
// The Nexus colour library: what the user used recently, and what they kept.
//
// TWO MEMORIES, deliberately separate:
//
//   RECENT — automatic and bounded. The colours the user actually committed,
//            newest first, at most RECENT_LIMIT. Nobody adds to it by hand and
//            nobody tidies it; the oldest simply falls off the end.
//   SAVED  — deliberate and permanent. Colours the user chose to keep. Nothing
//            is ever added or removed here without an explicit action.
//
// One list that tried to be history, library and active colour at once was the
// model this replaces.
//
// This file is pure: strings in, strings out, no DOM, no Obsidian, no settings
// object. The colour picker is one client; anything else in Nexus that wants
// the same palette uses the same functions. It is not a service and holds no
// state.
//
// COLOUR IDENTITY. Two entries are the same colour when their canonical RGBA
// is the same — so `#ffffff`, `rgb(255,255,255)` and `rgba(255,255,255,1)` are
// one colour, and `rgba(255,255,255,0.5)` is another: alpha is part of the
// colour. Entries are STORED in the canonical form (`#rrggbb`, or `rgba()` below
// full opacity), which is the same form every token value is written in.
//
// FLAT ON PURPOSE. Groups may come later; nothing here assumes they will, and
// nothing here would stop them — a group would be a named list of these same
// canonical strings.

import { parseRgba, rgbaToCss } from './colorValue';

/** How many recent colours are kept. Two rows in the picker; enough for a session. */
export const RECENT_LIMIT = 16;

/** How many saved colours are kept. A working palette, not an archive. */
export const SAVED_LIMIT = 48;

/** A colour in its one stored form, or null when it is not a colour. */
export function canonicalColor(value: string): string | null {
    const colour = parseRgba(value);
    return colour ? rgbaToCss(colour) : null;
}

/** Whether two values are the same colour, alpha included. */
export function sameColor(a: string, b: string): boolean {
    const left = canonicalColor(a);
    return left !== null && left === canonicalColor(b);
}

/**
 * A stored list read fail-soft: non-strings and non-colours dropped, each
 * entry canonical, duplicates dropped (the first one stays), at most `limit`.
 * A value's TEXT may change here (`rgb(255,255,255)` becomes `#ffffff`); its
 * colour never does.
 */
export function readColorList(raw: unknown, limit: number): string[] {
    if (!Array.isArray(raw)) return [];
    const result: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        const colour = canonicalColor(entry);
        if (!colour || result.includes(colour)) continue;
        result.push(colour);
        if (result.length >= limit) break;
    }
    return result;
}

// --- recent -------------------------------------------------------------------------

/**
 * Records a committed colour: to the front, any earlier copy removed, the
 * oldest dropped past the limit. A non-colour (Custom CSS) is not recorded.
 * Returns the SAME array when nothing changes, so a caller can tell.
 */
export function pushRecent(recent: readonly string[], value: string, limit = RECENT_LIMIT): string[] {
    const colour = canonicalColor(value);
    if (!colour) return recent as string[];
    if (recent[0] === colour) return recent as string[];
    return [colour, ...recent.filter((entry) => entry !== colour)].slice(0, limit);
}

// --- saved --------------------------------------------------------------------------

/** What adding a colour did: the list, and where the colour is in it. */
export interface SavedChange {
    saved: string[];
    /** Where the colour is now, or -1 when it could not be kept. */
    index: number;
    /** False when the list is the same array as before. */
    changed: boolean;
}

/**
 * Keeps a colour. Already saved (by colour, not by spelling): nothing changes,
 * and `index` says where it is. Full, or not a colour: nothing changes, -1.
 */
export function addSaved(saved: readonly string[], value: string, limit = SAVED_LIMIT): SavedChange {
    const colour = canonicalColor(value);
    const same = saved as string[];
    if (!colour) return { saved: same, index: -1, changed: false };
    const existing = saved.indexOf(colour);
    if (existing >= 0) return { saved: same, index: existing, changed: false };
    if (saved.length >= limit) return { saved: same, index: -1, changed: false };
    return { saved: [...saved, colour], index: saved.length, changed: true };
}

/** Replaces one saved colour in place. Refused if it would duplicate another. */
export function replaceSaved(saved: readonly string[], index: number, value: string): string[] {
    const colour = canonicalColor(value);
    const same = saved as string[];
    if (!colour || index < 0 || index >= saved.length) return same;
    if (saved[index] === colour) return same;
    if (saved.some((entry, at) => at !== index && entry === colour)) return same;
    return saved.map((entry, at) => (at === index ? colour : entry));
}

/** Removes one saved colour. */
export function removeSaved(saved: readonly string[], index: number): string[] {
    if (index < 0 || index >= saved.length) return saved as string[];
    return saved.filter((_, at) => at !== index);
}

/** What a merge did, in numbers the user can be told. */
export interface MergeResult {
    saved: string[];
    added: number;
    alreadySaved: number;
    /** Colours that did not fit under the limit. */
    overflow: number;
}

/** Adds colours to the end, skipping what is already there. Never removes anything. */
export function mergeSaved(saved: readonly string[], incoming: readonly string[], limit = SAVED_LIMIT): MergeResult {
    let next = [...saved];
    let added = 0;
    let alreadySaved = 0;
    let overflow = 0;
    for (const value of incoming) {
        const result = addSaved(next, value, limit);
        if (result.changed) {
            next = result.saved;
            added += 1;
        } else if (result.index >= 0) {
            alreadySaved += 1;
        } else {
            overflow += 1;
        }
    }
    return { saved: added > 0 ? next : (saved as string[]), added, alreadySaved, overflow };
}

// --- a palette as a file ------------------------------------------------------------
//
// The saved colours, named, with enough header to refuse the wrong file. Not a
// profile: a profile is token overrides (`nexus-theme-profile`), a palette is
// colours to work with, and neither format can be mistaken for the other.
// Recent colours are not exported: they are a working memory, not something
// to hand on.

export const PALETTE_FORMAT = 'nexus-color-palette';
export const PALETTE_FORMAT_VERSION = 1;
export const PALETTE_FILE_SUFFIX = '.nexus-color-palette.json';
export const DEFAULT_PALETTE_NAME = 'Nexus palette';

export interface PaletteDocument {
    format: typeof PALETTE_FORMAT;
    version: number;
    name: string;
    colors: Array<{ value: string }>;
}

/** The longest palette name kept. */
const MAX_PALETTE_NAME = 80;

function paletteName(raw: unknown): string {
    if (typeof raw !== 'string') return DEFAULT_PALETTE_NAME;
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_PALETTE_NAME);
    return name || DEFAULT_PALETTE_NAME;
}

/** The saved colours as the text of a file. */
export function serializePalette(name: string, colors: readonly string[]): string {
    const document: PaletteDocument = {
        format: PALETTE_FORMAT,
        version: PALETTE_FORMAT_VERSION,
        name: paletteName(name),
        colors: colors.map((value) => ({ value })),
    };
    return `${JSON.stringify(document, null, 2)}\n`;
}

export type PaletteParseResult =
    | { ok: true; name: string; colors: string[]; invalid: number }
    | { ok: false; reason: string };

/**
 * Reads a palette file. The format and a newer version are refused with a
 * reason; an entry that is not a colour is skipped and COUNTED, so the user is
 * told rather than surprised. Never throws.
 */
export function parsePalette(text: string): PaletteParseResult {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return { ok: false, reason: 'That is not JSON.' };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, reason: 'That does not contain a palette object.' };
    }
    const record = raw as Record<string, unknown>;
    if (record.format !== PALETTE_FORMAT) return { ok: false, reason: `That is not a ${PALETTE_FORMAT} file.` };
    const version = record.version;
    if (typeof version !== 'number' || !Number.isFinite(version)) {
        return { ok: false, reason: 'That palette has no usable version.' };
    }
    if (version > PALETTE_FORMAT_VERSION) {
        return { ok: false, reason: `That palette was written by a newer version (version ${version}).` };
    }
    if (!Array.isArray(record.colors)) return { ok: false, reason: 'That palette has no colour list.' };
    const colors: string[] = [];
    let invalid = 0;
    for (const entry of record.colors) {
        const value =
            entry && typeof entry === 'object' && !Array.isArray(entry)
                ? (entry as Record<string, unknown>).value
                : undefined;
        const colour = typeof value === 'string' ? canonicalColor(value) : null;
        if (colour) colors.push(colour);
        else invalid += 1;
    }
    return { ok: true, name: paletteName(record.name), colors, invalid };
}

/** A file name that says what it holds. */
export function paletteFileName(name: string): string {
    const slug = paletteName(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `${slug || 'palette'}${PALETTE_FILE_SUFFIX}`;
}

/**
 * The saved colours as CSS custom properties, for pasting into a snippet. A
 * convenience copy, not a storage form: the JSON is the palette.
 */
export function paletteAsCssVariables(colors: readonly string[]): string {
    return colors
        .map((value, index) => `--nexus-palette-${String(index + 1).padStart(2, '0')}: ${value};`)
        .join('\n');
}
