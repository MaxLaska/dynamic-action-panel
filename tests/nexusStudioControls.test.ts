// Tests for the interaction pass on the Nexus Theme Studio.
//
// Everything here came out of using the editor rather than reading it: a reset
// arrow that did nothing, a colour picker whose changes only landed after it
// was dismissed, three tokens that were text fields while the other eight were
// pickers, and a settings page with no way to say which surface a control
// belongs to.
//
// What can be tested without a browser is the part that was actually wrong:
// where the state lives, when it is re-read, what a CSS colour parses to, and
// that the locator has no path to a file. The native colour dialog and the
// screen sampler are the operating system's, and are not simulated here.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { NEXUS_TOKENS, nexusToken } from '../theme/nexus/src/tokens';
import {
    alphaToPercent,
    formatColorValue,
    parseColorValue,
    percentToAlpha,
    roundAlpha,
} from '../companion/nexus-theme-studio/src/colorValue';
import {
    eyedropperAvailable,
    pickScreenColor,
} from '../companion/nexus-theme-studio/src/eyedropper';
import {
    LOCATOR_COLOR,
    effectiveValue,
    isOverridden,
    overrideDeclarations,
    withPreview,
} from '../companion/nexus-theme-studio/src/overrides';
import {
    FIRST_PROFILE_ID,
    activeProfile,
    defaultSettings,
    isGroupCollapsed,
    normalizeSettings,
    setActiveProfile,
    setGroupCollapsed,
    setOverride,
} from '../companion/nexus-theme-studio/src/profiles';
import { applyTokenOverrides } from '../companion/nexus-theme-studio/src/runtime';

const SPLITTER_HOVER = nexusToken('splitterHover')!;
const SPLITTER_IDLE = nexusToken('splitterIdle')!;
const WORKSPACE = nexusToken('workspaceSurface')!;
const SECOND = nexusToken('documentSurface')!;

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

describe('a CSS colour becomes a swatch and an opacity', () => {
    it.each([
        ['#abc', '#aabbcc', 1],
        ['#AABBCC', '#aabbcc', 1],
        ['#aabbcc80', '#aabbcc', 0.5],
        ['#abcd', '#aabbcc', 0.87],
        ['rgb(255, 255, 255)', '#ffffff', 1],
        ['rgba(255, 255, 255, 0.28)', '#ffffff', 0.28],
        ['rgba(255,255,255,.28)', '#ffffff', 0.28],
        ['rgb(255 255 255 / 45%)', '#ffffff', 0.45],
        ['rgb(100% 0% 0%)', '#ff0000', 1],
        ['  #333333  ', '#333333', 1],
        ['transparent', '#000000', 0],
    ])('reads %s', (input, hex, alpha) => {
        const parsed = parseColorValue(input);
        expect(parsed?.hex).toBe(hex);
        expect(parsed?.alpha).toBe(alpha);
    });

    // Not a CSS colour engine. Anything it cannot take apart keeps its text
    // field and loses its swatch, rather than being rewritten into something
    // this module happens to understand.
    it.each([
        ['color-mix(in oklch, #333333 90%, #88aaff 10%)'],
        ['var(--background-secondary)'],
        ['oklch(0.5 0.1 200)'],
        ['rebeccapurple'],
        ['#12345'],
        ['#1234567'],
        ['rgb(1, 2)'],
        ['rgb(1, 2, 3, 4, 5)'],
        ['rgb(1 2 3 / 4 / 5)'],
        ['rgb(a, b, c)'],
        [''],
        ['   '],
    ])('answers null for %s rather than guessing', (input) => {
        expect(parseColorValue(input)).toBeNull();
    });

    it('never lets a channel or an opacity leave its range', () => {
        expect(parseColorValue('rgba(999, -20, 30, 5)')).toEqual({ hex: '#ff001e', alpha: 1 });
        expect(parseColorValue('rgba(0, 0, 0, -1)')).toEqual({ hex: '#000000', alpha: 0 });
    });
});

