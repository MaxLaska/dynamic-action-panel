// Tests for the Nexus colour library (colorLibrary.ts): pure functions, no DOM.
//
// Two memories — RECENT, automatic and bounded; SAVED, deliberate and
// permanent — and a palette file. The settings layer (profiles.ts) only stores
// what these return, and is checked here for persistence and migration.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_PALETTE_NAME,
    PALETTE_FORMAT,
    PALETTE_FORMAT_VERSION,
    RECENT_LIMIT,
    SAVED_LIMIT,
    addSaved,
    canonicalColor,
    mergeSaved,
    paletteAsCssVariables,
    paletteFileName,
    parsePalette,
    pushRecent,
    readColorList,
    removeSaved,
    replaceSaved,
    sameColor,
    serializePalette,
} from '../companion/nexus-theme-studio/src/colorLibrary';
import { PROFILE_FORMAT } from '../companion/nexus-theme-studio/src/transfer';
import {
    FIRST_PROFILE_ID,
    SETTINGS_VERSION,
    STANDARD_PROFILE_ID,
    addSwatch,
    defaultSettings,
    importSwatches,
    normalizeSettings,
    recordRecent,
    setActiveProfile,
    setOverride,
} from '../companion/nexus-theme-studio/src/profiles';

const RED = '#ff0000';
const GREEN = '#00ff00';
const BLUE = '#0000ff';
const YELLOW = '#ffff00';

describe('colour identity', () => {
    it('is the canonical RGBA, whatever the spelling', () => {
        expect(canonicalColor('#FFF')).toBe('#ffffff');
        expect(canonicalColor('rgb(255,255,255)')).toBe('#ffffff');
        expect(canonicalColor('rgba(255, 255, 255, 1)')).toBe('#ffffff');
        expect(canonicalColor('hsl(0, 0%, 100%)')).toBe('#ffffff');
        expect(sameColor('#ffffff', 'rgb(255 255 255 / 100%)')).toBe(true);
    });

    it('includes alpha: translucent white is another colour', () => {
        expect(canonicalColor('rgba(255,255,255,0.5)')).toBe('rgba(255, 255, 255, 0.5)');
        expect(sameColor('rgba(255,255,255,0.5)', '#ffffff')).toBe(false);
    });

    it('is not defined for what is not a colour', () => {
        expect(canonicalColor('color-mix(in srgb, red, blue)')).toBeNull();
        expect(sameColor('var(--x)', 'var(--x)')).toBe(false);
    });
});

describe('recent colours', () => {
    it('put the first commit in', () => {
        expect(pushRecent([], RED)).toEqual([RED]);
    });

    it('put the newest on the left', () => {
        let recent = pushRecent([], BLUE);
        recent = pushRecent(recent, GREEN);
        recent = pushRecent(recent, RED);
        recent = pushRecent(recent, YELLOW);
        expect(recent).toEqual([YELLOW, RED, GREEN, BLUE]);
    });

    it('move a colour used again to the front instead of doubling it', () => {
        expect(pushRecent([RED, GREEN, BLUE], BLUE)).toEqual([BLUE, RED, GREEN]);
    });

    it('recognise the same colour in another spelling', () => {
        expect(pushRecent([RED, '#ffffff'], 'rgb(255, 255, 255)')).toEqual(['#ffffff', RED]);
    });

    it('keep translucent and opaque apart', () => {
        expect(pushRecent(['#ffffff'], 'rgba(255,255,255,0.5)')).toEqual(['rgba(255, 255, 255, 0.5)', '#ffffff']);
    });

    it('hold at most the limit, dropping the oldest on the right', () => {
        expect(RECENT_LIMIT).toBe(16);
        let recent: string[] = [];
        for (let i = 0; i < RECENT_LIMIT + 3; i += 1) recent = pushRecent(recent, `#0000${i.toString(16).padStart(2, '0')}`);
        expect(recent).toHaveLength(RECENT_LIMIT);
        expect(recent[0]).toBe('#000012');
        expect(recent).not.toContain('#000000');
        expect(recent).not.toContain('#000002');
        expect(recent.at(-1)).toBe('#000003');
    });

    it('ignore what is not a colour, and say "no change" by returning the same list', () => {
        const recent = [RED];
        expect(pushRecent(recent, 'var(--x)')).toBe(recent);
        expect(pushRecent(recent, RED)).toBe(recent);
    });
});

