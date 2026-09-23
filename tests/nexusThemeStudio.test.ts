// Tests for the Nexus Theme Studio: the profile model, what a token value is
// allowed to be, how an override reaches the screen, and the file format.
//
// Everything here is the part that can be wrong in a way no screenshot reveals.
// Whether #333 is the right grey is a judgement made by looking; whether
// switching profiles leaves four tokens frozen at the previous profile's values
// is not, and that is what this file is for.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { NEXUS_TOKENS, NEXUS_VARIABLES, nexusToken } from '../theme/nexus/src/tokens';
import { buildControlPlan, plannedTokens } from '../companion/nexus-theme-studio/src/controlPlan';
import {
    MAX_VALUE_LENGTH,
    effectiveValue,
    isOverridden,
    isValidTokenValue,
    overrideDeclarations,
    sanitizeOverrides,
} from '../companion/nexus-theme-studio/src/overrides';
import {
    FIRST_PROFILE_ID,
    MAX_NAME_LENGTH,
    STANDARD_PROFILE_ID,
    activeProfile,
    createProfile,
    defaultSettings,
    deleteProfile,
    duplicateProfile,
    isLocked,
    nextProfileId,
    normalizeName,
    normalizeSettings,
    renameProfile,
    resetProfile,
    setActiveProfile,
    setOverride,
    setScratch,
    type NexusStudioSettings,
} from '../companion/nexus-theme-studio/src/profiles';
import {
    SCRATCH_STYLE_ID,
    applyScratchCss,
    applyTokenOverrides,
    clearTokenOverrides,
    removeScratchCss,
} from '../companion/nexus-theme-studio/src/runtime';
import {
    PROFILE_FORMAT,
    PROFILE_FORMAT_VERSION,
    exportProfile,
    parseProfileDocument,
    profileFileName,
} from '../companion/nexus-theme-studio/src/transfer';

/** A token key that certainly exists, taken from the table rather than typed. */
const FIRST_KEY = NEXUS_TOKENS[0]!.key;
const FIRST_VARIABLE = NEXUS_TOKENS[0]!.cssVariable;
const SECOND_KEY = NEXUS_TOKENS[1]!.key;
const SECOND_VARIABLE = NEXUS_TOKENS[1]!.cssVariable;

/** A settings object with one override, for the many tests that need one. */
function withOverride(value = '#123456'): NexusStudioSettings {
    return setOverride(defaultSettings(), FIRST_PROFILE_ID, FIRST_KEY, value);
}

describe('a fresh install can be edited, and can be returned to', () => {
    const settings = defaultSettings();

    // Two profiles rather than one. A locked Standard on its own would mean the
    // very first slider had nowhere to write; an unlocked Standard would stop
    // being a baseline after that same slider.
    it('starts with a locked baseline and something to edit', () => {
        expect(settings.profiles.map((profile) => profile.id)).toEqual([
            STANDARD_PROFILE_ID,
            FIRST_PROFILE_ID,
        ]);
        expect(settings.activeProfileId).toBe(FIRST_PROFILE_ID);
        expect(isLocked(activeProfile(settings))).toBe(false);
    });

    it('starts identical to the theme, so activating it changes nothing', () => {
        for (const profile of settings.profiles) {
            expect(profile.overrides).toEqual({});
            expect(profile.scratchCss).toBe('');
            expect(profile.scratchEnabled).toBe(false);
        }
        expect(overrideDeclarations(activeProfile(settings).overrides)).toEqual([]);
    });

    it('reports every token as unoverridden, and worth the theme\'s value', () => {
        for (const token of NEXUS_TOKENS) {
            expect(isOverridden({}, token.key)).toBe(false);
            expect(effectiveValue({}, token.key)).toBe(token.defaultValue);
        }
    });
});

