// Tests for the studio as a CONTROL PLANE, for typography and for contrast.
//
// The rule these pin: Nexus Theme Studio does not consume the user-editable
// Nexus presentation tokens for its own critical UI. The theme may do anything
// to Obsidian; the tool used to set it back stays readable. The live half —
// that a near-black text token really leaves the studio's text alone in a
// running Obsidian — is scripts/smokeView.mjs; this is the half that keeps the
// stylesheet honest as the theme grows.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    NEXUS_CONTRAST_PAIRS,
    NEXUS_TOKENS,
    NEXUS_VARIABLES,
    nexusToken,
} from '../theme/nexus/src/tokens';
import { parseColorValue } from '../companion/nexus-theme-studio/src/colorValue';
import {
    CONTRAST_LARGE,
    CONTRAST_TEXT,
    composite,
    contrastRatio,
    formatRatio,
    gradeContrast,
    measureContrast,
    relativeLuminance,
} from '../companion/nexus-theme-studio/src/contrast';
import {
    effectiveValue,
    isValidValueFor,
    overrideDeclarations,
    sanitizeOverrides,
} from '../companion/nexus-theme-studio/src/overrides';
import {
    FIRST_PROFILE_ID,
    activeProfile,
    defaultSettings,
    normalizeSettings,
    setOverride,
} from '../companion/nexus-theme-studio/src/profiles';
import { PROBE_SENTINEL } from '../companion/nexus-theme-studio/src/studioPanel';