describe('a swatch and an opacity become a CSS colour', () => {
    // Fully opaque comes back as plain hex, not `rgba(…, 1)`: the defaults are
    // written in hex, so a token dragged to full opacity ends up textually
    // equal to its default instead of merely equivalent to it.
    it('writes full opacity as plain hex', () => {
        expect(formatColorValue('#334455', 1)).toBe('#334455');
        expect(formatColorValue('#334455', 1.5)).toBe('#334455');
    });

    it('writes anything else as rgba', () => {
        expect(formatColorValue('#ffffff', 0.28)).toBe('rgba(255, 255, 255, 0.28)');
        expect(formatColorValue('#ffffff', 0)).toBe('rgba(255, 255, 255, 0)');
    });

    it('round-trips the theme\'s own translucent defaults', () => {
        for (const token of NEXUS_TOKENS.filter((entry) => entry.supportsAlpha)) {
            const parsed = parseColorValue(token.defaultValue);
            expect(parsed).not.toBeNull();
            if (!parsed) continue;
            expect(formatColorValue(parsed.hex, parsed.alpha)).toBe(token.defaultValue);
        }
    });

    it('round-trips every opaque default as well', () => {
        for (const token of NEXUS_TOKENS.filter((entry) => !entry.supportsAlpha)) {
            const parsed = parseColorValue(token.defaultValue);
            expect(parsed).not.toBeNull();
            if (!parsed) continue;
            expect(formatColorValue(parsed.hex, parsed.alpha)).toBe(token.defaultValue);
        }
    });

    it('moves between the slider\'s percent and a stored opacity', () => {
        expect(alphaToPercent(0.28)).toBe(28);
        expect(alphaToPercent(0)).toBe(0);
        expect(alphaToPercent(1)).toBe(100);
        expect(percentToAlpha(28)).toBe(0.28);
        expect(percentToAlpha(0)).toBe(0);
        expect(percentToAlpha(100)).toBe(1);
        expect(percentToAlpha(500)).toBe(1);
        expect(percentToAlpha(-5)).toBe(0);
    });

    it('stores an opacity at the precision the slider can express', () => {
        expect(roundAlpha(0.123456)).toBe(0.12);
        expect(roundAlpha(2)).toBe(1);
        expect(roundAlpha(-1)).toBe(0);
    });

    // The whole point of the alpha control: a value that used to be a text
    // field is now a colour and a percentage, and comes back as the same CSS.
    it('turns white at 28 percent back into the splitter default', () => {
        const parsed = parseColorValue(SPLITTER_HOVER.defaultValue)!;
        expect(parsed.hex).toBe('#ffffff');
        expect(alphaToPercent(parsed.alpha)).toBe(28);
        expect(formatColorValue(parsed.hex, percentToAlpha(28))).toBe(
            SPLITTER_HOVER.defaultValue
        );
    });
});

describe('the registry says which tokens have an opacity', () => {
    it('marks exactly the tokens whose default is translucent', () => {
        for (const token of NEXUS_TOKENS) {
            const parsed = parseColorValue(token.defaultValue);
            const translucent = parsed !== null && parsed.alpha < 1;
            expect(token.supportsAlpha === true).toBe(translucent);
        }
    });

    // A transient state cannot be located by painting it: nothing is being
    // hovered while you hover the settings row for "hover".
    it('gives the transient splitter states something visible to light up', () => {
        expect(SPLITTER_HOVER.locateAlso).toContain('splitterIdle');
        for (const token of NEXUS_TOKENS) {
            for (const key of token.locateAlso ?? []) {
                expect(nexusToken(key)).not.toBeNull();
            }
        }
    });
});