describe('the baseline stays a baseline', () => {
    const settings = defaultSettings();

    it('refuses an override on it', () => {
        const next = setOverride(settings, STANDARD_PROFILE_ID, FIRST_KEY, '#abcdef');
        expect(activeProfile(setActiveProfile(next, STANDARD_PROFILE_ID)).overrides).toEqual({});
    });

    it('refuses a rename', () => {
        const next = renameProfile(settings, STANDARD_PROFILE_ID, 'Something else');
        expect(next.profiles[0]?.name).toBe(settings.profiles[0]?.name);
    });

    it('refuses a delete', () => {
        expect(deleteProfile(settings, STANDARD_PROFILE_ID).profiles).toHaveLength(2);
    });

    it('refuses scratch CSS', () => {
        const next = setScratch(settings, STANDARD_PROFILE_ID, { css: 'p{}', enabled: true });
        expect(next.profiles[0]?.scratchCss).toBe('');
        expect(next.profiles[0]?.scratchEnabled).toBe(false);
    });

    // Duplicating Standard is the intended way to start editing: an empty,
    // unlocked profile that renders exactly like the theme's defaults.
    it('can be duplicated into something editable', () => {
        const next = duplicateProfile(settings, STANDARD_PROFILE_ID, 'Warm');
        const copy = activeProfile(next);
        expect(isLocked(copy)).toBe(false);
        expect(copy.name).toBe('Warm');
        expect(copy.overrides).toEqual({});
    });

    // The acceptance path: edit, switch to Standard, and the baseline is back.
    it('is the way back to the theme\'s own values', () => {
        const edited = withOverride('#ff0000');
        expect(overrideDeclarations(activeProfile(edited).overrides)).toHaveLength(1);
        const back = setActiveProfile(edited, STANDARD_PROFILE_ID);
        expect(overrideDeclarations(activeProfile(back).overrides)).toEqual([]);
        // And switching back again brings the profile's values with it.
        const forward = setActiveProfile(back, FIRST_PROFILE_ID);
        expect(effectiveValue(activeProfile(forward).overrides, FIRST_KEY)).toBe('#ff0000');
    });
});

describe('profiles can be made, copied, renamed and removed', () => {
    it('creates a profile and makes it active, because creating one is wanting it', () => {
        const next = createProfile(defaultSettings(), 'Cool');
        expect(next.profiles).toHaveLength(3);
        expect(activeProfile(next).name).toBe('Cool');
    });

    it('gives a new profile a free, predictable id', () => {
        const settings = defaultSettings();
        expect(nextProfileId(settings)).toBe('profile-1');
        const next = createProfile(settings, 'Cool');
        expect(nextProfileId(next)).toBe('profile-2');
        expect(new Set(next.profiles.map((p) => p.id)).size).toBe(next.profiles.length);
    });

    it('copies overrides and scratch CSS when duplicating', () => {
        let settings = withOverride('#0a0a0a');
        settings = setScratch(settings, FIRST_PROFILE_ID, { css: 'body{}', enabled: true });
        const next = duplicateProfile(settings, FIRST_PROFILE_ID);
        const copy = activeProfile(next);
        expect(copy.overrides[FIRST_KEY]).toBe('#0a0a0a');
        expect(copy.scratchCss).toBe('body{}');
        expect(copy.scratchEnabled).toBe(true);
        // A copy is a copy: editing it must not reach back into the original.
        const edited = setOverride(next, copy.id, FIRST_KEY, '#ffffff');
        const original = edited.profiles.find((p) => p.id === FIRST_PROFILE_ID);
        expect(original?.overrides[FIRST_KEY]).toBe('#0a0a0a');
    });

    it('never lets two profiles wear the same name', () => {
        let settings = createProfile(defaultSettings(), 'Warm');
        settings = createProfile(settings, 'Warm');
        const names = settings.profiles.map((profile) => profile.name);
        expect(new Set(names).size).toBe(names.length);
        expect(names).toContain('Warm 2');
    });

    it('renames, and refuses a name that is not one', () => {
        const settings = createProfile(defaultSettings(), 'Warm');
        const id = activeProfile(settings).id;
        expect(activeProfile(renameProfile(settings, id, '  Warmer  ')).name).toBe('Warmer');
        expect(activeProfile(renameProfile(settings, id, '   ')).name).toBe('Warm');
        expect(activeProfile(renameProfile(settings, id, 42 as unknown as string)).name).toBe(
            'Warm'
        );
    });

    it('caps a name rather than storing a pasted essay', () => {
        expect(normalizeName('x'.repeat(500))).toHaveLength(MAX_NAME_LENGTH);
        expect(normalizeName('a   b')).toBe('a b');
        expect(normalizeName('')).toBeNull();
        expect(normalizeName(null)).toBeNull();
    });

    // The baseline, never an arbitrary neighbour, so the workspace after a
    // delete is a state the user recognises.
    it('falls back to the baseline when the active profile is deleted', () => {
        const settings = withOverride();
        const next = deleteProfile(settings, FIRST_PROFILE_ID);
        expect(next.activeProfileId).toBe(STANDARD_PROFILE_ID);
        expect(next.profiles.map((p) => p.id)).toEqual([STANDARD_PROFILE_ID]);
    });

    it('leaves the active profile alone when another one is deleted', () => {
        const settings = createProfile(withOverride(), 'Spare');
        const spare = activeProfile(settings).id;
        const back = setActiveProfile(settings, FIRST_PROFILE_ID);
        const next = deleteProfile(back, spare);
        expect(next.activeProfileId).toBe(FIRST_PROFILE_ID);
    });

    it('ignores an unknown id rather than inventing one', () => {
        const settings = defaultSettings();
        expect(setActiveProfile(settings, 'nope')).toBe(settings);
        expect(deleteProfile(settings, 'nope')).toBe(settings);
        expect(duplicateProfile(settings, 'nope')).toBe(settings);
        expect(renameProfile(settings, 'nope', 'x')).toBe(settings);
    });

    // Nothing mutates its argument: the plugin persists what it gets back, and
    // a half-applied in-place edit is the state that survives a crash.
    it('never mutates the settings it was given', () => {
        const settings = defaultSettings();
        const snapshot = JSON.stringify(settings);
        createProfile(settings, 'A');
        setOverride(settings, FIRST_PROFILE_ID, FIRST_KEY, '#111111');
        deleteProfile(settings, FIRST_PROFILE_ID);
        resetProfile(settings, FIRST_PROFILE_ID);
        expect(JSON.stringify(settings)).toBe(snapshot);
    });
});