// Line endings normalised: the working tree may hold CRLF where the repository
// holds LF, and a selector split over two lines must match either way.
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const studioCss = read('companion/nexus-theme-studio/styles.css');
const themeCss = read('theme/nexus/theme.css');
const rulesOnly = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector list is exactly `selector`. */
function declarationsOf(css: string, selector: string): Map<string, string> {
    const rules = rulesOnly(css);
    const at = rules.indexOf(`${selector} {`);
    expect(at).toBeGreaterThanOrEqual(0);
    const body = rules.slice(rules.indexOf('{', at) + 1, rules.indexOf('}', at));
    const map = new Map<string, string>();
    for (const line of body.split(';')) {
        const colon = line.indexOf(':');
        if (colon < 0) continue;
        map.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
    return map;
}

const palette = declarationsOf(studioCss, '.nexus-studio,\n.nexus-studio-isolated');

describe('the studio is a control plane', () => {
    // The invariant that keeps this true as the theme grows: whatever Obsidian
    // variable the theme re-points, the studio re-points back. Adding a theme
    // rule without extending the studio fails here, not in front of the user.
    it('re-points every Obsidian variable the theme re-points', () => {
        const themed = [...rulesOnly(themeCss).matchAll(/(--[a-z0-9-]+)\s*:/g)]
            .map((match) => match[1]!)
            .filter((name) => !name.startsWith('--nexus-'));
        // The one exception, and why: the dock's tab-container colour belongs to
        // the dock's tab strip, and the studio has no tab strip of its own.
        const outside = new Set(['--tab-container-background']);
        const missing = [...new Set(themed)].filter((name) => !outside.has(name) && !palette.has(name));
        expect(missing).toEqual([]);
    });

    it('builds its palette from nothing the user can edit', () => {
        for (const [name, value] of palette) {
            for (const variable of NEXUS_VARIABLES) expect(value).not.toContain(variable);
            if (!name.startsWith('--nexus-studio-')) continue;
            // Obsidian's base palette and default font — never a theme-edited
            // variable like --text-normal or --background-primary.
            const refs = [...value.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!);
            for (const ref of refs) {
                expect(ref).toMatch(/^--(color-base-\d+|font-default|font-interface-override)$/);
            }
        }
    });

    // The base palette is only a safe source for as long as the theme never
    // declares it.
    it('relies on a palette the theme never touches', () => {
        expect(rulesOnly(themeCss)).not.toMatch(/--color-base-\d+\s*:/);
        expect(rulesOnly(themeCss)).not.toMatch(/--font-default\s*:/);
    });

    it('declares every internal tool token it uses', () => {
        for (const name of [
            '--nexus-studio-surface',
            '--nexus-studio-surface-elevated',
            '--nexus-studio-text',
            '--nexus-studio-text-muted',
            '--nexus-studio-border',
            '--nexus-studio-hover',
            '--nexus-studio-focus',
        ]) {
            expect(palette.has(name)).toBe(true);
        }
        const used = new Set([...rulesOnly(studioCss).matchAll(/var\((--nexus-studio-[a-z-]+)/g)].map((m) => m[1]!));
        // Runtime-set properties (a swatch's colour, a font preview, the probe)
        // are set by the code on the element itself.
        const runtime = new Set([
            '--nexus-studio-swatch',
            '--nexus-studio-font-preview',
            '--nexus-studio-probe',
            '--nexus-studio-contrast-ink',
            // The picker's pure hue and its opaque colour, for the square and
            // the opacity bar: content, set by colorPicker.ts per draft.
            '--nexus-studio-cp-hue',
            '--nexus-studio-cp-opaque',
        ]);
        for (const name of used) {
            if (runtime.has(name)) continue;
            expect(palette.has(name)).toBe(true);
        }
    });

    // The studio's tool tokens must never be something the user edits.
    it('keeps its tool tokens out of the editable registry', () => {
        for (const token of NEXUS_TOKENS) expect(token.cssVariable.startsWith('--nexus-studio-')).toBe(false);
    });

    it('paints its own surface, so the dock colour cannot show through', () => {
        const panel = declarationsOf(studioCss, '.nexus-studio');
        expect(panel.get('background-color')).toBe('var(--nexus-studio-surface)');
        expect(panel.get('color')).toBe('var(--nexus-studio-text)');
    });

    // The pick layer shares the palette's variables but must not be painted:
    // a painted shield would be what the sampler reads.
    it('keeps the pick layer transparent', () => {
        const shield = declarationsOf(studioCss, '.nexus-studio-pick-shield');
        expect(shield.get('background')).toBe('transparent');
        expect(palette.has('background-color')).toBe(false);
        expect(palette.has('background')).toBe(false);
    });

    it('draws its menu natively and gives its dialogs the palette', () => {
        const view = readFileSync('companion/nexus-theme-studio/src/view.ts', 'utf8');
        expect(view).toContain('setUseNativeMenu(true)');
        const modals = readFileSync('companion/nexus-theme-studio/src/modals.ts', 'utf8');
        // Every dialog, not a count that the next dialog makes wrong.
        const dialogs = modals.match(/extends Modal \{/g) ?? [];
        expect(dialogs.length).toBeGreaterThanOrEqual(4);
        expect(modals.match(/addClass\('nexus-studio-isolated'\)/g)).toHaveLength(dialogs.length);
    });

    it('keeps the probe sentinel in step with the stylesheet', () => {
        const probe = declarationsOf(studioCss, '.nexus-studio-probe');
        expect(probe.get('color')?.replace(/\s+/g, '')).toBe(PROBE_SENTINEL);
    });
});

describe('typography tokens', () => {
    const family = nexusToken('uiFontFamily')!;
    const size = nexusToken('uiFontSize')!;
    const lineHeight = nexusToken('uiLineHeight')!;

    it('are in the registry, in their own group, with the right kinds', () => {
        expect(family.group).toBe('typography');
        expect(family.controlType).toBe('font-family');
        expect(size.controlType).toBe('length');
        expect(lineHeight.controlType).toBe('number');
        expect(size.range).toEqual({ min: 10, max: 20, step: 0.5, unit: 'px' });
    });

    // Measured, not assumed: these are the hooks Obsidian 1.13.7 gives a theme.
    it('map onto the variables Obsidian gives a theme', () => {
        const rules = rulesOnly(themeCss);
        expect(rules).toContain('--font-interface-theme: var(--nexus-ui-font-family)');
        expect(rules).toContain('--line-height-tight: var(--nexus-ui-line-height)');
        expect(rules).toContain('--font-ui-small: var(--nexus-ui-font-size)');
        for (const step of ['--font-ui-smaller', '--font-ui-medium', '--font-ui-large']) {
            expect(rules).toMatch(new RegExp(`${step}: calc\\(var\\(--nexus-ui-font-size\\) \\* \\d+ / 13\\)`));
        }
    });

    // The default must reproduce Obsidian's own four steps exactly.
    it('reproduce 12/13/15/20px at the default', () => {
        const base = parseFloat(size.defaultValue);
        expect(base).toBe(13);
        const rules = rulesOnly(themeCss);
        const factor = (step: string) => {
            const m = new RegExp(`${step}: calc\\(var\\(--nexus-ui-font-size\\) \\* (\\d+) / 13\\)`).exec(rules)!;
            return Number(m[1]);
        };
        expect((base * factor('--font-ui-smaller')) / 13).toBe(12);
        expect((base * factor('--font-ui-medium')) / 13).toBe(15);
        expect((base * factor('--font-ui-large')) / 13).toBe(20);
    });

    // A font chosen under Appearance must still win over the theme's.
    it('leave the user\'s own interface font alone', () => {
        expect(rulesOnly(themeCss)).not.toContain('--font-interface-override');
        expect(rulesOnly(themeCss)).not.toMatch(/--font-interface\s*:/);
    });

    it('do not reach mobile, where Obsidian derives UI sizes from the text size', () => {
        const rules = rulesOnly(themeCss);
        const block = rules.slice(rules.indexOf('--font-ui-small: var(--nexus-ui-font-size)') - 200);
        expect(block).toContain('body.theme-dark:not(.is-mobile)');
    });

    it('offer suggestions and still take any family list', () => {
        expect((family.suggestions ?? []).length).toBeGreaterThanOrEqual(3);
        expect(family.suggestions?.[0]?.value).toBe(family.defaultValue);
        expect(isValidValueFor(family, '"Inter Variable", "Inter", sans-serif')).toBe(true);
        expect(isValidValueFor(family, 'MyFont, serif')).toBe(true);
        expect(isValidValueFor(family, 'url(https://x/font.woff)')).toBe(false);
    });

    it.each([
        ['13px', true],
        ['14.5px', true],
        ['1rem', true],
        ['0.9em', true],
        ['calc(13px * 1.1)', true],
        ['var(--font-ui-small)', true],
        ['2px', false],
        ['100px', false],
        ['13', false],
        ['abc', false],
        ['13pt', false],
        ['-13px', false],
    ])('size %s is %s', (value, valid) => {
        expect(isValidValueFor(size, value)).toBe(valid);
    });

    it.each([
        ['1.3', true],
        ['1', true],
        ['2.5', true],
        ['calc(1.3 * 1.1)', true],
        ['0.2', false],
        ['9', false],
        ['1.3px', false],
        ['normal', false],
    ])('line height %s is %s', (value, valid) => {
        expect(isValidValueFor(lineHeight, value)).toBe(valid);
    });

    // A font size that is not a length would make every interface text size
    // derived from it invalid at once. It must not get past the store.
    it('refuse an invalid value at the store, falling back to the theme', () => {
        expect(sanitizeOverrides({ uiFontSize: 'huge', uiLineHeight: '1.4' })).toEqual({ uiLineHeight: '1.4' });
        const settings = setOverride(defaultSettings(), FIRST_PROFILE_ID, 'uiFontSize', 'huge');
        expect(activeProfile(settings).overrides.uiFontSize).toBeUndefined();
        expect(effectiveValue(activeProfile(settings).overrides, 'uiFontSize')).toBe('13px');
        expect(overrideDeclarations({ uiFontSize: 'huge' })).toEqual([]);
    });

    it('persist in a profile and survive a restart', () => {
        let settings = setOverride(defaultSettings(), FIRST_PROFILE_ID, 'uiFontSize', '14px');
        settings = setOverride(settings, FIRST_PROFILE_ID, 'uiFontFamily', 'system-ui, sans-serif');
        settings = setOverride(settings, FIRST_PROFILE_ID, 'uiLineHeight', '1.45');
        const restored = normalizeSettings(JSON.parse(JSON.stringify(settings)));
        expect(activeProfile(restored).overrides).toEqual({
            uiFontSize: '14px',
            uiFontFamily: 'system-ui, sans-serif',
            uiLineHeight: '1.45',
        });
        expect(overrideDeclarations(activeProfile(restored).overrides)).toContainEqual([
            '--nexus-ui-font-size',
            '14px',
        ]);
    });

    it('reset one at a time', () => {
        let settings = setOverride(defaultSettings(), FIRST_PROFILE_ID, 'uiFontSize', '14px');
        settings = setOverride(settings, FIRST_PROFILE_ID, 'uiLineHeight', '1.5');
        settings = setOverride(settings, FIRST_PROFILE_ID, 'uiFontSize', null);
        expect(activeProfile(settings).overrides).toEqual({ uiLineHeight: '1.5' });
    });
});

describe('the contrast ratio', () => {
    it('is 21:1 for black on white, either way round', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    });

    it('is 1:1 for a colour on itself', () => {
        for (const colour of ['#000000', '#333333', '#88aaff', '#ffffff']) {
            expect(contrastRatio(colour, colour)).toBeCloseTo(1, 10);
        }
    });

    // Relative luminance by the WCAG definition, not a brightness guess: the
    // green channel weighs ten times the blue.
    it('uses relative luminance, not brightness', () => {
        expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
        expect(relativeLuminance('#000000')).toBe(0);
        expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 4);
        expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 4);
        // Mid grey is not 0.5: the sRGB curve is not linear.
        expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3);
    });

    it('matches known reference pairs', () => {
        // Reference values from the WCAG formula.
        expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
        expect(contrastRatio('#dadada', '#1c1c1c')).toBeGreaterThan(11);
    });

    it('grades at 4.5 for text and 3 for large text', () => {
        expect(CONTRAST_TEXT).toBe(4.5);
        expect(CONTRAST_LARGE).toBe(3);
        expect(gradeContrast(4.5)).toBe('text');
        expect(gradeContrast(4.49)).toBe('large-only');
        expect(gradeContrast(3)).toBe('large-only');
        expect(gradeContrast(2.99)).toBe('too-low');
    });

    // Rounded DOWN, so 4.49 never reads as "4.5" beside a warning.
    it('is shown with one decimal, never rounded up past a threshold', () => {
        expect(formatRatio(21)).toBe('21.0:1');
        expect(formatRatio(4.4999)).toBe('4.4:1');
        expect(formatRatio(7.25)).toBe('7.2:1');
    });

    it('blends translucent text over its surface before measuring', () => {
        expect(composite({ hex: '#ffffff', alpha: 0.5 }, { hex: '#000000', alpha: 1 })).toBe('#808080');
        const result = measureContrast('rgba(255, 255, 255, 0.5)', '#000000');
        expect(result.measured && result.ratio).toBeCloseTo(contrastRatio('#808080', '#000000'), 5);
    });

    it.each([
        ['an unreadable text value', 'color-mix(in oklch, red, blue)', '#000000'],
        ['an unreadable surface', '#ffffff', 'var(--x)'],
        ['a translucent surface', '#ffffff', 'rgba(0, 0, 0, 0.5)'],
    ])('is not guessed for %s', (_label, text, surface) => {
        const result = measureContrast(text, surface);
        expect(result.measured).toBe(false);
        if (!result.measured) expect(result.reason.length).toBeGreaterThan(0);
    });

    it('reads the computed form Chromium gives a resolved color-mix()', () => {
        expect(parseColorValue('color(srgb 0.2 0.4 0.6)')?.hex).toBe('#336699');
        expect(parseColorValue('color(srgb 1 1 1 / 0.5)')).toEqual({ hex: '#ffffff', alpha: 0.5 });
    });
});