describe('the locator paints a token and then stops', () => {
    const overrides = { [WORKSPACE.key]: '#111111', [SECOND.key]: '#222222' };

    it('replaces only the previewed token, leaving the rest alone', () => {
        const declarations = overrideDeclarations(overrides);
        const previewed = withPreview(declarations, [WORKSPACE.cssVariable]);
        expect(previewed).toContainEqual([WORKSPACE.cssVariable, LOCATOR_COLOR]);
        expect(previewed).toContainEqual([SECOND.cssVariable, '#222222']);
        expect(previewed.filter(([name]) => name === WORKSPACE.cssVariable)).toHaveLength(1);
    });

    it('paints a token the profile does not override at all', () => {
        const previewed = withPreview([], [SPLITTER_IDLE.cssVariable]);
        expect(previewed).toEqual([[SPLITTER_IDLE.cssVariable, LOCATOR_COLOR]]);
    });

    it('paints several tokens at once, for a transient state', () => {
        const previewed = withPreview([], [
            SPLITTER_HOVER.cssVariable,
            SPLITTER_IDLE.cssVariable,
        ]);
        expect(previewed).toHaveLength(2);
        for (const [, value] of previewed) expect(value).toBe(LOCATOR_COLOR);
    });

    // The restore path. Clearing is a re-apply of the profile, which is a pure
    // function of that profile, so there is no snapshot to get out of step.
    it('leaves exactly the profile behind when the preview ends', () => {
        const declarations = overrideDeclarations(overrides);
        expect(withPreview(declarations, [])).toEqual(declarations);
    });

    it('restores the applied state byte for byte after a preview', () => {
        const body = fakeBody();
        const declarations = overrideDeclarations(overrides);
        applyTokenOverrides(body, withPreview(declarations, []));
        const before = new Map(body.properties);

        applyTokenOverrides(body, withPreview(declarations, [WORKSPACE.cssVariable]));
        expect(body.properties.get(WORKSPACE.cssVariable)).toBe(LOCATOR_COLOR);

        applyTokenOverrides(body, withPreview(declarations, []));
        expect(body.properties).toEqual(before);
    });

    // A token with no override at all has to go back to having no override,
    // not to "the value it had while being previewed".
    it('leaves no property behind for a token that was never overridden', () => {
        const body = fakeBody();
        applyTokenOverrides(body, withPreview([], [SPLITTER_IDLE.cssVariable]));
        expect(body.properties.get(SPLITTER_IDLE.cssVariable)).toBe(LOCATOR_COLOR);
        applyTokenOverrides(body, withPreview([], []));
        expect(body.properties.size).toBe(0);
    });

    it('does not mutate the declarations it was handed', () => {
        const declarations = overrideDeclarations(overrides);
        const snapshot = JSON.stringify(declarations);
        withPreview(declarations, [WORKSPACE.cssVariable]);
        expect(JSON.stringify(declarations)).toBe(snapshot);
    });
});

describe('the locator cannot reach the stored profile', () => {
    const main = readFileSync('companion/nexus-theme-studio/src/main.ts', 'utf8');

    // Structural, not a promise in a comment: the preview lives in a runtime
    // field, and the only method that saves does not read it.
    it('keeps the preview out of the settings object entirely', () => {
        const settings = defaultSettings();
        expect(Object.keys(settings)).not.toContain('previewVariables');
        expect(JSON.stringify(settings)).not.toContain(LOCATOR_COLOR);
    });

    it('never saves from the preview path', () => {
        // Anchored on the signature: `setPreview([])` is also CALLED in
        // `onload`, and the first occurrence is not the method.
        const setPreview = main.slice(
            main.indexOf('setPreview(variables: readonly string[]): void'),
            main.indexOf('hasPreview(): boolean')
        );
        expect(setPreview.length).toBeGreaterThan(0);
        expect(setPreview).not.toContain('saveData');
        expect(setPreview).not.toContain('this.settings =');
    });

    // An explicit change outranks a hover: a stored change while a preview is
    // up would leave the locator colour sitting on the token just edited. Both
    // write paths go through `adopt`, so there is one place this can be true.
    it('drops the preview when something real is written', () => {
        const adopt = main.slice(main.indexOf('private adopt('));
        expect(adopt.slice(0, adopt.indexOf('\n    }'))).toContain(
            'this.previewVariables = []'
        );
        for (const method of ['async update(', 'updateLive(']) {
            const body = main.slice(main.indexOf(method));
            expect(body.slice(0, body.indexOf('\n    }'))).toContain('this.adopt(next)');
        }
    });

    // The pointer can leave a row by the view closing rather than by moving.
    // The behaviour is pinned in tests/nexusStudioView.test.ts; this pins that
    // the view's own close path is where it happens.
    it('clears the preview when the view is closed', () => {
        const view = readFileSync('companion/nexus-theme-studio/src/view.ts', 'utf8');
        const close = view.slice(view.indexOf('protected async onClose('));
        const body = close.slice(0, close.indexOf('\n    }'));
        expect(body).toContain('this.panel?.dispose()');
        expect(body).toContain('setPreview([])');
    });

    it('clears the preview before sampling the screen', () => {
        const row = readFileSync('companion/nexus-theme-studio/src/tokenRow.ts', 'utf8');
        const pipette = row.slice(row.indexOf('const onPipette'));
        const body = pipette.slice(0, pipette.indexOf('\n    };'));
        expect(body.indexOf('host.preview(null)')).toBeGreaterThan(-1);
        expect(body.indexOf('host.preview(null)')).toBeLessThan(body.indexOf('pickScreenColor'));
    });

    // Views close in an order the plugin does not control. One that closes
    // after `onunload` must not put the overrides back on a workspace whose
    // plugin is gone.
    it('refuses to re-apply anything once the plugin has unloaded', () => {
        const unload = main.slice(main.indexOf('onunload(): void'));
        const unloadBody = unload.slice(0, unload.indexOf('\n    }'));
        // First thing, before anything that could trigger a view to close.
        expect(unloadBody.indexOf('this.unloaded = true')).toBeGreaterThan(-1);
        expect(unloadBody.indexOf('this.unloaded = true')).toBeLessThan(
            unloadBody.indexOf('clearTokenOverrides')
        );
        for (const method of ['applyActiveProfile(): void', 'setPreview(variables']) {
            const body = main.slice(main.indexOf(method));
            expect(body.slice(0, body.indexOf('\n    }'))).toContain('if (this.unloaded) return;');
        }
    });
});