describe('saved colours', () => {
    it('add at the end, canonical', () => {
        expect(addSaved([RED], 'rgb(0, 255, 0)')).toEqual({ saved: [RED, GREEN], index: 1, changed: true });
    });

    it('never hold a colour twice, and say where it already is', () => {
        const saved = [RED, GREEN];
        expect(addSaved(saved, '#0f0')).toEqual({ saved, index: 1, changed: false });
    });

    it('keep alpha', () => {
        expect(addSaved([], 'rgba(255,255,255,0.28)').saved).toEqual(['rgba(255, 255, 255, 0.28)']);
    });

    it('refuse a non-colour and a full palette', () => {
        expect(addSaved([], 'nope').index).toBe(-1);
        const full = Array.from({ length: SAVED_LIMIT }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`);
        expect(addSaved(full, RED)).toEqual({ saved: full, index: -1, changed: false });
    });

    it('replace in place, and refuse a replace that would duplicate', () => {
        expect(replaceSaved([RED, GREEN], 0, BLUE)).toEqual([BLUE, GREEN]);
        const saved = [RED, GREEN];
        expect(replaceSaved(saved, 0, GREEN)).toBe(saved);
        expect(replaceSaved(saved, 5, BLUE)).toBe(saved);
    });

    it('remove one', () => {
        expect(removeSaved([RED, GREEN, BLUE], 1)).toEqual([RED, BLUE]);
        const saved = [RED];
        expect(removeSaved(saved, 3)).toBe(saved);
    });

    it('merge without removing anything or doubling anything', () => {
        const result = mergeSaved([RED, GREEN], ['#f00', BLUE, 'rgba(0,0,255,0.5)']);
        expect(result.saved).toEqual([RED, GREEN, BLUE, 'rgba(0, 0, 255, 0.5)']);
        expect(result).toMatchObject({ added: 2, alreadySaved: 1, overflow: 0 });
    });

    it('report what did not fit', () => {
        const almost = Array.from({ length: SAVED_LIMIT - 1 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`);
        expect(mergeSaved(almost, [RED, GREEN])).toMatchObject({ added: 1, overflow: 1 });
    });
});

describe('a stored list is read fail-soft', () => {
    it('drops non-strings, non-colours and duplicates, keeps order, canonicalises, caps', () => {
        expect(readColorList([RED, 3, 'nope', '#F00', 'rgba(0,0,0,.5)', null], 10)).toEqual([RED, 'rgba(0, 0, 0, 0.5)']);
        expect(readColorList('not a list', 10)).toEqual([]);
        expect(readColorList([RED, GREEN, BLUE], 2)).toEqual([RED, GREEN]);
    });
});

// --- the settings -------------------------------------------------------------------

describe('the library in the settings', () => {
    // A real v3 file, as the smoke vault had it after round 6.
    const v3 = {
        version: 3,
        activeProfileId: 'custom',
        profiles: [
            { id: 'standard', name: 'Standard', overrides: {}, scratchCss: '', scratchEnabled: false },
            { id: 'custom', name: 'Custom', overrides: { workspaceSurface: '#00ff08' }, scratchCss: '', scratchEnabled: false },
        ],
        collapsedGroups: [],
        savedSwatches: ['#002fff', '#00ff08'],
        pickerFormat: 'hex',
    };

    it('reads a v3 file with its saved colours intact and no recent colours yet', () => {
        const settings = normalizeSettings(v3);
        expect(settings.savedSwatches).toEqual(['#002fff', '#00ff08']);
        expect(settings.recentColors).toEqual([]);
        expect(settings.version).toBe(3);
        expect(SETTINGS_VERSION).toBe(3);
    });

    it('reads a damaged recent list without failing', () => {
        expect(normalizeSettings({ ...v3, recentColors: 'x' }).recentColors).toEqual([]);
        expect(normalizeSettings({ ...v3, recentColors: [RED, 1, RED, 'nope'] }).recentColors).toEqual([RED]);
    });

    it('keeps both across a restart', () => {
        let settings = recordRecent(normalizeSettings(v3), 'rgba(1, 2, 3, 0.4)');
        settings = addSwatch(settings, BLUE);
        const restored = normalizeSettings(JSON.parse(JSON.stringify(settings)));
        expect(restored.recentColors).toEqual(['rgba(1, 2, 3, 0.4)']);
        expect(restored.savedSwatches).toEqual(['#002fff', '#00ff08', BLUE]);
    });

    it('keeps both global: a profile switch or edit changes neither', () => {
        let settings = recordRecent(addSwatch(defaultSettings(), RED), GREEN);
        settings = setActiveProfile(settings, STANDARD_PROFILE_ID);
        settings = setOverride(setActiveProfile(settings, FIRST_PROFILE_ID), FIRST_PROFILE_ID, 'workspaceSurface', '#123456');
        expect(settings.savedSwatches).toEqual([RED]);
        expect(settings.recentColors).toEqual([GREEN]);
        expect(JSON.stringify(settings.profiles)).not.toContain(GREEN);
    });

    it('returns the same settings when nothing changed, so nothing is saved', () => {
        const settings = addSwatch(defaultSettings(), RED);
        expect(addSwatch(settings, '#f00')).toBe(settings);
        expect(recordRecent(recordRecent(settings, RED), RED)).toEqual(recordRecent(settings, RED));
        const once = recordRecent(settings, RED);
        expect(recordRecent(once, RED)).toBe(once);
        expect(importSwatches(settings, [RED]).settings).toBe(settings);
    });

    it('imports into saved only: no token, no profile, no recent', () => {
        const before = recordRecent(setOverride(defaultSettings(), FIRST_PROFILE_ID, 'workspaceSurface', '#111111'), RED);
        const { settings } = importSwatches(before, [GREEN, BLUE]);
        expect(settings.savedSwatches).toEqual([GREEN, BLUE]);
        expect(settings.profiles).toEqual(before.profiles);
        expect(settings.recentColors).toEqual(before.recentColors);
        expect(settings.activeProfileId).toBe(before.activeProfileId);
    });
});