describe('the pairs the studio measures', () => {
    it('name only tokens that exist, text against surface', () => {
        for (const pair of NEXUS_CONTRAST_PAIRS) {
            expect(nexusToken(pair.text)?.group).toBe('text');
            expect(['workspace', 'document']).toContain(nexusToken(pair.surface)?.group);
        }
    });

    // The reader draws its own sidebar text; Nexus text never reaches it.
    it('leave out the reader panel, whose text is the reader\'s own', () => {
        expect(NEXUS_CONTRAST_PAIRS.some((pair) => pair.surface === 'readerPanelSurface')).toBe(false);
    });

    it('all pass at the theme defaults', () => {
        for (const pair of NEXUS_CONTRAST_PAIRS) {
            const text = nexusToken(pair.text)!.defaultValue;
            const surface = nexusToken(pair.surface)!.defaultValue;
            const result = measureContrast(text, surface);
            expect(result.measured && result.grade).toBe('text');
        }
    });

    // Contrast assist reports; it never writes. There is no automatic text
    // colour in v0.1 (see DECISIONS.md), so nothing here may call a writer.
    it('change nothing: measuring has no path to the profile', () => {
        const source = read('companion/nexus-theme-studio/src/studioPanel.ts');
        const contrast = source.slice(source.indexOf('private syncContrast()'));
        const end = contrast.indexOf('\n    }\n');
        expect(end).toBeGreaterThan(0);
        const body = contrast.slice(0, end);
        expect(body).not.toMatch(/update(Live|Ui)?\(|setOverride|write\(/);
        const module = read('companion/nexus-theme-studio/src/contrast.ts');
        expect(module).not.toMatch(/import .* from '\.\/(profiles|overrides|runtime)'/);
    });
});