describe('a per-token reset touches one token', () => {
    it('clears that token and leaves every other override alone', () => {
        let settings = setOverride(defaultSettings(), FIRST_PROFILE_ID, WORKSPACE.key, '#111111');
        settings = setOverride(settings, FIRST_PROFILE_ID, SECOND.key, '#222222');

        const reset = setOverride(settings, FIRST_PROFILE_ID, WORKSPACE.key, null);
        const profile = activeProfile(reset);

        expect(isOverridden(profile.overrides, WORKSPACE.key)).toBe(false);
        expect(effectiveValue(profile.overrides, WORKSPACE.key)).toBe(WORKSPACE.defaultValue);
        expect(profile.overrides[SECOND.key]).toBe('#222222');
    });

    it('removes the override rather than storing the default', () => {
        let settings = setOverride(defaultSettings(), FIRST_PROFILE_ID, WORKSPACE.key, '#111111');
        settings = setOverride(settings, FIRST_PROFILE_ID, WORKSPACE.key, null);
        expect(Object.keys(activeProfile(settings).overrides)).not.toContain(WORKSPACE.key);
    });

    it('takes the property back off the applied state', () => {
        const body = fakeBody();
        let settings = setOverride(defaultSettings(), FIRST_PROFILE_ID, WORKSPACE.key, '#111111');
        applyTokenOverrides(body, overrideDeclarations(activeProfile(settings).overrides));
        expect(body.properties.get(WORKSPACE.cssVariable)).toBe('#111111');

        settings = setOverride(settings, FIRST_PROFILE_ID, WORKSPACE.key, null);
        applyTokenOverrides(body, overrideDeclarations(activeProfile(settings).overrides));
        expect(body.properties.has(WORKSPACE.cssVariable)).toBe(false);
    });

    it('survives a restart as an absent override', () => {
        let settings = setOverride(defaultSettings(), FIRST_PROFILE_ID, WORKSPACE.key, '#111111');
        settings = setOverride(settings, FIRST_PROFILE_ID, SECOND.key, '#222222');
        settings = setOverride(settings, FIRST_PROFILE_ID, WORKSPACE.key, null);
        const restored = normalizeSettings(JSON.parse(JSON.stringify(settings)));
        const profile = activeProfile(restored);
        expect(profile.overrides[WORKSPACE.key]).toBeUndefined();
        expect(profile.overrides[SECOND.key]).toBe('#222222');
    });

    it('resetting a token that was never overridden changes nothing', () => {
        const settings = setOverride(defaultSettings(), FIRST_PROFILE_ID, SECOND.key, '#222222');
        const reset = setOverride(settings, FIRST_PROFILE_ID, WORKSPACE.key, null);
        expect(activeProfile(reset).overrides).toEqual(activeProfile(settings).overrides);
    });

    // The actual bug: the arrow's enabled state was computed once, at render,
    // and a write deliberately does not re-render. So it stayed disabled after
    // the token gained an override, and the click did nothing.
    it('re-syncs every row after a write instead of trusting the render', () => {
        const panel = readFileSync('companion/nexus-theme-studio/src/studioPanel.ts', 'utf8');
        const write = panel.slice(panel.indexOf('private write('));
        expect(write.slice(0, write.indexOf('\n    }'))).toContain('this.sync()');
    });

    // Belt and braces: the behaviour must not depend on a CSS class having been
    // applied, because that is what failed the first time.
    it('checks for an override in the click handler as well as in the state', () => {
        const row = readFileSync('companion/nexus-theme-studio/src/tokenRow.ts', 'utf8');
        const reset = row.slice(row.indexOf('const onReset'));
        expect(reset.slice(0, reset.indexOf('\n    };'))).toContain('!host.isOverridden(token)');
    });
});