describe('reset means "forget what I changed", which is why it is safe to press', () => {
    it('clears this profile\'s overrides and scratch CSS', () => {
        let settings = withOverride('#010203');
        settings = setScratch(settings, FIRST_PROFILE_ID, { css: 'p{}', enabled: true });
        const next = resetProfile(settings, FIRST_PROFILE_ID);
        const profile = activeProfile(next);
        expect(profile.overrides).toEqual({});
        expect(profile.scratchCss).toBe('');
        expect(profile.scratchEnabled).toBe(false);
    });

    it('touches no other profile', () => {
        let settings = withOverride('#010203');
        settings = createProfile(settings, 'Other');
        const other = activeProfile(settings).id;
        settings = setOverride(settings, other, FIRST_KEY, '#0f0f0f');
        const next = resetProfile(settings, other);
        const first = next.profiles.find((profile) => profile.id === FIRST_PROFILE_ID);
        expect(first?.overrides[FIRST_KEY]).toBe('#010203');
    });
});

describe('what a token value is allowed to be', () => {
    // Not a colour grammar. Three of the eleven v0.1 tokens are already
    // `rgba()`, and a temperature-based palette wants `color-mix()`.
    it.each([
        '#fff',
        '#334455',
        'rgba(255, 255, 255, 0.1)',
        'hsl(210 12% 20%)',
        'color-mix(in oklch, #333333 90%, #88aaff 10%)',
        'var(--background-secondary)',
        'transparent',
    ])('accepts %s', (value) => {
        expect(isValidTokenValue(value)).toBe(true);
    });

    it.each([
        ['an empty string', ''],
        ['only whitespace', '   '],
        ['a second declaration', '#fff; color: red'],
        ['a closing block', '#fff }'],
        ['an opening block', 'a { color: red'],
        ['markup', '<style>'],
        ['a comment', '#fff /* x */'],
        ['a newline', '#fff\ncolor: red'],
        ['a fetch', 'url(https://example.com/x.png)'],
        ['an unbalanced paren', 'rgba(255, 255, 255'],
        ['a stray closing paren', '255, 255)'],
        ['a number', 16],
        ['null', null],
        ['undefined', undefined],
        ['an object', {}],
    ])('refuses %s', (_label, value) => {
        expect(isValidTokenValue(value)).toBe(false);
    });

    it('refuses a value longer than the cap', () => {
        expect(isValidTokenValue(`#${'a'.repeat(MAX_VALUE_LENGTH)}`)).toBe(false);
        expect(isValidTokenValue('a'.repeat(MAX_VALUE_LENGTH))).toBe(true);
    });

    it('stores the trimmed value, so two spellings of one colour are one value', () => {
        const settings = withOverride('  #123456  ');
        expect(activeProfile(settings).overrides[FIRST_KEY]).toBe('#123456');
    });

    it('clears an override rather than storing a value it would have to refuse', () => {
        let settings = withOverride('#123456');
        settings = setOverride(settings, FIRST_PROFILE_ID, FIRST_KEY, 'red; evil: 1');
        expect(activeProfile(settings).overrides[FIRST_KEY]).toBeUndefined();
    });

    it('clears an override on null', () => {
        let settings = withOverride('#123456');
        settings = setOverride(settings, FIRST_PROFILE_ID, FIRST_KEY, null);
        expect(isOverridden(activeProfile(settings).overrides, FIRST_KEY)).toBe(false);
    });
});