// --- the palette file ---------------------------------------------------------------

describe('a palette as a file', () => {
    const colors = ['#333333', 'rgba(255, 255, 255, 0.28)'];

    it('is versioned JSON with a name and the saved colours, exactly', () => {
        const text = serializePalette('My palette', colors);
        const document = JSON.parse(text) as Record<string, unknown>;
        expect(document).toEqual({
            format: PALETTE_FORMAT,
            version: PALETTE_FORMAT_VERSION,
            name: 'My palette',
            colors: [{ value: '#333333' }, { value: 'rgba(255, 255, 255, 0.28)' }],
        });
        expect(PALETTE_FORMAT).toBe('nexus-color-palette');
    });

    it('round-trips every colour, alpha included', () => {
        const parsed = parsePalette(serializePalette('x', colors));
        expect(parsed).toEqual({ ok: true, name: 'x', colors, invalid: 0 });
    });

    it('falls back to a default name', () => {
        expect((JSON.parse(serializePalette('   ', [])) as { name: string }).name).toBe(DEFAULT_PALETTE_NAME);
        expect(paletteFileName('My Palette!')).toBe('my-palette.nexus-color-palette.json');
    });

    it('is not a profile, and a profile is not a palette', () => {
        expect(PALETTE_FORMAT).not.toBe(PROFILE_FORMAT);
        const profile = JSON.stringify({ format: PROFILE_FORMAT, formatVersion: 1, name: 'p', overrides: {} });
        expect(parsePalette(profile)).toMatchObject({ ok: false });
    });

    it.each([
        ['not JSON', '{nope', /not JSON/],
        ['an array', '[]', /palette object/],
        ['another format', JSON.stringify({ format: 'x', version: 1, colors: [] }), /not a nexus-color-palette/],
        ['no version', JSON.stringify({ format: PALETTE_FORMAT, colors: [] }), /no usable version/],
        ['a newer version', JSON.stringify({ format: PALETTE_FORMAT, version: 2, colors: [] }), /newer version/],
        ['no colour list', JSON.stringify({ format: PALETTE_FORMAT, version: 1 }), /no colour list/],
    ])('refuses %s, with a reason', (_label, text, reason) => {
        const parsed = parsePalette(text);
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.reason).toMatch(reason);
    });

    it('skips an entry that is not a colour, and counts it', () => {
        const text = JSON.stringify({
            format: PALETTE_FORMAT,
            version: 1,
            name: 'mixed',
            colors: [{ value: '#123456' }, { value: 'color-mix(in srgb, red, blue)' }, 'bare', { value: 3 }, { value: 'RGB(1,2,3)' }],
        });
        expect(parsePalette(text)).toEqual({ ok: true, name: 'mixed', colors: ['#123456', '#010203'], invalid: 3 });
    });

    it('can be copied as CSS variables, which are not the palette', () => {
        expect(paletteAsCssVariables(colors)).toBe(
            '--nexus-palette-01: #333333;\n--nexus-palette-02: rgba(255, 255, 255, 0.28);'
        );
    });

    // Reusable means no DOM and no Obsidian in the module itself.
    it('lives in a module with no DOM, no Obsidian and no settings in it', () => {
        const source = readFileSync('companion/nexus-theme-studio/src/colorLibrary.ts', 'utf8');
        const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code).not.toMatch(/from 'obsidian'|document\.|window\.|HTMLElement|profiles'/);
        expect(code.match(/^import .*$/gm)).toEqual(["import { parseRgba, rgbaToCss } from './colorValue';"]);
    });
});