describe('the colour picker is live', () => {
    const row = readFileSync('companion/nexus-theme-studio/src/tokenRow.ts', 'utf8');

    // Obsidian's ColorComponent registers `change` only, and `change` on a
    // native colour input does not arrive until the picker is dismissed. That
    // is the whole of the report; owning the element is the fix.
    it('listens for input, not only for change', () => {
        expect(row).toContain("picker.addEventListener('input'");
        expect(row).toContain("picker.addEventListener('change'");
    });

    it('does not use the component that only hears change', () => {
        // Asserted against the CODE: the comment above the swatch names
        // `addColorPicker` precisely to explain why it is not used.
        const code = row.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code).not.toContain('addColorPicker');
    });

    // A native range input streams `input` while it is dragged — the live
    // behaviour Obsidian's SliderComponent needed `setInstant(true)` for.
    it('listens to the opacity slider while it moves', () => {
        expect(row).toContain("alpha?.addEventListener('input'");
        expect(row).toContain("type: 'range'");
    });

    // Moving the picker on `rgba(255,255,255,0.28)` must keep the 0.28 rather
    // than silently making the splitter opaque.
    it('keeps the current opacity when only the colour moves', () => {
        const parsed = parseColorValue(SPLITTER_HOVER.defaultValue)!;
        expect(formatColorValue('#ff0000', parsed.alpha)).toBe('rgba(255, 0, 0, 0.28)');
    });
});

describe('the screen sampler is offered only where it exists', () => {
    it('detects the API structurally rather than by version', () => {
        expect(eyedropperAvailable({} as unknown as Window)).toBe(false);
        expect(
            eyedropperAvailable({ EyeDropper: class {} } as unknown as Window)
        ).toBe(true);
        expect(
            eyedropperAvailable({ EyeDropper: 'nope' } as unknown as Window)
        ).toBe(false);
    });

    it('answers null where the API is missing, instead of throwing', async () => {
        await expect(pickScreenColor({} as unknown as Window)).resolves.toBeNull();
    });

    it('returns the sampled colour', async () => {
        const win = {
            EyeDropper: class {
                open(): Promise<{ sRGBHex: string }> {
                    return Promise.resolve({ sRGBHex: '#AABBCC' });
                }
            },
        } as unknown as Window;
        await expect(pickScreenColor(win)).resolves.toBe('#aabbcc');
    });

    // Escape rejects with AbortError. That is a normal outcome, not a failure,
    // and it must leave the value alone.
    it('answers null when the user cancels', async () => {
        const win = {
            EyeDropper: class {
                open(): Promise<{ sRGBHex: string }> {
                    return Promise.reject(new Error('AbortError'));
                }
            },
        } as unknown as Window;
        await expect(pickScreenColor(win)).resolves.toBeNull();
    });

    it.each([
        ['a missing field', {}],
        ['a non-string', { sRGBHex: 3 }],
        ['something that is not a colour', { sRGBHex: 'rgb(1,2,3)' }],
    ])('answers null for %s in the result', async (_label, result) => {
        const win = {
            EyeDropper: class {
                open(): Promise<unknown> {
                    return Promise.resolve(result);
                }
            },
        } as unknown as Window;
        await expect(pickScreenColor(win)).resolves.toBeNull();
    });

    // The magnifier is Chromium's and cannot be restyled, so there must be no
    // code here pretending otherwise.
    it('draws no sampler UI of its own', () => {
        const source = readFileSync('companion/nexus-theme-studio/src/eyedropper.ts', 'utf8');
        const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code).not.toContain('createEl');
        expect(code).not.toContain('canvas');
    });
});