describe('overrides that came off disk', () => {
    // A token that no longer exists must not keep haunting a profile.
    it('drops keys the token table does not have', () => {
        expect(sanitizeOverrides({ [FIRST_KEY]: '#fff', whatever: '#000' })).toEqual({
            [FIRST_KEY]: '#fff',
        });
    });

    it('drops values it would refuse', () => {
        expect(sanitizeOverrides({ [FIRST_KEY]: '#fff}' })).toEqual({});
    });

    it.each([
        ['null', null],
        ['a string', 'nope'],
        ['an array', []],
        ['a number', 7],
    ])('answers with nothing for %s', (_label, raw) => {
        expect(sanitizeOverrides(raw)).toEqual({});
    });

    // A token the profile says nothing about must stay ABSENT. Emitting its
    // default would pin it to the value the theme had when the profile was
    // written, and a later theme update would be silently overridden.
    it('declares only what the profile actually overrides', () => {
        const declarations = overrideDeclarations({ [FIRST_KEY]: '#abcdef' });
        expect(declarations).toEqual([[FIRST_VARIABLE, '#abcdef']]);
    });

    it('declares in table order, so two equal profiles produce equal output', () => {
        const declarations = overrideDeclarations({
            [SECOND_KEY]: '#222222',
            [FIRST_KEY]: '#111111',
        });
        expect(declarations).toEqual([
            [FIRST_VARIABLE, '#111111'],
            [SECOND_VARIABLE, '#222222'],
        ]);
    });
});