describe('a group can be folded without losing anything', () => {
    it('starts with everything open', () => {
        expect(defaultSettings().collapsedGroups).toEqual([]);
        expect(isGroupCollapsed(defaultSettings(), 'workspace')).toBe(false);
    });

    it('folds and unfolds one group', () => {
        const folded = setGroupCollapsed(defaultSettings(), 'workspace', true);
        expect(isGroupCollapsed(folded, 'workspace')).toBe(true);
        expect(isGroupCollapsed(folded, 'text')).toBe(false);
        expect(isGroupCollapsed(setGroupCollapsed(folded, 'workspace', false), 'workspace')).toBe(
            false
        );
    });

    it('never records a group twice', () => {
        let settings = setGroupCollapsed(defaultSettings(), 'workspace', true);
        settings = setGroupCollapsed(settings, 'workspace', true);
        expect(settings.collapsedGroups).toEqual(['workspace']);
    });

    // Folding is a view state. It must not touch a single value.
    it('changes no override and no profile', () => {
        const settings = setOverride(defaultSettings(), FIRST_PROFILE_ID, WORKSPACE.key, '#111111');
        const folded = setGroupCollapsed(settings, 'workspace', true);
        expect(folded.profiles).toEqual(settings.profiles);
        expect(folded.activeProfileId).toBe(settings.activeProfileId);
        expect(overrideDeclarations(activeProfile(folded).overrides)).toEqual(
            overrideDeclarations(activeProfile(settings).overrides)
        );
    });

    it('survives a restart', () => {
        const folded = setGroupCollapsed(defaultSettings(), 'interaction', true);
        const restored = normalizeSettings(JSON.parse(JSON.stringify(folded)));
        expect(isGroupCollapsed(restored, 'interaction')).toBe(true);
    });

    it.each([
        ['a missing field', {}],
        ['not an array', { collapsedGroups: 'workspace' }],
        ['entries that are not strings', { collapsedGroups: [1, null, 'text'] }],
    ])('reads %s without failing the load', (_label, raw) => {
        const restored = normalizeSettings({ ...raw, profiles: [] });
        expect(Array.isArray(restored.collapsedGroups)).toBe(true);
        for (const group of restored.collapsedGroups) expect(typeof group).toBe('string');
    });

    // Which sections are folded is how you are working, not what you are
    // working on. Switching profile must not reshuffle the page.
    it('is carried through every profile operation', () => {
        const folded = setGroupCollapsed(defaultSettings(), 'workspace', true);
        const switched = setActiveProfile(folded, 'standard');
        expect(isGroupCollapsed(switched, 'workspace')).toBe(true);
        const edited = setOverride(folded, FIRST_PROFILE_ID, WORKSPACE.key, '#111111');
        expect(isGroupCollapsed(edited, 'workspace')).toBe(true);
    });

    // The fold is the `hidden` attribute on the group body. A later `display`
    // rule on that element would silently beat the user-agent `[hidden]` rule,
    // which is exactly how a fold becomes "nothing happens" with no error —
    // so the stylesheet restates it, with enough weight to win.
    it('keeps a folded body hidden whatever else styles it', () => {
        const css = readFileSync('companion/nexus-theme-studio/styles.css', 'utf8');
        expect(css).toContain('.nexus-studio .nexus-studio-group-body[hidden]');
        const rule = css.slice(css.indexOf('.nexus-studio .nexus-studio-group-body[hidden]'));
        expect(rule.slice(0, rule.indexOf('}'))).toContain('display: none');
    });

    // The click, the keys and the announced state are pinned against a real
    // DOM in tests/nexusStudioView.test.ts. This pins the shape they rely on.
    it('makes the header a real button with a state to announce', () => {
        const panel = readFileSync('companion/nexus-theme-studio/src/studioPanel.ts', 'utf8');
        const group = panel.slice(panel.indexOf('private renderGroup('));
        const body = group.slice(0, group.indexOf('\n    }'));
        expect(body).toContain("cls: 'nexus-studio-group-header'");
        expect(body).toContain("'aria-expanded'");
        expect(body).toContain("addEventListener('keydown'");
        expect(body).toContain('event.preventDefault()');
    });
});