describe('settings that came off disk', () => {
    it.each([
        ['null (first run)', null],
        ['undefined', undefined],
        ['an empty object', {}],
        ['a string', 'right'],
        ['a number', 3],
        ['an array', []],
    ])('falls back to a usable state for %s', (_label, raw) => {
        const settings = normalizeSettings(raw);
        expect(settings.profiles.length).toBeGreaterThanOrEqual(2);
        expect(settings.profiles[0]?.id).toBe(STANDARD_PROFILE_ID);
        expect(settings.profiles.some((p) => p.id === settings.activeProfileId)).toBe(true);
    });

    it('survives a round trip through JSON unchanged', () => {
        let settings = withOverride('#0b0b0b');
        settings = createProfile(settings, 'Warm');
        settings = setScratch(settings, activeProfile(settings).id, {
            css: '.x { color: red }',
            enabled: true,
        });
        const restored = normalizeSettings(JSON.parse(JSON.stringify(settings)));
        expect(restored).toEqual(settings);
    });

    // A stored Standard carrying overrides would quietly stop being the
    // baseline it is the only reason to have.
    it('rebuilds the baseline from the constant, whatever the file says', () => {
        const restored = normalizeSettings({
            version: 1,
            activeProfileId: STANDARD_PROFILE_ID,
            profiles: [
                {
                    id: STANDARD_PROFILE_ID,
                    name: 'Hijacked',
                    overrides: { [FIRST_KEY]: '#ff0000' },
                    scratchCss: 'body { display: none }',
                    scratchEnabled: true,
                },
            ],
        });
        const standard = restored.profiles[0]!;
        expect(standard.name).not.toBe('Hijacked');
        expect(standard.overrides).toEqual({});
        expect(standard.scratchCss).toBe('');
        expect(standard.scratchEnabled).toBe(false);
    });

    it('keeps ids unique, so "the active profile" resolves to one profile', () => {
        const restored = normalizeSettings({
            activeProfileId: 'twin',
            profiles: [
                { id: 'twin', name: 'A', overrides: {} },
                { id: 'twin', name: 'B', overrides: {} },
            ],
        });
        expect(restored.profiles.filter((p) => p.id === 'twin')).toHaveLength(1);
    });

    it('points the active id at a profile that exists', () => {
        const restored = normalizeSettings({
            activeProfileId: 'gone',
            profiles: [{ id: 'kept', name: 'Kept', overrides: {} }],
        });
        expect(restored.profiles.some((p) => p.id === restored.activeProfileId)).toBe(true);
    });

    it('always leaves something editable beside the baseline', () => {
        const restored = normalizeSettings({ activeProfileId: '', profiles: [] });
        expect(restored.profiles.length).toBeGreaterThanOrEqual(2);
        expect(isLocked(activeProfile(restored))).toBe(false);
    });

    it('ignores profile entries that are not objects', () => {
        const restored = normalizeSettings({
            activeProfileId: 'a',
            profiles: [null, 3, 'x', { id: 'a', name: 'A', overrides: {} }],
        });
        expect(restored.profiles.map((p) => p.id)).toEqual([STANDARD_PROFILE_ID, 'a']);
    });
});

/** The smallest thing that answers like an element's inline style. */
function fakeBody(): HTMLElement & { readonly properties: Map<string, string> } {
    const properties = new Map<string, string>();
    return {
        properties,
        style: {
            setProperty: (name: string, value: string | null) => {
                properties.set(name, value ?? '');
            },
            removeProperty: (name: string) => {
                properties.delete(name);
            },
        },
    } as unknown as HTMLElement & { readonly properties: Map<string, string> };
}

/** The smallest thing that answers like a document with a head. */
function fakeDocument(): Document & { readonly styles: Array<{ id: string }> } {
    const styles: Array<{ id: string; textContent: string | null; remove(): void }> = [];
    const doc = {
        styles,
        getElementById: (id: string) => styles.find((style) => style.id === id) ?? null,
        createElement: () => {
            const element = {
                id: '',
                textContent: null as string | null,
                remove(): void {
                    const index = styles.indexOf(element);
                    if (index >= 0) styles.splice(index, 1);
                },
            };
            return element;
        },
        head: {
            appendChild: (element: { id: string; textContent: string | null; remove(): void }) => {
                styles.push(element);
            },
        },
    };
    return doc as unknown as Document & { readonly styles: Array<{ id: string }> };
}

describe('an override becomes something you can see', () => {
    it('writes the declared variables as inline properties', () => {
        const body = fakeBody();
        applyTokenOverrides(body, [[FIRST_VARIABLE, '#abcdef']]);
        expect(body.properties.get(FIRST_VARIABLE)).toBe('#abcdef');
    });

    // The half that is not optional. Switching from a profile that overrides
    // six tokens to one that overrides two has to leave four back at the
    // theme's value.
    it('removes every Nexus variable the new profile does not declare', () => {
        const body = fakeBody();
        applyTokenOverrides(body, [
            [FIRST_VARIABLE, '#111111'],
            [SECOND_VARIABLE, '#222222'],
        ]);
        applyTokenOverrides(body, [[SECOND_VARIABLE, '#222222']]);
        expect(body.properties.has(FIRST_VARIABLE)).toBe(false);
        expect(body.properties.get(SECOND_VARIABLE)).toBe('#222222');
    });

    it('visits every Nexus variable, so nothing can be left frozen', () => {
        const body = fakeBody();
        // Seeded through the fake's own map: the point is a body that already
        // carries every variable, however it got them.
        for (const variable of NEXUS_VARIABLES) body.properties.set(variable, 'anything');
        applyTokenOverrides(body, []);
        expect(body.properties.size).toBe(0);
    });

    // A disabled plugin must leave the theme exactly as it found it.
    it('takes every override back off on unload', () => {
        const body = fakeBody();
        applyTokenOverrides(body, [[FIRST_VARIABLE, '#abcdef']]);
        clearTokenOverrides(body);
        expect(body.properties.size).toBe(0);
    });

    it('is idempotent, so applying the same profile twice is one state', () => {
        const body = fakeBody();
        applyTokenOverrides(body, [[FIRST_VARIABLE, '#abcdef']]);
        const once = new Map(body.properties);
        applyTokenOverrides(body, [[FIRST_VARIABLE, '#abcdef']]);
        expect(body.properties).toEqual(once);
    });
});

describe('scratch CSS is one stylesheet, or none', () => {
    it('puts the rules in the document under a pinned id', () => {
        const doc = fakeDocument();
        applyScratchCss(doc, '.x { color: red }');
        expect(doc.styles).toHaveLength(1);
        expect(doc.styles[0]?.id).toBe(SCRATCH_STYLE_ID);
    });

    // A fresh <style> on every keystroke would leave a stack of them behind.
    it('reuses the one element rather than stacking sheets', () => {
        const doc = fakeDocument();
        applyScratchCss(doc, '.x { color: red }');
        applyScratchCss(doc, '.x { color: blue }');
        applyScratchCss(doc, '.x { color: green }');
        expect(doc.styles).toHaveLength(1);
    });

    it.each([
        ['null', null],
        ['an empty string', ''],
        ['only whitespace', '   \n  '],
    ])('takes the sheet out again for %s', (_label, css) => {
        const doc = fakeDocument();
        applyScratchCss(doc, '.x { color: red }');
        applyScratchCss(doc, css);
        expect(doc.styles).toHaveLength(0);
    });

    it('removes it on unload', () => {
        const doc = fakeDocument();
        applyScratchCss(doc, '.x { color: red }');
        removeScratchCss(doc);
        expect(doc.styles).toHaveLength(0);
    });

    it('removing nothing is not an error', () => {
        const doc = fakeDocument();
        expect(() => removeScratchCss(doc)).not.toThrow();
    });
});

describe('the editor can render the whole table', () => {
    const plan = buildControlPlan();

    it('shows every token exactly once', () => {
        const planned = plannedTokens(plan);
        expect(planned.map((token) => token.key).sort()).toEqual(
            NEXUS_TOKENS.map((token) => token.key).sort()
        );
        expect(planned).toHaveLength(NEXUS_TOKENS.length);
    });

    it('groups in a stable order, so the tab does not reshuffle itself', () => {
        expect(buildControlPlan().map((group) => group.group)).toEqual(
            plan.map((group) => group.group)
        );
        for (const group of plan) expect(group.label.trim().length).toBeGreaterThan(0);
    });

    it('drops a group with nothing in it rather than rendering an empty heading', () => {
        const single = NEXUS_TOKENS.filter((token) => token.group === NEXUS_TOKENS[0]!.group);
        const reduced = buildControlPlan(single);
        expect(reduced).toHaveLength(1);
        expect(reduced[0]?.group).toBe(NEXUS_TOKENS[0]!.group);
    });

    // Nothing in the tab may name a token: the whole point is that adding one
    // is a row in the table plus a rule in the theme, never a UI edit.
    it('names no token in the UI code', () => {
        for (const file of ['studioPanel.ts', 'tokenRow.ts', 'view.ts']) {
            const source = readFileSync(`companion/nexus-theme-studio/src/${file}`, 'utf8');
            for (const token of NEXUS_TOKENS) {
                expect(source).not.toContain(token.cssVariable);
                expect(source).not.toContain(`'${token.key}'`);
            }
        }
        const panel = readFileSync('companion/nexus-theme-studio/src/studioPanel.ts', 'utf8');
        expect(panel).toContain('buildControlPlan');
    });
});