describe('the swatch has room for its own focus ring', () => {
    const css = readFileSync('companion/nexus-theme-studio/styles.css', 'utf8');

    /** One rule's body, by its exact selector. */
    const ruleOf = (selector: string): string => {
        const block = css.slice(css.indexOf(`${selector} {`));
        return block.slice(0, block.indexOf('}'));
    };

    // The clipped ring belonged to Obsidian's styling of a native colour input,
    // which is 4px too short for its own wrapper padding. The visible circle is
    // now our own element and the ring a box-shadow on it, drawn for pointer
    // hover and for keyboard focus of the input inside.
    it('draws the ring on our own element, for hover and for keyboard focus', () => {
        expect(css).toContain('.nexus-studio-swatch:hover');
        expect(css).toContain('.nexus-studio-swatch:has(.nexus-studio-picker:focus-visible)');
    });

    // Nothing between the swatch and the edge of the panel may clip it.
    it('clips nothing around the swatch', () => {
        for (const selector of ['.nexus-studio-row {', '.nexus-studio-group {', '.nexus-studio {']) {
            const block = css.slice(css.indexOf(selector));
            expect(block.slice(0, block.indexOf('}'))).not.toContain('overflow');
        }
    });

    // Obsidian styles every `input[type="color"]` with its own width and
    // height. The invisible picker has to cover the whole circle, so our rule
    // must outweigh that one.
    it('stretches the invisible picker across the whole circle', () => {
        const rule = ruleOf('.nexus-studio .nexus-studio-swatch input.nexus-studio-picker');
        expect(rule).toContain('inset: 0');
        expect(rule).toContain('width: 100%');
        expect(rule).toContain('height: 100%');
        expect(rule).toContain('opacity: 0');
    });

    // The raw CSS field is no longer a permanent 16em column. The compact
    // readout that replaced it keeps one width on every row.
    it('keeps the value readout compact and the same on every row', () => {
        const rule = ruleOf('.nexus-studio .nexus-studio-value');
        expect(rule).toContain('min-width: 8ch');
        expect(css).not.toContain('width: 16em');
    });
});

describe('the rows are still built from the registry', () => {
    it('names no token in the row code, the panel or the view', () => {
        for (const file of ['studioPanel.ts', 'tokenRow.ts', 'view.ts']) {
            const source = readFileSync(`companion/nexus-theme-studio/src/${file}`, 'utf8');
            for (const token of NEXUS_TOKENS) {
                expect(source).not.toContain(token.cssVariable);
                expect(source).not.toContain(`'${token.key}'`);
            }
        }
    });

    it('decides the opacity control from the table, not from a list', () => {
        const row = readFileSync('companion/nexus-theme-studio/src/tokenRow.ts', 'utf8');
        expect(row).toContain('token.supportsAlpha');
        const panel = readFileSync('companion/nexus-theme-studio/src/studioPanel.ts', 'utf8');
        expect(panel).toContain('token.locateAlso');
    });
});

describe('a drag repaints every frame but is written once', () => {
    const main = readFileSync('companion/nexus-theme-studio/src/main.ts', 'utf8');
    const panel = readFileSync('companion/nexus-theme-studio/src/studioPanel.ts', 'utf8');

    // A colour picker emits an `input` per frame. Applying each one is the
    // point; saving each one would be a hundred writes of `data.json` for one
    // decision about one grey.
    it('defers the save for a continuous edit, and applies it at once', () => {
        const live = main.slice(main.indexOf('updateLive(next'));
        const body = live.slice(0, live.indexOf('\n    }'));
        expect(body).toContain('this.adopt(next)');
        expect(body).toContain('setTimeout');
        expect(body).not.toContain('await this.saveData');
    });

    it('writes immediately for a discrete action', () => {
        const update = main.slice(main.indexOf('async update(next'));
        const body = update.slice(0, update.indexOf('\n    }'));
        expect(body).toContain('await this.saveData');
        expect(body).toContain('clearTimeout');
    });

    it('uses the deferred path for the token controls', () => {
        const write = panel.slice(panel.indexOf('private write('));
        expect(write.slice(0, write.indexOf('\n    }'))).toContain('updateLive(');
    });

    // Folding a section is not a colour change. It must not re-send every
    // token to every reader, and it must not wait for a debounce either.
    it('saves UI state without touching the theme', () => {
        const ui = main.slice(main.indexOf('async updateUi(next'));
        const body = ui.slice(0, ui.indexOf('\n    }'));
        expect(body).toContain('await this.saveData');
        expect(body).not.toContain('adopt(');
        expect(body).not.toContain('applyActiveProfile');
    });

    // The difference between "the last edit is saved" and "the last edit is
    // saved unless you were quick".
    it('flushes a pending save when the plugin unloads', () => {
        const unload = main.slice(main.indexOf('onunload(): void'));
        expect(unload.slice(0, unload.indexOf('\n    }'))).toContain('this.flushSave()');
        const flush = main.slice(main.indexOf('private flushSave()'));
        expect(flush.slice(0, flush.indexOf('\n    }'))).toContain('this.saveData(this.settings)');
    });
});