describe('a profile as a file, and back', () => {
    const settings = withOverride('#0c0c0c');
    const profile = activeProfile(settings);

    it('exports what the format says it exports', () => {
        const parsed = JSON.parse(exportProfile(profile)) as Record<string, unknown>;
        expect(parsed.format).toBe(PROFILE_FORMAT);
        expect(parsed.formatVersion).toBe(PROFILE_FORMAT_VERSION);
        expect(parsed.name).toBe(profile.name);
        expect(parsed.overrides).toEqual({ [FIRST_KEY]: '#0c0c0c' });
    });

    it('round-trips', () => {
        const result = parseProfileDocument(exportProfile(profile));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.document.name).toBe(profile.name);
        expect(result.document.overrides).toEqual(profile.overrides);
    });

    // Scratch CSS is a development note. An export that always carries an empty
    // one invites the reader to think it is part of the palette.
    it('omits empty scratch CSS and carries a real one', () => {
        const bare = JSON.parse(exportProfile(profile)) as Record<string, unknown>;
        expect(bare.scratchCss).toBeUndefined();
        const withScratch = activeProfile(
            setScratch(settings, profile.id, { css: '.x {}', enabled: true })
        );
        const parsed = parseProfileDocument(exportProfile(withScratch));
        expect(parsed.ok && parsed.document.scratchCss).toBe('.x {}');
    });

    it.each([
        ['not JSON', 'nonsense'],
        ['an array', '[]'],
        ['a bare object', '{}'],
        ['another format', '{"format":"something-else","formatVersion":1,"name":"x"}'],
        ['no version', `{"format":"${PROFILE_FORMAT}","name":"x"}`],
        ['no name', `{"format":"${PROFILE_FORMAT}","formatVersion":1}`],
    ])('refuses %s with a reason rather than throwing', (_label, text) => {
        const result = parseProfileDocument(text);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason.length).toBeGreaterThan(0);
    });

    it('refuses a file from a newer version rather than guessing', () => {
        const result = parseProfileDocument(
            `{"format":"${PROFILE_FORMAT}","formatVersion":${PROFILE_FORMAT_VERSION + 1},"name":"x"}`
        );
        expect(result.ok).toBe(false);
    });

    // A file written by a later version that only ADDED something still
    // imports; a token this build does not have is dropped, not fatal.
    it('ignores fields it does not know, and tokens it does not have', () => {
        const result = parseProfileDocument(
            JSON.stringify({
                format: PROFILE_FORMAT,
                formatVersion: PROFILE_FORMAT_VERSION,
                name: 'From the future',
                somethingNew: { deeply: ['nested'] },
                overrides: { [FIRST_KEY]: '#010101', notAToken: '#020202' },
            })
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.document.overrides).toEqual({ [FIRST_KEY]: '#010101' });
    });

    it('suggests a file name that says what it holds', () => {
        expect(profileFileName({ ...profile, name: 'Warm Grey 2' })).toBe(
            'warm-grey-2.nexus-theme-profile.json'
        );
    });
});

describe('the editor keeps its state to itself', () => {
    const source = readFileSync('companion/nexus-theme-studio/src/main.ts', 'utf8');

    // Theme Studio state belongs in the Theme Studio's own data.json. Not in
    // the panel's, not in ZotFlow's, not in a note, not in the theme's files.
    it('persists through the plugin\'s own loadData and saveData only', () => {
        expect(source).toContain('this.loadData()');
        expect(source).toContain('this.saveData(');
        expect(source).not.toContain('vault.');
        expect(source).not.toContain('adapter');
        expect(source).not.toMatch(/writeFile|fs\./);
    });

    it('cleans up everything it applied when it unloads', () => {
        const unload = source.slice(source.indexOf('onunload'));
        expect(unload).toContain('clearTokenOverrides');
        expect(unload).toContain('removeScratchCss');
    });

    it('declares every token it can override through the table', () => {
        expect(NEXUS_VARIABLES.every((variable) => variable.startsWith('--nexus-'))).toBe(true);
        expect(nexusToken(FIRST_KEY)?.cssVariable).toBe(FIRST_VARIABLE);
    });
});
