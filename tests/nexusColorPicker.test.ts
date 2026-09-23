// @vitest-environment happy-dom
//
// Tests for the Nexus colour picker: one colour model, one popover, one
// session, one palette — against a real (happy-dom) document.
//
// The panel is rendered with a host that behaves like the plugin
// (tests/support/nexusStudioHarness.ts), including the draft layer: a picker's
// value is held apart from the settings, exactly as main.ts holds it apart
// from `data.json`. Electron is faked at the one seam the sampler uses.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nexusToken } from '../theme/nexus/src/tokens';
import {
    CUSTOM_CSS_LABEL,
    DRAG_THRESHOLD,
    PICKER_STEP_LARGE,
    insertIndexAt,
    type Box,
} from '../companion/nexus-theme-studio/src/colorPicker';
import {
    CANDIDATE_INTERVAL_MS,
    LOUPE_DX,
    LOUPE_DY,
    LOUPE_SIZE,
    loupePosition,
} from '../companion/nexus-theme-studio/src/sampler';
import {
    describeColor,
    hslToRgba,
    hsvaToRgba,
    parseColorValue,
    parseRgba,
    rgbaToCss,
    rgbaToHsla,
    rgbaToHsva,
    type ColorFormat,
    type Rgba,
} from '../companion/nexus-theme-studio/src/colorValue';
import { overrideDeclarations, withPreview, withSession } from '../companion/nexus-theme-studio/src/overrides';
import {
    FIRST_PROFILE_ID,
    STANDARD_PROFILE_ID,
    activeProfile,
    defaultSettings,
    setActiveProfile,
    setOverride,
    type NexusStudioSettings,
} from '../companion/nexus-theme-studio/src/profiles';
import { LOCATOR_DELAY_MS } from '../companion/nexus-theme-studio/src/tokenRow';
import { fire, mount, type, unmountAll } from './support/nexusStudioHarness';

const WORKSPACE = nexusToken('workspaceSurface')!;
const DOCUMENT = nexusToken('documentSurface')!;
const SPLITTER_HOVER = nexusToken('splitterHover')!;

// --- helpers ---------------------------------------------------------------------

const popovers = () => document.querySelectorAll<HTMLElement>('.nexus-studio-popover');
const popover = () => document.querySelector<HTMLElement>('.nexus-studio-popover');
const inPicker = <T extends Element>(selector: string) => popover()!.querySelector<T>(selector)!;
const field = (name: string) => inPicker<HTMLInputElement>(`.nexus-studio-cp-field[data-field="${name}"]`);
const formatButton = () => inPicker<HTMLButtonElement>('.nexus-studio-cp-format');
/** Clicks the one format button until it shows `format`. */
const cycleTo = (format: string) => {
    for (let i = 0; i < 3 && formatButton().dataset.format !== format; i += 1) formatButton().click();
};

function openFor(ui: ReturnType<typeof mount>, key: string): HTMLElement {
    ui.inRow<HTMLButtonElement>(key, '.nexus-studio-swatch').click();
    return popover()!;
}

function key(target: EventTarget, name: string, shiftKey = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
}

function withSettings(mutate: (settings: NexusStudioSettings) => NexusStudioSettings): NexusStudioSettings {
    return mutate(defaultSettings());
}

const override = (ui: ReturnType<typeof mount>, tokenKey: string) => activeProfile(ui.settings).overrides[tokenKey];

/**
 * Fakes the Electron seam and a decoder that reads `pixel` under any point.
 * The pixel can be changed between samples; captures are counted.
 */
function installCapture(start: [number, number, number, number]) {
    const pixel = [...start];
    let captures = 0;
    const wc = {
        getZoomFactor: () => 1,
        capturePage: () => {
            captures += 1;
            return Promise.resolve({ toPNG: () => new Uint8Array(), getSize: () => ({ width: 1, height: 1 }) });
        },
        inspectElement: () => undefined,
        debugger: {
            isAttached: () => false,
            attach: () => undefined,
            detach: () => undefined,
            sendCommand: () => Promise.resolve({}),
            on: () => undefined,
            removeListener: () => undefined,
        },
    };
    (window as unknown as { electron: unknown }).electron = { remote: { getCurrentWebContents: () => wc } };
    // The browser half of the decode: a bitmap, and a canvas that reads it back.
    (window as unknown as { createImageBitmap: unknown }).createImageBitmap = () => Promise.resolve({});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        () =>
            ({
                drawImage: () => undefined,
                getImageData: () => ({ data: [...pixel] }),
            }) as unknown as RenderingContext
    );
    return {
        set(next: [number, number, number, number]): void {
            pixel.splice(0, 4, ...next);
        },
        captures: () => captures,
    };
}

beforeEach(() => {
    unmountAll();
    document.body.replaceChildren();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as unknown as { electron?: unknown }).electron;
    delete (window as unknown as { createImageBitmap?: unknown }).createImageBitmap;
});

// --- the colour model ---------------------------------------------------------------

describe('one colour model, three ways to show it', () => {
    const STEEL: Rgba = { r: 51, g: 102, b: 153, a: 1 };

    it.each([
        ['#336699', STEEL],
        ['rgb(51, 102, 153)', STEEL],
        ['rgb(51 102 153 / 50%)', { ...STEEL, a: 0.5 }],
        ['hsl(210, 50%, 40%)', STEEL],
        ['hsl(210 50% 40%)', STEEL],
        ['hsla(210, 50%, 40%, 0.5)', { ...STEEL, a: 0.5 }],
        ['hsl(0.5833333turn 50% 40% / 0.5)', { ...STEEL, a: 0.5 }],
    ])('reads %s into the one model', (text, expected) => {
        expect(parseRgba(text)).toEqual(expected);
    });

    it.each([['hsl(1, 2)'], ['hsl(a, 50%, 40%)'], ['hsl(10, 50%, 40%, 1, 2)'], ['hsl(10 50% 40% / 1 / 2)']])(
        'refuses %s rather than guessing',
        (text) => {
            expect(parseRgba(text)).toBeNull();
        }
    );

    it('knows the colours everybody knows', () => {
        expect(hsvaToRgba({ h: 0, s: 100, v: 100, a: 1 })).toEqual({ r: 255, g: 0, b: 0, a: 1 });
        expect(hsvaToRgba({ h: 120, s: 100, v: 100, a: 1 })).toEqual({ r: 0, g: 255, b: 0, a: 1 });
        expect(hsvaToRgba({ h: 240, s: 100, v: 100, a: 1 })).toEqual({ r: 0, g: 0, b: 255, a: 1 });
        expect(hslToRgba({ h: 0, s: 0, l: 50, a: 1 })).toEqual({ r: 128, g: 128, b: 128, a: 1 });
        expect(rgbaToHsla({ r: 255, g: 255, b: 255, a: 1 })).toMatchObject({ s: 0, l: 100 });
    });

    // Every sRGB colour survives the trip through the picker's own HSV.
    it('round-trips RGB through HSV and HSL exactly', () => {
        for (let r = 0; r <= 255; r += 17) {
            for (let g = 0; g <= 255; g += 51) {
                for (let b = 0; b <= 255; b += 85) {
                    const colour: Rgba = { r, g, b, a: 1 };
                    expect(hsvaToRgba(rgbaToHsva(colour))).toEqual(colour);
                    expect(hslToRgba(rgbaToHsla(colour))).toEqual(colour);
                }
            }
        }
    });

    it('stores one form whatever the display: hex when opaque, rgba otherwise', () => {
        expect(rgbaToCss(STEEL)).toBe('#336699');
        expect(rgbaToCss({ ...STEEL, a: 0.28 })).toBe('rgba(51, 102, 153, 0.28)');
    });

    it('shows the same colour in each format, and each reads back as that colour', () => {
        const formats: ColorFormat[] = ['hex', 'rgb', 'hsl'];
        expect(formats.map((format) => describeColor(STEEL, format))).toEqual([
            '#336699',
            'rgb(51, 102, 153)',
            'hsl(210, 50%, 40%)',
        ]);
        for (const format of formats) expect(parseRgba(describeColor(STEEL, format))).toEqual(STEEL);
        expect(describeColor({ ...STEEL, a: 0.5 }, 'rgb')).toBe('rgba(51, 102, 153, 0.5)');
    });
});

// --- the row and the popover ---------------------------------------------------------

describe('the swatch opens the Nexus picker', () => {
    it('opens a picker of our own, with nothing native in it', () => {
        const ui = mount();
        const picker = openFor(ui, WORKSPACE.key);
        expect(picker.getAttribute('role')).toBe('dialog');
        expect(picker.querySelector('input[type="color"]')).toBeNull();
        expect(document.querySelector('input[type="color"]')).toBeNull();
        expect(ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-swatch').getAttribute('aria-expanded')).toBe(
            'true'
        );
        expect(ui.row(WORKSPACE.key).classList.contains('is-editing')).toBe(true);
    });

    it('starts from the token value as it is now', () => {
        const ui = mount(withSettings((s) => setOverride(s, FIRST_PROFILE_ID, WORKSPACE.key, '#336699')));
        openFor(ui, WORKSPACE.key);
        expect(field('hex').value).toBe('#336699');
        expect(inPicker('.nexus-studio-cp-readout').textContent).toBe('#336699');
        expect(inPicker<HTMLInputElement>('.nexus-studio-cp-hue').value).toBe('210');
    });

    it('is one picker at a time: another swatch closes the first', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        openFor(ui, DOCUMENT.key);
        expect(popovers()).toHaveLength(1);
        expect(popover()!.dataset.token).toBe(DOCUMENT.key);
        expect(ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-swatch').getAttribute('aria-expanded')).toBe(
            'false'
        );
    });

    it('closes again from its own swatch, and never doubles up', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-swatch').click();
        expect(popovers()).toHaveLength(0);
        openFor(ui, WORKSPACE.key);
        expect(popovers()).toHaveLength(1);
    });

    it('does not open on the locked baseline', () => {
        const ui = mount(setActiveProfile(defaultSettings(), STANDARD_PROFILE_ID));
        const swatch = ui.inRow<HTMLButtonElement>(WORKSPACE.key, '.nexus-studio-swatch');
        expect(swatch.disabled).toBe(true);
        swatch.disabled = false;
        swatch.click();
        expect(popovers()).toHaveLength(0);
    });

    it('offers opacity where the token has one, and not where it has none', () => {
        const ui = mount();
        openFor(ui, SPLITTER_HOVER.key);
        expect(inPicker<HTMLInputElement>('.nexus-studio-cp-alpha').value).toBe('28');
        expect(inPicker<HTMLInputElement>('.nexus-studio-cp-alpha-number').value).toBe('28');
        openFor(ui, WORKSPACE.key);
        expect(popover()!.querySelector('.nexus-studio-cp-alpha')).toBeNull();
    });
});

describe('everything in the picker is live, and a draft', () => {
    const start = () => mount(withSettings((s) => setOverride(s, FIRST_PROFILE_ID, WORKSPACE.key, '#336699')));
    const drafts = (ui: ReturnType<typeof mount>) => ui.log.sessions.filter(([k]) => k === WORKSPACE.key);

    it('repaints on every move of the hue bar, and saves nothing while it moves', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        type(inPicker<HTMLInputElement>('.nexus-studio-cp-hue'), '0');
        expect(ui.session.get(WORKSPACE.key)).toBe('#993333');
        type(inPicker<HTMLInputElement>('.nexus-studio-cp-hue'), '120');
        expect(ui.session.get(WORKSPACE.key)).toBe('#339933');
        expect(ui.log.updateLive + ui.log.update).toBe(0);
        expect(override(ui, WORKSPACE.key)).toBe('#336699');
        // The row shows the draft too — it is what is on screen.
        expect(ui.inRow<HTMLElement>(WORKSPACE.key, '.nexus-studio-swatch').style.getPropertyValue(
            '--nexus-studio-swatch'
        )).toBe('#339933');
        expect(drafts(ui)).toHaveLength(2);
    });

    it('moves saturation and brightness from the keyboard, finely and coarsely', () => {
        const ui = mount(withSettings((s) => setOverride(s, FIRST_PROFILE_ID, WORKSPACE.key, '#808080')));
        openFor(ui, WORKSPACE.key);
        const area = inPicker<HTMLElement>('.nexus-studio-cp-area');
        expect(document.activeElement).toBe(area);
        key(area, 'ArrowUp', true);
        // #808080 is 50.2% brightness; ten steps up is 60.2%, channel 154.
        expect(parseRgba(ui.session.get(WORKSPACE.key)!)).toEqual({ r: 154, g: 154, b: 154, a: 1 });
        key(area, 'ArrowDown');
        expect(area.getAttribute('aria-valuetext')).toBe(`Saturation 0%, brightness ${60 - 1}%`);
        expect(PICKER_STEP_LARGE).toBe(10);
    });

    it('keeps its hue through grey, so the square does not jump back to red', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        const area = inPicker<HTMLElement>('.nexus-studio-cp-area');
        for (let i = 0; i < 12; i += 1) key(area, 'ArrowLeft', true);
        expect(inPicker<HTMLInputElement>('.nexus-studio-cp-hue').value).toBe('210');
    });

    it('takes exact values in each format, and a format switch changes nothing', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#112233');
        expect(ui.session.get(WORKSPACE.key)).toBe('#112233');

        const before = ui.log.sessions.length;
        cycleTo('rgb');
        expect(ui.log.sessions.length).toBe(before);
        expect(ui.session.get(WORKSPACE.key)).toBe('#112233');
        expect(inPicker('.nexus-studio-cp-readout').textContent).toBe('rgb(17, 34, 51)');
        expect([field('r').value, field('g').value, field('b').value]).toEqual(['17', '34', '51']);
        type(field('g'), '255');
        expect(ui.session.get(WORKSPACE.key)).toBe('#11ff33');

        cycleTo('hsl');
        expect(ui.session.get(WORKSPACE.key)).toBe('#11ff33');
        type(field('h'), '0');
        type(field('s'), '0');
        type(field('l'), '50');
        expect(ui.session.get(WORKSPACE.key)).toBe('#808080');
        // A preference, saved as UI state, never as a value.
        expect(ui.settings.pickerFormat).toBe('hsl');
        expect(ui.log.updateLive).toBe(0);
    });

    it('refuses a field value that is not one, without drafting it', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        const before = ui.log.sessions.length;
        type(field('hex'), '#12');
        expect(field('hex').hasAttribute('aria-invalid')).toBe(true);
        cycleTo('rgb');
        type(field('r'), '300');
        expect(field('r').hasAttribute('aria-invalid')).toBe(true);
        expect(ui.log.sessions.length).toBe(before);
    });

    it('opens in the format used last', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        cycleTo('hsl');
        key(document, 'Escape');
        openFor(ui, WORKSPACE.key);
        expect(formatButton().dataset.format).toBe('hsl');
        expect(field('h').value).toBe('210');
    });

    it('moves opacity from the bar and the number, keeping the colour', () => {
        const ui = mount();
        openFor(ui, SPLITTER_HOVER.key);
        type(inPicker<HTMLInputElement>('.nexus-studio-cp-alpha'), '60');
        expect(ui.session.get(SPLITTER_HOVER.key)).toBe('rgba(255, 255, 255, 0.6)');
        type(inPicker<HTMLInputElement>('.nexus-studio-cp-alpha-number'), '100');
        expect(ui.session.get(SPLITTER_HOVER.key)).toBe('#ffffff');
        type(inPicker<HTMLInputElement>('.nexus-studio-cp-alpha-number'), '0');
        expect(ui.session.get(SPLITTER_HOVER.key)).toBe('rgba(255, 255, 255, 0)');
    });

    it('follows the draft in the contrast figures before anything is saved', () => {
        const ui = mount();
        openFor(ui, 'textPrimary');
        type(field('hex'), '#3a3a3a');
        const onDocks = ui.root.querySelector('[data-pair="textPrimary:workspaceSurface"]')!;
        expect(onDocks.classList.contains('is-too-low')).toBe(true);
        expect(ui.log.updateLive).toBe(0);
    });
});

describe('closing: keep the draft, or go back', () => {
    const start = () => mount(withSettings((s) => setOverride(s, FIRST_PROFILE_ID, WORKSPACE.key, '#336699')));

    it('Done keeps it: one write, and the draft is gone', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#112233');
        type(field('hex'), '#445566');
        inPicker<HTMLButtonElement>('.nexus-studio-cp-done').click();
        expect(ui.log.updateLive).toBe(1);
        expect(override(ui, WORKSPACE.key)).toBe('#445566');
        expect(ui.session.size).toBe(0);
        expect(popovers()).toHaveLength(0);
    });

    it('Enter in a field keeps it', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#445566');
        key(field('hex'), 'Enter');
        expect(override(ui, WORKSPACE.key)).toBe('#445566');
        expect(popovers()).toHaveLength(0);
    });

    it('a click outside keeps it', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#445566');
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(override(ui, WORKSPACE.key)).toBe('#445566');
        expect(popovers()).toHaveLength(0);
    });

    it('a click inside does not', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        inPicker('.nexus-studio-cp-hue').dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(popovers()).toHaveLength(1);
    });

    // The preference: experiment freely, Escape goes home.
    it('Escape restores the value from before, exactly, and writes nothing', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        type(inPicker<HTMLInputElement>('.nexus-studio-cp-hue'), '0');
        type(field('hex'), '#ff00ff');
        key(document, 'Escape');
        expect(popovers()).toHaveLength(0);
        expect(ui.log.updateLive + ui.log.update).toBe(0);
        expect(override(ui, WORKSPACE.key)).toBe('#336699');
        expect(ui.session.size).toBe(0);
        expect(ui.log.sessions.at(-1)).toEqual([WORKSPACE.key, null]);
        expect(ui.inRow<HTMLElement>(WORKSPACE.key, '.nexus-studio-swatch').style.getPropertyValue(
            '--nexus-studio-swatch'
        )).toBe('#336699');
    });

    it('Revert does the same', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#ff00ff');
        inPicker<HTMLButtonElement>('.nexus-studio-cp-cancel').click();
        // A token that had no override still has none.
        expect(override(ui, WORKSPACE.key)).toBeUndefined();
        expect(ui.log.updateLive).toBe(0);
    });

    it('a commit with nothing changed writes nothing', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-done').click();
        expect(ui.log.updateLive).toBe(0);
        expect(override(ui, WORKSPACE.key)).toBeUndefined();
    });

    it('gives the focus back to the swatch', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        key(document, 'Escape');
        expect(document.activeElement).toBe(ui.inRow(WORKSPACE.key, '.nexus-studio-swatch'));
    });

    // A rebuild is a discrete change the draft was not made for.
    it('drops the draft on a profile switch, and leaves nothing behind', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#ff00ff');
        void ui.host.update(setActiveProfile(ui.settings, STANDARD_PROFILE_ID));
        expect(popovers()).toHaveLength(0);
        expect(ui.session.size).toBe(0);
        expect(activeProfile(setActiveProfile(ui.settings, FIRST_PROFILE_ID)).overrides[WORKSPACE.key]).toBe(
            '#336699'
        );
    });

    it('drops the draft when the view closes', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#ff00ff');
        ui.panel.dispose();
        expect(popovers()).toHaveLength(0);
        expect(ui.session.size).toBe(0);
        expect(override(ui, WORKSPACE.key)).toBe('#336699');
    });

    it('stops listening once closed', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        key(document, 'Escape');
        const after = ui.log.sessions.length;
        key(document, 'Escape');
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(ui.log.sessions.length).toBe(after);
        expect(ui.log.updateLive).toBe(0);
    });
});

describe('the locator and the picker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('takes the locator down when the picker opens', () => {
        const ui = mount();
        fire(ui.row(WORKSPACE.key), 'pointerenter');
        vi.advanceTimersByTime(LOCATOR_DELAY_MS);
        expect(ui.log.previews.at(-1)).toEqual([WORKSPACE.cssVariable]);
        openFor(ui, WORKSPACE.key);
        expect(ui.log.previews.at(-1)).toEqual([]);
    });

    it('paints no other row while a draft is showing', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        ui.log.previews.length = 0;
        fire(ui.row(DOCUMENT.key), 'pointerenter');
        vi.advanceTimersByTime(LOCATOR_DELAY_MS * 2);
        expect(ui.log.previews.filter((entry) => entry.length > 0)).toEqual([]);
    });
});

// --- the colour library in the picker ----------------------------------------------------

const savedSwatches = () =>
    Array.from(popover()!.querySelectorAll<HTMLButtonElement>('.nexus-studio-cp-swatch[data-kind="saved"]'));
const recentSwatches = () =>
    Array.from(popover()!.querySelectorAll<HTMLButtonElement>('.nexus-studio-cp-swatch[data-kind="recent"]'));

/** Gives the square a size, so a pointer position means a colour. happy-dom has no layout. */
function sizeSquare(): HTMLElement {
    const area = inPicker<HTMLElement>('.nexus-studio-cp-area');
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}),
    });
    return area;
}
const pointer = (target: Element, type: string, x: number, y: number) =>
    target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));

describe('Recent records each finished colour action, while the picker stays open', () => {
    it('shows two labelled sections, Recent above Saved, Recent with no controls of its own', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        const sections = Array.from(popover()!.querySelectorAll<HTMLElement>('.nexus-studio-cp-palette'));
        expect(sections.map((section) => section.dataset.section)).toEqual(['recent', 'saved']);
        expect(sections.map((section) => section.querySelector('.nexus-studio-cp-palette-label')!.textContent)).toEqual([
            'Recent',
            'Saved',
        ]);
        expect(inPicker('.nexus-studio-cp-empty').textContent).toMatch(/use/);
        expect(sections[0]!.querySelector('.nexus-studio-cp-add, .nexus-studio-cp-more')).toBeNull();
    });

    it('a click in the square is one colour, recorded on release, with the picker still open', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        const area = sizeSquare();
        pointer(area, 'pointerdown', 100, 0);
        expect(ui.settings.recentColors).toEqual([]);
        pointer(area, 'pointerup', 100, 0);
        const used = ui.session.get(WORKSPACE.key)!;
        expect(ui.settings.recentColors).toEqual([used]);
        expect(popovers()).toHaveLength(1);
        // Shown at once, without reopening.
        expect(recentSwatches().map((swatch) => swatch.style.getPropertyValue('--nexus-studio-swatch'))).toEqual([used]);
        // Library state, not a token write.
        expect(ui.log.updateLive).toBe(0);
        expect(ui.log.updateUiLater).toBe(1);
    });

    it('a drag of any length is one colour: its end value, not one per move', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        const area = sizeSquare();
        pointer(area, 'pointerdown', 10, 10);
        for (let x = 10; x <= 90; x += 2) pointer(area, 'pointermove', x, 50);
        expect(ui.settings.recentColors).toEqual([]);
        pointer(area, 'pointerup', 90, 50);
        expect(ui.settings.recentColors).toEqual([ui.session.get(WORKSPACE.key)]);
        expect(ui.log.updateUiLater).toBe(1);
    });

    it('a hue or opacity drag is one colour, recorded when it is let go', () => {
        const ui = mount();
        openFor(ui, SPLITTER_HOVER.key);
        const hue = inPicker<HTMLInputElement>('.nexus-studio-cp-hue');
        const alpha = inPicker<HTMLInputElement>('.nexus-studio-cp-alpha');
        for (const value of ['10', '50', '120']) type(hue, value);
        expect(ui.settings.recentColors).toEqual([]);
        fire(hue, 'change');
        expect(ui.settings.recentColors).toHaveLength(1);
        for (const value of ['40', '50', '60']) type(alpha, value);
        fire(alpha, 'change');
        expect(ui.settings.recentColors[0]).toBe(ui.session.get(SPLITTER_HOVER.key));
        expect(ui.settings.recentColors[0]).toMatch(/0\.6\)$/);
        expect(ui.settings.recentColors).toHaveLength(2);
    });

    // A key held down fires a change per step; the decision is the key going up.
    it('from the keyboard, records when the key is released, not on every step', () => {
        const ui = mount(withSettings((s) => setOverride(s, FIRST_PROFILE_ID, WORKSPACE.key, '#808080')));
        openFor(ui, WORKSPACE.key);
        const hue = inPicker<HTMLInputElement>('.nexus-studio-cp-hue');
        key(hue, 'ArrowRight');
        for (const value of ['1', '2', '3']) {
            type(hue, value);
            fire(hue, 'change');
        }
        expect(ui.settings.recentColors).toEqual([]);
        hue.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
        expect(ui.settings.recentColors).toHaveLength(1);
        const area = inPicker<HTMLElement>('.nexus-studio-cp-area');
        key(area, 'ArrowUp', true);
        key(area, 'ArrowUp', true);
        expect(ui.settings.recentColors).toHaveLength(1);
        area.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
        expect(ui.settings.recentColors).toHaveLength(2);
    });

    it('a typed value counts when it is confirmed, not per keystroke', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#1');
        type(field('hex'), '#12');
        type(field('hex'), '#123456');
        expect(ui.settings.recentColors).toEqual([]);
        fire(field('hex'), 'change');
        expect(ui.settings.recentColors).toEqual(['#123456']);
    });

    it('a Custom CSS value is not a colour, and is not recorded', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-advanced-toggle').click();
        const css = inPicker<HTMLInputElement>('.nexus-studio-cp-css');
        type(css, 'color-mix(in srgb, #000 50%, #fff)');
        fire(css, 'change');
        expect(ui.settings.recentColors).toEqual([]);
    });

    it('a format switch is not a colour action', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        formatButton().click();
        formatButton().click();
        expect(ui.settings.recentColors).toEqual([]);
    });

    // Recent is working history, not theme state.
    it.each([
        ['Escape', () => key(document, 'Escape')],
        ['Revert', () => inPicker<HTMLButtonElement>('.nexus-studio-cp-cancel').click()],
    ])('%s returns the token to where it was, and Recent keeps what was tried', (_label, cancel) => {
        const ui = mount(withSettings((s) => setOverride(s, FIRST_PROFILE_ID, WORKSPACE.key, '#336699')));
        openFor(ui, WORKSPACE.key);
        for (const hex of ['#ff0000', '#0000ff', '#00ff00']) {
            type(field('hex'), hex);
            fire(field('hex'), 'change');
        }
        expect(ui.settings.recentColors).toEqual(['#00ff00', '#0000ff', '#ff0000']);
        cancel();
        expect(popovers()).toHaveLength(0);
        expect(override(ui, WORKSPACE.key)).toBe('#336699');
        expect(ui.log.updateLive).toBe(0);
        expect(ui.settings.recentColors).toEqual(['#00ff00', '#0000ff', '#ff0000']);
    });

    it.each([
        ['Done', () => inPicker<HTMLButtonElement>('.nexus-studio-cp-done').click()],
        ['a click outside', () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))],
    ])('%s keeps the token, and Recent is what the actions made — the session adds nothing', (_label, commit) => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#ff0000');
        fire(field('hex'), 'change');
        type(field('hex'), '#445566');
        commit();
        expect(override(ui, WORKSPACE.key)).toBe('#445566');
        // The last value was typed but never confirmed: it is the token, not a used colour.
        expect(ui.settings.recentColors).toEqual(['#ff0000']);
    });

    it('Enter in a field confirms the value and closes: both happen', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#445566');
        key(field('hex'), 'Enter');
        expect(override(ui, WORKSPACE.key)).toBe('#445566');
        expect(ui.settings.recentColors).toEqual(['#445566']);
    });

    it('a recent colour, clicked, becomes the draft and moves to the front — no duplicate, picker open', () => {
        const ui = mount(withSettings((s) => ({ ...s, recentColors: ['#0000ff', '#ff0000', '#00ff00'] })));
        openFor(ui, WORKSPACE.key);
        recentSwatches()[2]!.click();
        expect(ui.session.get(WORKSPACE.key)).toBe('#00ff00');
        expect(ui.settings.recentColors).toEqual(['#00ff00', '#0000ff', '#ff0000']);
        expect(recentSwatches().map((swatch) => swatch.style.getPropertyValue('--nexus-studio-swatch'))).toEqual([
            '#00ff00',
            '#0000ff',
            '#ff0000',
        ]);
        expect(popovers()).toHaveLength(1);
        // The focus follows the colour to its new place instead of falling out of the picker.
        expect(document.activeElement).toBe(recentSwatches()[0]);
    });

    it('a full Recent drops its oldest when a new colour is used', () => {
        const recent = Array.from({ length: 16 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`);
        const ui = mount(withSettings((s) => ({ ...s, recentColors: recent })));
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#ff0000');
        fire(field('hex'), 'change');
        expect(ui.settings.recentColors).toHaveLength(16);
        expect(ui.settings.recentColors[0]).toBe('#ff0000');
        expect(ui.settings.recentColors).not.toContain('#00000f');
    });

    it('recognises the same colour in another spelling, alpha included', () => {
        const ui = mount(withSettings((s) => ({ ...s, recentColors: ['#ff0000', '#ffffff'] })));
        openFor(ui, SPLITTER_HOVER.key);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-advanced-toggle').click();
        const css = inPicker<HTMLInputElement>('.nexus-studio-cp-css');
        type(css, 'rgba(255, 255, 255, 1)');
        fire(css, 'change');
        expect(ui.settings.recentColors).toEqual(['#ffffff', '#ff0000']);
        type(css, 'rgba(255,255,255,0.5)');
        fire(css, 'change');
        expect(ui.settings.recentColors).toEqual(['rgba(255, 255, 255, 0.5)', '#ffffff', '#ff0000']);
    });

    it('a saved colour, clicked, is used: Recent updates at once, the saved colour does not change', () => {
        const ui = mount(withSettings((s) => ({ ...s, savedSwatches: ['#0000ff'], recentColors: ['#ff0000'] })));
        openFor(ui, WORKSPACE.key);
        savedSwatches()[0]!.click();
        expect(ui.session.get(WORKSPACE.key)).toBe('#0000ff');
        expect(ui.settings.recentColors).toEqual(['#0000ff', '#ff0000']);
        expect(recentSwatches()[0]!.style.getPropertyValue('--nexus-studio-swatch')).toBe('#0000ff');
        expect(ui.settings.savedSwatches).toEqual(['#0000ff']);
        expect(popovers()).toHaveLength(1);
        expect(document.activeElement).toBe(savedSwatches()[0]);
    });

    it('a pixel taken from Obsidian is used at once; a cancelled pick adds nothing', async () => {
        installCapture([0x12, 0x34, 0x56, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-sample').click();
        key(document, 'Escape');
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        expect(ui.settings.recentColors).toEqual([]);

        inPicker<HTMLButtonElement>('.nexus-studio-cp-sample').click();
        key(document, 'Enter');
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        expect(ui.settings.recentColors).toEqual(['#123456']);
        expect(popovers()).toHaveLength(1);
        expect(ui.log.updateLive).toBe(0);
    });

    // Redrawing Recent must not take the focus out of the control being used.
    it('updating Recent redraws only Recent: the square keeps the focus, nothing doubles', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        const area = sizeSquare();
        area.focus();
        for (let i = 0; i < 3; i += 1) {
            pointer(area, 'pointerdown', 20 * i, 20);
            pointer(area, 'pointerup', 20 * i, 20);
        }
        expect(document.activeElement).toBe(area);
        expect(popover()!.querySelector('.nexus-studio-cp-area')).toBe(area);
        expect(popover()!.querySelectorAll('.nexus-studio-cp-palette[data-section="recent"]')).toHaveLength(1);
        // A second pointerup with no drag in progress records nothing.
        const before = ui.log.updateUiLater;
        pointer(area, 'pointerup', 50, 50);
        expect(ui.log.updateUiLater).toBe(before);
    });
});

describe('the value line: one format button and a pipette icon', () => {
    it('cycles HEX → RGB → HSL → HEX with one button, and the colour does not move', () => {
        const ui = mount(withSettings((s) => setOverride(s, FIRST_PROFILE_ID, WORKSPACE.key, '#336699')));
        openFor(ui, WORKSPACE.key);
        expect(popover()!.querySelectorAll('.nexus-studio-cp-format')).toHaveLength(1);
        const seen: string[] = [];
        for (let i = 0; i < 4; i += 1) {
            seen.push(formatButton().textContent ?? '');
            formatButton().click();
        }
        expect(seen).toEqual(['HEX', 'RGB', 'HSL', 'HEX']);
        expect(ui.session.size).toBe(0);
        expect(ui.log.updateLive).toBe(0);
        expect(formatButton().getAttribute('aria-label')).toBe('Colour format: RGB. Change colour format');
        expect(ui.settings.pickerFormat).toBe('rgb');
    });

    it('is a real button, so Enter and Space work as for any button', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        expect(formatButton().tagName).toBe('BUTTON');
        expect(formatButton().getAttribute('type')).toBe('button');
        // Enter on a button presses it; the picker does not treat it as "done".
        key(formatButton(), 'Enter');
        expect(popovers()).toHaveLength(1);
    });

    it('offers Pick from Obsidian as a small icon button beside it, with no text', () => {
        installCapture([0, 0, 0, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        const pipette = inPicker<HTMLButtonElement>('.nexus-studio-cp-sample');
        expect(pipette.classList.contains('clickable-icon')).toBe(true);
        expect(pipette.textContent).toBe('');
        expect(pipette.getAttribute('aria-label')).toBe('Pick from Obsidian');
        expect(pipette.parentElement).toBe(formatButton().parentElement);
        expect(popover()!.querySelectorAll('.nexus-studio-cp-sample')).toHaveLength(1);
    });
});

describe('saved colours: what was kept on purpose', () => {
    it('saves the current colour with +, as studio state and not as a token', () => {
        const ui = mount(withSettings((s) => setOverride(s, FIRST_PROFILE_ID, WORKSPACE.key, '#336699')));
        openFor(ui, WORKSPACE.key);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-add').click();
        expect(ui.settings.savedSwatches).toEqual(['#336699']);
        expect(ui.log.updateUi).toBe(1);
        expect(ui.log.updateLive).toBe(0);
        expect(savedSwatches()).toHaveLength(1);
        expect(savedSwatches()[0]!.style.getPropertyValue('--nexus-studio-swatch')).toBe('#336699');
        // Saving is not using: recent is untouched.
        expect(ui.settings.recentColors).toEqual([]);
    });

    it('does not save a colour twice, writes nothing, and shows the one there', () => {
        const ui = mount(withSettings((s) => ({ ...setOverride(s, FIRST_PROFILE_ID, WORKSPACE.key, '#336699'), savedSwatches: ['#111111', '#336699'] })));
        openFor(ui, WORKSPACE.key);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-add').click();
        expect(ui.settings.savedSwatches).toEqual(['#111111', '#336699']);
        expect(ui.log.updateUi).toBe(0);
        expect(savedSwatches()[1]!.classList.contains('is-found')).toBe(true);
    });

    it('keeps opacity: a translucent colour is saved translucent', () => {
        const ui = mount();
        openFor(ui, SPLITTER_HOVER.key);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-add').click();
        expect(ui.settings.savedSwatches).toEqual(['rgba(255, 255, 255, 0.28)']);
    });

    // Base colour, then a variant, then the variant saved as well.
    it('loads a saved colour without changing it, and a variant can be saved beside it', () => {
        const ui = mount(withSettings((s) => ({ ...s, savedSwatches: ['#336699'] })));
        openFor(ui, WORKSPACE.key);
        savedSwatches()[0]!.click();
        expect(ui.session.get(WORKSPACE.key)).toBe('#336699');
        expect(savedSwatches()[0]!.getAttribute('aria-pressed')).toBe('true');
        key(inPicker('.nexus-studio-cp-area'), 'ArrowUp', true);
        const variant = ui.session.get(WORKSPACE.key)!;
        expect(variant).not.toBe('#336699');
        expect(ui.settings.savedSwatches).toEqual(['#336699']);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-add').click();
        expect(ui.settings.savedSwatches).toEqual(['#336699', variant]);
    });

    it('loads a translucent colour translucent where the token has opacity, opaque where it has none', () => {
        const ui = mount(withSettings((s) => ({ ...s, savedSwatches: ['rgba(51, 102, 153, 0.5)'] })));
        openFor(ui, SPLITTER_HOVER.key);
        savedSwatches()[0]!.click();
        expect(ui.session.get(SPLITTER_HOVER.key)).toBe('rgba(51, 102, 153, 0.5)');
        key(document, 'Escape');
        openFor(ui, WORKSPACE.key);
        savedSwatches()[0]!.click();
        expect(ui.session.get(WORKSPACE.key)).toBe('#336699');
    });

    // Replace and delete without a context menu: load it, then ⋯.
    it('replaces and deletes the loaded colour from ⋯, no context menu needed', () => {
        const ui = mount(withSettings((s) => ({ ...s, savedSwatches: ['#111111', '#222222'] })));
        openFor(ui, WORKSPACE.key);
        savedSwatches()[1]!.click();
        type(field('hex'), '#abcdef');
        inPicker<HTMLButtonElement>('.nexus-studio-cp-more').click();
        const menu = ui.log.menus.at(-1)!;
        expect(menu.map((item) => item.title)).toEqual([
            'Replace #222222 with current colour',
            'Delete #222222',
            'Import palette…',
            'Export palette…',
            'Copy as CSS variables',
            'Clear saved colours…',
        ]);
        menu[0]!.run();
        expect(ui.settings.savedSwatches).toEqual(['#111111', '#abcdef']);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-more').click();
        ui.log.menus.at(-1)![1]!.run();
        expect(ui.settings.savedSwatches).toEqual(['#111111']);
        expect(savedSwatches()).toHaveLength(1);
    });

    it('offers only the palette actions when no saved colour is loaded', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-more').click();
        const menu = ui.log.menus.at(-1)!;
        expect(menu.map((item) => item.title)).toEqual([
            'Import palette…',
            'Export palette…',
            'Copy as CSS variables',
            'Clear saved colours…',
        ]);
        // Nothing to export or clear yet.
        expect(menu.map((item) => item.disabled)).toEqual([false, true, true, true]);
    });

    it('still replaces and deletes from the swatch context menu', () => {
        const ui = mount(withSettings((s) => ({ ...s, savedSwatches: ['#111111', '#222222'] })));
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#abcdef');
        savedSwatches()[1]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const menu = ui.log.menus.at(-1)!;
        expect(menu.map((item) => item.title)).toEqual(['Replace with current colour', 'Delete swatch']);
        menu[0]!.run();
        expect(ui.settings.savedSwatches).toEqual(['#111111', '#abcdef']);
        savedSwatches()[0]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        ui.log.menus.at(-1)![1]!.run();
        expect(ui.settings.savedSwatches).toEqual(['#abcdef']);
    });

    it('deletes a focused saved colour with the Delete key', () => {
        const ui = mount(withSettings((s) => ({ ...s, savedSwatches: ['#111111', '#222222'] })));
        openFor(ui, WORKSPACE.key);
        key(savedSwatches()[0]!, 'Delete');
        expect(ui.settings.savedSwatches).toEqual(['#222222']);
    });

    it('clears only after a yes', async () => {
        const ui = mount(withSettings((s) => ({ ...s, savedSwatches: ['#111111'], recentColors: ['#222222'] })));
        openFor(ui, WORKSPACE.key);
        ui.answers.confirm = false;
        inPicker<HTMLButtonElement>('.nexus-studio-cp-more').click();
        ui.log.menus.at(-1)!.find((item) => item.title.startsWith('Clear'))!.run();
        await Promise.resolve();
        expect(ui.log.confirms).toEqual(['Clear saved colours']);
        expect(ui.settings.savedSwatches).toEqual(['#111111']);
        ui.answers.confirm = true;
        inPicker<HTMLButtonElement>('.nexus-studio-cp-more').click();
        ui.log.menus.at(-1)!.find((item) => item.title.startsWith('Clear'))!.run();
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        expect(ui.settings.savedSwatches).toEqual([]);
        expect(ui.settings.recentColors).toEqual(['#222222']);
        expect(savedSwatches()).toHaveLength(0);
    });
});

describe('palette export and import from the picker', () => {
    it('exports the saved colours, and not the recent ones', () => {
        const ui = mount(withSettings((s) => ({ ...s, savedSwatches: ['#111111', 'rgba(1, 2, 3, 0.5)'], recentColors: ['#999999'] })));
        openFor(ui, WORKSPACE.key);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-more').click();
        ui.log.menus.at(-1)!.find((item) => item.title.startsWith('Export'))!.run();
        expect(ui.log.exports).toEqual([['#111111', 'rgba(1, 2, 3, 0.5)']]);
    });

    it('imports by merging, shows the new colours at once, and changes no token', () => {
        const ui = mount(withSettings((s) => ({ ...setOverride(s, FIRST_PROFILE_ID, WORKSPACE.key, '#336699'), savedSwatches: ['#111111'] })));
        openFor(ui, WORKSPACE.key);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-more').click();
        ui.log.menus.at(-1)!.find((item) => item.title.startsWith('Import'))!.run();
        ui.importText(
            JSON.stringify({
                format: 'nexus-color-palette',
                version: 1,
                name: 'Imported',
                colors: [{ value: '#111111' }, { value: 'rgba(255,255,255,0.28)' }, { value: 'nope' }],
            })
        );
        expect(ui.settings.savedSwatches).toEqual(['#111111', 'rgba(255, 255, 255, 0.28)']);
        expect(ui.log.notices.at(-1)).toBe('"Imported": 1 added, 1 already saved, 1 not a colour, skipped.');
        expect(savedSwatches()).toHaveLength(2);
        // The picker, its draft and the token are as they were.
        expect(popovers()).toHaveLength(1);
        expect(ui.session.size).toBe(0);
        expect(override(ui, WORKSPACE.key)).toBe('#336699');
        expect(ui.log.updateLive).toBe(0);
    });

    it('refuses a file of the wrong kind or a newer version, and changes nothing', () => {
        const ui = mount(withSettings((s) => ({ ...s, savedSwatches: ['#111111'] })));
        ui.panel.importPalette(JSON.stringify({ format: 'nexus-theme-profile', formatVersion: 1, name: 'p', overrides: {} }));
        ui.panel.importPalette(JSON.stringify({ format: 'nexus-color-palette', version: 9, colors: [] }));
        expect(ui.log.notices).toHaveLength(2);
        expect(ui.log.notices.every((notice) => notice.startsWith('Import refused'))).toBe(true);
        expect(ui.settings.savedSwatches).toEqual(['#111111']);
        expect(ui.log.updateUi).toBe(0);
    });

    // Obsidian closes its topmost dialog on Escape wherever the focus is. That
    // Escape is the dialog's alone, even with the focus outside it.
    it('leaves an Escape to an open dialog, even when the focus is not in it', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#445566');
        const dialog = document.createElement('div');
        dialog.className = 'modal-container';
        document.body.appendChild(dialog);
        (document.activeElement as HTMLElement | null)?.blur();
        key(document.body, 'Escape');
        expect(popovers()).toHaveLength(1);
        expect(ui.session.get(WORKSPACE.key)).toBe('#445566');
        dialog.remove();
        key(document.body, 'Escape');
        expect(popovers()).toHaveLength(0);
    });

    // Traced live: Obsidian closes a dialog in a keydown handler that runs
    // before the picker's, and the dialog's field is gone by the time the
    // picker sees the Escape. That Escape was the dialog's.
    it('ignores an Escape that already closed a dialog', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#445566');
        const field2 = document.createElement('input');
        document.body.appendChild(field2);
        field2.addEventListener('keydown', () => field2.remove(), { capture: true, once: true });
        window.addEventListener('keydown', () => field2.remove(), { capture: true, once: true });
        key(field2, 'Escape');
        expect(popovers()).toHaveLength(1);
        expect(ui.session.get(WORKSPACE.key)).toBe('#445566');
    });

    // The import dialog is outside the picker; working in it is not "a click outside".
    it('keeps the picker open while one of its dialogs is in use', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        type(field('hex'), '#445566');
        const dialog = document.createElement('div');
        dialog.className = 'modal-container';
        const input = document.createElement('textarea');
        dialog.appendChild(input);
        document.body.appendChild(dialog);
        input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        key(input, 'Escape');
        expect(popovers()).toHaveLength(1);
        expect(ui.session.get(WORKSPACE.key)).toBe('#445566');
        dialog.remove();
    });
});

// --- the pipette as a tool ---------------------------------------------------------------

const settle = () => new Promise((resolve) => window.setTimeout(resolve, 60));
const shield = () => document.querySelector<HTMLElement>('.nexus-studio-pick-shield');
const pipette = () => inPicker<HTMLButtonElement>('.nexus-studio-cp-sample');
/** A press where a user would press: pointerdown, then the click that follows. */
const press = (target: Element, x = 5, y = 5) => {
    target.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }));
    target.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }));
};

describe('the pipette is a tool that stays on', () => {
    it('switches on as a pressed toggle, with the picker still visible', () => {
        installCapture([0, 0, 0, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        expect(pipette().getAttribute('aria-pressed')).toBe('false');
        pipette().click();
        expect(pipette().getAttribute('aria-pressed')).toBe('true');
        expect(pipette().classList.contains('is-active')).toBe(true);
        expect(popover()!.classList.contains('is-sampling-mode')).toBe(true);
        // Not hidden, as the one-shot pipette used to hide it.
        expect(popover()!.classList.contains('is-sampling')).toBe(false);
        expect(shield()?.classList.contains('is-persistent')).toBe(true);
        expect(pipette().textContent).toBe('');
    });

    it('takes a colour on every click, without being switched on again, moving each to the front of Recent', async () => {
        const pixel = installCapture([255, 0, 0, 255]);
        const ui = mount(withSettings((s) => ({ ...s, recentColors: ['#0000ff', '#ff0000'], savedSwatches: ['#123456'] })));
        openFor(ui, WORKSPACE.key);
        pipette().click();
        press(shield()!);
        await settle();
        expect(ui.session.get(WORKSPACE.key)).toBe('#ff0000');
        expect(ui.settings.recentColors).toEqual(['#ff0000', '#0000ff']);
        pixel.set([0, 255, 0, 255]);
        press(shield()!);
        await settle();
        expect(ui.settings.recentColors).toEqual(['#00ff00', '#ff0000', '#0000ff']);
        // A colour already in Recent moves to the front; it is not doubled.
        pixel.set([0, 0, 255, 255]);
        press(shield()!);
        await settle();
        expect(ui.settings.recentColors).toEqual(['#0000ff', '#00ff00', '#ff0000']);
        expect(recentSwatches()[0]!.style.getPropertyValue('--nexus-studio-swatch')).toBe('#0000ff');
        // Still on, still visible, Saved untouched, no token written.
        expect(pipette().getAttribute('aria-pressed')).toBe('true');
        expect(popovers()).toHaveLength(1);
        expect(ui.settings.savedSwatches).toEqual(['#123456']);
        expect(ui.log.updateLive).toBe(0);
    });

    it('samples the picker\'s own swatches too, and the click that follows is swallowed', async () => {
        installCapture([0x11, 0x11, 0x11, 255]);
        const ui = mount(withSettings((s) => ({ ...s, savedSwatches: ['#abcdef'] })));
        openFor(ui, WORKSPACE.key);
        pipette().click();
        press(savedSwatches()[0]!);
        await settle();
        // The pixel was taken; the swatch was not also clicked (which would load #abcdef).
        expect(ui.session.get(WORKSPACE.key)).toBe('#111111');
        expect(ui.settings.recentColors).toEqual(['#111111']);
        expect(ui.settings.savedSwatches).toEqual(['#abcdef']);
    });

    it('keeps its own controls live: format still cycles, the pipette switches it off', async () => {
        installCapture([0, 0, 0, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        pipette().click();
        press(formatButton());
        expect(formatButton().dataset.format).toBe('rgb');
        press(pipette());
        expect(pipette().getAttribute('aria-pressed')).toBe('false');
        expect(shield()).toBeNull();
        expect(document.querySelector('.nexus-studio-sample-loupe')).toBeNull();
        await settle();
        expect(ui.settings.recentColors).toEqual([]);
    });

    it('Done while sampling commits and leaves nothing behind', async () => {
        installCapture([0x22, 0x33, 0x44, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        pipette().click();
        press(shield()!);
        await settle();
        press(inPicker('.nexus-studio-cp-done'));
        expect(popovers()).toHaveLength(0);
        expect(override(ui, WORKSPACE.key)).toBe('#223344');
        expect(shield()).toBeNull();
    });

    // One Escape ends one thing.
    it('Escape switches the tool off and keeps the picker; a second Escape cancels the session', async () => {
        installCapture([0x22, 0x33, 0x44, 255]);
        const ui = mount(withSettings((s) => setOverride(s, FIRST_PROFILE_ID, WORKSPACE.key, '#336699')));
        openFor(ui, WORKSPACE.key);
        pipette().click();
        press(shield()!);
        await settle();
        key(document, 'Escape');
        expect(pipette().getAttribute('aria-pressed')).toBe('false');
        expect(shield()).toBeNull();
        expect(popovers()).toHaveLength(1);
        expect(ui.session.get(WORKSPACE.key)).toBe('#223344');
        expect(ui.settings.recentColors).toEqual(['#223344']);
        key(document, 'Escape');
        expect(popovers()).toHaveLength(0);
        expect(override(ui, WORKSPACE.key)).toBe('#336699');
        expect(ui.settings.recentColors).toEqual(['#223344']);
    });

    // A real click leaves the focus on the pipette button.
    it('aims and ends from the keyboard with the focus on the pipette; Enter there presses it', async () => {
        installCapture([3, 3, 3, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        pipette().click();
        pipette().focus();
        key(pipette(), 'ArrowRight');
        expect(document.querySelector<HTMLElement>('.nexus-studio-pick-reticle')!.hidden).toBe(false);
        key(pipette(), 'Escape');
        expect(pipette().getAttribute('aria-pressed')).toBe('false');
        expect(popovers()).toHaveLength(1);
        pipette().click();
        const enter = key(pipette(), 'Enter');
        // Not taken by the sampler: the button's own Enter.
        expect(enter.defaultPrevented).toBe(false);
        await settle();
        expect(ui.settings.recentColors).toEqual([]);
    });

    it('aims with the arrows and takes with Enter, again and again', async () => {
        const pixel = installCapture([1, 1, 1, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        pipette().click();
        key(document, 'ArrowRight');
        key(document, 'Enter');
        await settle();
        pixel.set([2, 2, 2, 255]);
        key(document, 'ArrowDown', true);
        key(document, ' ');
        await settle();
        expect(ui.settings.recentColors).toEqual(['#020202', '#010101']);
        expect(pipette().getAttribute('aria-pressed')).toBe('true');
    });

    it('keeps the draft\'s opacity: a pixel has none of its own', async () => {
        installCapture([255, 0, 0, 255]);
        const ui = mount();
        openFor(ui, SPLITTER_HOVER.key);
        pipette().click();
        press(shield()!);
        await settle();
        expect(ui.session.get(SPLITTER_HOVER.key)).toBe('rgba(255, 0, 0, 0.28)');
    });

    it('adds nothing when a pixel cannot be read, and stays on', async () => {
        installCapture([0, 0, 0, 255]);
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        pipette().click();
        press(shield()!);
        await settle();
        expect(ui.settings.recentColors).toEqual([]);
        expect(pipette().getAttribute('aria-pressed')).toBe('true');
    });

    it('does not start a drag while it is on: a press is a sample', async () => {
        installCapture([9, 9, 9, 255]);
        const ui = mount(withSettings((s) => ({ ...s, savedSwatches: ['#111111', '#222222'] })));
        openFor(ui, WORKSPACE.key);
        pipette().click();
        const first = savedSwatches()[0]!;
        first.dispatchEvent(new MouseEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true, button: 0 }));
        document.body.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 0, bubbles: true }));
        document.body.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 0, bubbles: true }));
        await settle();
        expect(document.querySelector('.nexus-studio-cp-ghost')).toBeNull();
        expect(ui.settings.savedSwatches).toEqual(['#111111', '#222222']);
        expect(ui.settings.recentColors).toEqual(['#090909']);
    });

    // Performance before show: a moving mouse must not mean a capture per event.
    it('shows the colour under the cursor in a loupe, with captures throttled', async () => {
        const pixel = installCapture([0x40, 0x50, 0x60, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        pipette().click();
        for (let i = 0; i < 40; i += 1) {
            shield()!.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 + i, clientY: 100, bubbles: true }));
        }
        expect(pixel.captures()).toBeLessThanOrEqual(1);
        await new Promise((resolve) => window.setTimeout(resolve, CANDIDATE_INTERVAL_MS * 3));
        expect(pixel.captures()).toBeLessThanOrEqual(3);
        const loupe = document.querySelector<HTMLElement>('.nexus-studio-sample-loupe')!;
        expect(loupe.hidden).toBe(false);
        expect(loupe.querySelector<HTMLElement>('.nexus-studio-sample-candidate')!.style.getPropertyValue('--nexus-studio-loupe-candidate')).toBe('#405060');
        // North-east of the hot spot, never on it.
        expect(parseInt(loupe.style.left, 10)).toBeGreaterThan(139);
        expect(parseInt(loupe.style.top, 10) + LOUPE_SIZE).toBeLessThan(100);
        // Moving is looking: nothing is recorded or saved.
        expect(ui.settings.recentColors).toEqual([]);
        expect(ui.log.updateUiLater).toBe(0);
    });

    it('ends with the view: no layer, no loupe left', () => {
        installCapture([0, 0, 0, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        pipette().click();
        shield()!.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true }));
        ui.panel.dispose();
        expect(shield()).toBeNull();
        expect(document.querySelector('.nexus-studio-sample-loupe')).toBeNull();
    });

    it('is not offered where the window cannot be captured', () => {
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        expect(popover()!.querySelector('.nexus-studio-cp-sample')).toBeNull();
    });
});

describe('the pipette cursor is on exactly while the sampler is', () => {
    /**
     * The pipette cursor is carried by the sampling layer and by the picker's
     * `is-sampling-mode` (see styles.css), so "is it showing" is "are they
     * there". The computed cursor itself is checked live by the smoke.
     */
    const showing = () => ({
        layer: !!document.querySelector('.nexus-studio-pick-shield.is-persistent'),
        picker: !!document.querySelector('.nexus-studio-popover.is-sampling-mode'),
    });
    const off = { layer: false, picker: false };
    const on = { layer: true, picker: true };
    const altDown = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true, cancelable: true }));
    const altUp = () => document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true, cancelable: true }));

    it('is not on in the ordinary picker', () => {
        installCapture([0, 0, 0, 255]);
        openFor(mount(), WORKSPACE.key);
        expect(showing()).toEqual(off);
    });

    it('comes with the pipette, stays through sample after sample, and goes with Escape', async () => {
        const pixel = installCapture([1, 1, 1, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        pipette().click();
        expect(showing()).toEqual(on);
        press(shield()!);
        await settle();
        expect(showing()).toEqual(on);
        pixel.set([2, 2, 2, 255]);
        press(shield()!);
        await settle();
        expect(showing()).toEqual(on);
        expect(ui.settings.recentColors).toEqual(['#020202', '#010101']);
        key(document, 'Escape');
        expect(showing()).toEqual(off);
        expect(popovers()).toHaveLength(1);
    });

    it('goes when the pipette is switched off', () => {
        installCapture([0, 0, 0, 255]);
        openFor(mount(), WORKSPACE.key);
        pipette().click();
        pipette().click();
        expect(showing()).toEqual(off);
    });

    it('comes with Alt and goes when Alt is let go', () => {
        installCapture([0, 0, 0, 255]);
        openFor(mount(), WORKSPACE.key);
        altDown();
        expect(showing()).toEqual(on);
        altUp();
        expect(showing()).toEqual(off);
    });

    it('stays when Alt is let go over a switched-on pipette', () => {
        installCapture([0, 0, 0, 255]);
        openFor(mount(), WORKSPACE.key);
        pipette().click();
        altDown();
        altUp();
        expect(showing()).toEqual(on);
    });

    it('does not hang after the window loses focus with Alt held', () => {
        installCapture([0, 0, 0, 255]);
        openFor(mount(), WORKSPACE.key);
        altDown();
        window.dispatchEvent(new Event('blur'));
        expect(showing()).toEqual(off);
    });

    it('does not hang after the picker closes', () => {
        installCapture([0, 0, 0, 255]);
        openFor(mount(), WORKSPACE.key);
        pipette().click();
        press(inPicker('.nexus-studio-cp-done'));
        expect(showing()).toEqual(off);
        expect(document.querySelector('.nexus-studio-pick-shield')).toBeNull();
    });

    // Unloading the plugin closes its views; a view closing disposes its panel.
    it('does not hang after the view goes, as it does when the plugin unloads', () => {
        installCapture([0, 0, 0, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        pipette().click();
        ui.panel.dispose();
        expect(showing()).toEqual(off);
        expect(document.querySelector('.nexus-studio-pick-shield, .nexus-studio-sample-loupe')).toBeNull();
    });
});

describe('the loupe sits north-east of the hot spot', () => {
    const W = 1000;
    const H = 800;
    const box = (x: number, y: number) => {
        const at = loupePosition(x, y, W, H);
        return { ...at, right: at.left + LOUPE_SIZE, bottom: at.top + LOUPE_SIZE };
    };
    const coversHotSpot = (x: number, y: number) => {
        const b = box(x, y);
        return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    };

    it('is to the right of and above the hot spot, clear of the pipette\'s tip', () => {
        const b = box(500, 400);
        expect(b.left).toBe(500 + LOUPE_DX);
        expect(b.bottom).toBe(400 - LOUPE_DY);
        expect(b.left).toBeGreaterThan(500);
        expect(b.bottom).toBeLessThan(400);
        expect(coversHotSpot(500, 400)).toBe(false);
    });

    it('follows the cursor north-east, not south-east, anywhere with room', () => {
        for (const [x, y] of [[60, 60], [300, 700], [900, 500], [40, 790]] as const) {
            const b = box(x, y);
            expect(b.left).toBeGreaterThan(x);
            expect(b.bottom).toBeLessThan(y);
        }
    });

    it('slides down along the top edge, still to the right and clear of the tip', () => {
        const b = box(500, 10);
        expect(b.top).toBe(2);
        expect(b.left).toBe(520);
        expect(coversHotSpot(500, 10)).toBe(false);
    });

    it('slides left along the right edge, still above the tip', () => {
        const b = box(990, 400);
        expect(b.right).toBe(W - 2);
        expect(b.bottom).toBe(396);
        expect(coversHotSpot(990, 400)).toBe(false);
    });

    it('slides only as far as needed: no jump as the cursor nears the right edge', () => {
        let previous = box(900, 400).left;
        for (let x = 901; x <= 999; x += 1) {
            const left = box(x, 400).left;
            expect(Math.abs(left - previous)).toBeLessThanOrEqual(1);
            previous = left;
        }
    });

    it('in the top-right corner, where north-east would cover the tip, moves below it', () => {
        const b = box(990, 10);
        expect(coversHotSpot(990, 10)).toBe(false);
        expect(b.right).toBeLessThanOrEqual(W - 2);
        expect(b.top).toBeGreaterThan(10);
    });

    it('is placed there by the sampler, with its content unchanged', async () => {
        installCapture([0x40, 0x50, 0x60, 255]);
        openFor(mount(), WORKSPACE.key);
        pipette().click();
        shield()!.dispatchEvent(new MouseEvent('pointermove', { clientX: 300, clientY: 300, bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, CANDIDATE_INTERVAL_MS * 2));
        const loupe = document.querySelector<HTMLElement>('.nexus-studio-sample-loupe')!;
        const expected = loupePosition(300, 300, window.innerWidth, window.innerHeight);
        expect(loupe.style.left).toBe(`${expected.left}px`);
        expect(loupe.style.top).toBe(`${expected.top}px`);
        expect(expected.top + LOUPE_SIZE).toBeLessThan(300);
        expect(loupe.querySelector<HTMLElement>('.nexus-studio-sample-candidate')!.style.getPropertyValue('--nexus-studio-loupe-candidate')).toBe('#405060');
        expect(loupe.style.getPropertyValue('--nexus-studio-loupe-ring')).not.toBe('');
    });
});

describe('Alt held is the pipette for as long as it is held', () => {
    const altDown = () => {
        const event = new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        return event;
    };
    const altUp = () => document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true, cancelable: true }));

    it('switches on while Alt is down and off when it is let go', () => {
        installCapture([0, 0, 0, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        const down = altDown();
        expect(down.defaultPrevented).toBe(true);
        expect(pipette().getAttribute('aria-pressed')).toBe('true');
        expect(shield()).not.toBeNull();
        altUp();
        expect(pipette().getAttribute('aria-pressed')).toBe('false');
        expect(shield()).toBeNull();
        expect(popovers()).toHaveLength(1);
    });

    it('leaves a switched-on pipette switched on', () => {
        installCapture([0, 0, 0, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        pipette().click();
        altDown();
        altUp();
        expect(pipette().getAttribute('aria-pressed')).toBe('true');
    });

    it('is not a tool when it is part of a chord', () => {
        installCapture([0, 0, 0, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        altDown();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', altKey: true, bubbles: true }));
        expect(pipette().getAttribute('aria-pressed')).toBe('false');
    });

    it('ends when the window loses focus, so no Alt is left hanging', () => {
        installCapture([0, 0, 0, 255]);
        const ui = mount();
        openFor(ui, WORKSPACE.key);
        altDown();
        window.dispatchEvent(new Event('blur'));
        expect(shield()).toBeNull();
        expect(pipette().getAttribute('aria-pressed')).toBe('false');
    });

    it('takes nothing when no picker is open', () => {
        installCapture([0, 0, 0, 255]);
        mount();
        expect(altDown().defaultPrevented).toBe(false);
        expect(shield()).toBeNull();
    });
});

// --- dragging swatches --------------------------------------------------------------------

/**
 * Lays out the Saved section as a wrapped grid, four swatches a row, 22px
 * swatches and 4px gaps, starting at (0, 320). happy-dom has no layout.
 */
function layoutSaved(perRow = 4): void {
    const box = popover()!.querySelector<HTMLElement>('.nexus-studio-cp-palette[data-section="saved"]')!;
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 300, right: 248, bottom: 420, width: 248, height: 120, x: 0, y: 300, toJSON: () => ({}) });
    const grid = box.querySelector<HTMLElement>('.nexus-studio-cp-saved')!;
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 320, right: 248, bottom: 400, width: 248, height: 80, x: 0, y: 320, toJSON: () => ({}) });
    savedSwatches().forEach((swatch, index) => {
        const left = (index % perRow) * 26;
        const top = 320 + Math.floor(index / perRow) * 26;
        vi.spyOn(swatch, 'getBoundingClientRect').mockReturnValue({ left, top, right: left + 22, bottom: top + 22, width: 22, height: 22, x: left, y: top, toJSON: () => ({}) });
    });
}

/** Drags from an element to (x, y) past the threshold, and drops there. */
function dragTo(source: Element, x: number, y: number, drop = true): void {
    source.dispatchEvent(new MouseEvent('pointerdown', { clientX: 200, clientY: 200, bubbles: true, button: 0 }));
    document.body.dispatchEvent(new MouseEvent('pointermove', { clientX: 200 + DRAG_THRESHOLD + 1, clientY: 200, bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
    if (drop) {
        document.body.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));
        // The click a real browser sends after the release, on the source.
        source.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }
}

describe('where a drop lands in a wrapped row', () => {
    const boxes: Box[] = Array.from({ length: 6 }, (_, index) => {
        const left = (index % 4) * 26;
        const top = Math.floor(index / 4) * 26;
        return { left, top, right: left + 22, bottom: top + 22 };
    });

    it.each([
        ['before the first', 2, 10, 0],
        ['between the first two', 22, 10, 1],
        ['after the last of the first row', 100, 10, 4],
        ['before the first of the second row', 2, 36, 4],
        ['between two on the second row', 24, 36, 5],
        ['after the very last', 100, 36, 6],
        ['above everything', 30, -40, 1],
        ['below everything', 100, 400, 6],
    ])('%s', (_label, x, y, index) => {
        expect(insertIndexAt(boxes, x, y)?.index).toBe(index);
    });

    // The end of row 1 and the start of row 2 are one insertion point, drawn on
    // the row the pointer is on — not a jump.
    it('draws the same insertion point on the row the pointer is on', () => {
        const endOfRow = insertIndexAt(boxes, 100, 10)!;
        const startOfNext = insertIndexAt(boxes, 2, 36)!;
        expect(endOfRow.index).toBe(startOfNext.index);
        expect(endOfRow.top).toBe(0);
        expect(startOfNext.top).toBe(26);
        expect(endOfRow.markerX).toBe(102);
        expect(startOfNext.markerX).toBe(-2);
    });
});

describe('Recent → Saved is a copy, at the marked place', () => {
    const start = () =>
        mount(withSettings((s) => ({ ...s, savedSwatches: ['#aa0000', '#bb0000', '#cc0000', '#dd0000'], recentColors: ['#123456', '#654321'] })));

    it.each([
        ['before the first', 2, 331, ['#123456', '#aa0000', '#bb0000', '#cc0000', '#dd0000']],
        ['between B and C', 50, 331, ['#aa0000', '#bb0000', '#123456', '#cc0000', '#dd0000']],
        ['after the last', 100, 331, ['#aa0000', '#bb0000', '#cc0000', '#dd0000', '#123456']],
    ])('drops %s', (_label, x, y, expected) => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        layoutSaved();
        dragTo(recentSwatches()[0]!, x, y);
        expect(ui.settings.savedSwatches).toEqual(expected);
        // A copy: Recent is exactly as it was, and the drop loaded nothing.
        expect(ui.settings.recentColors).toEqual(['#123456', '#654321']);
        expect(ui.session.size).toBe(0);
        expect(ui.log.updateUi).toBe(1);
        expect(savedSwatches().map((swatch) => swatch.style.getPropertyValue('--nexus-studio-swatch'))).toEqual(expected);
    });

    // A copy leaves Recent exactly as it was — even for a colour that is not in front.
    it('copies a colour from further back without moving it in Recent', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        layoutSaved();
        dragTo(recentSwatches()[1]!, 50, 331);
        expect(ui.settings.savedSwatches).toEqual(['#aa0000', '#bb0000', '#654321', '#cc0000', '#dd0000']);
        expect(ui.settings.recentColors).toEqual(['#123456', '#654321']);
        expect(ui.log.updateUiLater).toBe(0);
    });

    it('shows a marker at the insertion point while dragging, and a ghost', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        layoutSaved();
        dragTo(recentSwatches()[0]!, 50, 331, false);
        const marker = popover()!.querySelector<HTMLElement>('.nexus-studio-cp-insert')!;
        expect(marker.dataset.index).toBe('2');
        // In the middle of the gap between B (ends at 48) and C (starts at 52).
        expect(marker.style.left).toBe('49px');
        expect(document.querySelector('.nexus-studio-cp-ghost')).not.toBeNull();
        // Nothing has changed yet: data changes only on the drop.
        expect(ui.settings.savedSwatches).toHaveLength(4);
        document.body.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 331, bubbles: true }));
        expect(popover()!.querySelector('.nexus-studio-cp-insert')).toBeNull();
        expect(document.querySelector('.nexus-studio-cp-ghost')).toBeNull();
    });

    it('does not save a colour twice: nothing changes, and the one there says so', () => {
        const ui = mount(withSettings((s) => ({ ...s, savedSwatches: ['#aa0000', '#123456'], recentColors: ['#123456'] })));
        openFor(ui, WORKSPACE.key);
        layoutSaved();
        dragTo(recentSwatches()[0]!, 2, 331);
        expect(ui.settings.savedSwatches).toEqual(['#aa0000', '#123456']);
        expect(ui.log.updateUi).toBe(0);
        expect(savedSwatches()[1]!.classList.contains('is-found')).toBe(true);
    });

    it('changes nothing when dropped outside Saved', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        layoutSaved();
        dragTo(recentSwatches()[0]!, 50, 40);
        expect(ui.settings.savedSwatches).toHaveLength(4);
        expect(ui.log.updateUi).toBe(0);
        expect(ui.session.size).toBe(0);
    });

    it('never reorders Recent: a drop inside Recent changes nothing', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        layoutSaved();
        dragTo(recentSwatches()[0]!, 30, 200);
        expect(ui.settings.recentColors).toEqual(['#123456', '#654321']);
        expect(ui.log.updateUi + ui.log.updateUiLater).toBe(0);
    });

    it('Escape during a drag cancels it, and only it', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        layoutSaved();
        dragTo(recentSwatches()[0]!, 50, 331, false);
        key(document, 'Escape');
        document.body.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 331, bubbles: true }));
        expect(ui.settings.savedSwatches).toHaveLength(4);
        expect(popovers()).toHaveLength(1);
        expect(popover()!.querySelector('.nexus-studio-cp-insert')).toBeNull();
    });

    // Click vs drag: below the threshold it is a click, and a click still works.
    it('a press that barely moves is still a click', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        const source = recentSwatches()[1]!;
        source.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true, button: 0 }));
        document.body.dispatchEvent(new MouseEvent('pointermove', { clientX: 12, clientY: 11, bubbles: true }));
        document.body.dispatchEvent(new MouseEvent('pointerup', { clientX: 12, clientY: 11, bubbles: true }));
        source.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(ui.session.get(WORKSPACE.key)).toBe('#654321');
        expect(ui.settings.recentColors).toEqual(['#654321', '#123456']);
        expect(document.querySelector('.nexus-studio-cp-ghost')).toBeNull();
    });
});

describe('Saved → Saved is a move', () => {
    const start = () => mount(withSettings((s) => ({ ...s, savedSwatches: ['#aa0000', '#bb0000', '#cc0000', '#dd0000'] })));
    const order = () => savedSwatches().map((swatch) => swatch.style.getPropertyValue('--nexus-studio-swatch'));

    it.each([
        ['D before B', 3, 22, 331, ['#aa0000', '#dd0000', '#bb0000', '#cc0000']],
        ['the first to the end', 0, 100, 331, ['#bb0000', '#cc0000', '#dd0000', '#aa0000']],
        ['the last to the front', 3, 2, 331, ['#dd0000', '#aa0000', '#bb0000', '#cc0000']],
    ])('moves %s, in the data and on screen, and saves it', (_label, from, x, y, expected) => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        layoutSaved();
        dragTo(savedSwatches()[from]!, x, y);
        expect(ui.settings.savedSwatches).toEqual(expected);
        expect(order()).toEqual(expected);
        expect(ui.log.updateUi).toBe(1);
        // Moving is not using: Recent and the draft are untouched.
        expect(ui.settings.recentColors).toEqual([]);
        expect(ui.session.size).toBe(0);
    });

    it('writes nothing when dropped where it already is', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        layoutSaved();
        dragTo(savedSwatches()[1]!, 22, 331);
        // The palette was redrawn by the first drop; lay it out again.
        layoutSaved();
        dragTo(savedSwatches()[1]!, 50, 331);
        expect(ui.settings.savedSwatches).toEqual(['#aa0000', '#bb0000', '#cc0000', '#dd0000']);
        expect(ui.log.updateUi).toBe(0);
    });

    it('moves across a wrapped row', () => {
        const ui = mount(withSettings((s) => ({ ...s, savedSwatches: ['#010101', '#020202', '#030303', '#040404', '#050505', '#060606'] })));
        openFor(ui, WORKSPACE.key);
        layoutSaved(4);
        // The first, to the start of the second row: between the 4th and the 5th.
        dragTo(savedSwatches()[0]!, 2, 357);
        expect(ui.settings.savedSwatches).toEqual(['#020202', '#030303', '#040404', '#010101', '#050505', '#060606']);
    });

    it('exports in the order it was put in', async () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        layoutSaved();
        dragTo(savedSwatches()[3]!, 22, 331);
        // The click after a drag is swallowed for one tick; a real next click comes later.
        await settle();
        inPicker<HTMLButtonElement>('.nexus-studio-cp-more').click();
        ui.log.menus.at(-1)!.find((item) => item.title.startsWith('Export'))!.run();
        expect(ui.log.exports.at(-1)).toEqual(['#aa0000', '#dd0000', '#bb0000', '#cc0000']);
    });

    it('swallows the click after a real drag, so nothing is loaded', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        layoutSaved();
        dragTo(savedSwatches()[3]!, 22, 331);
        expect(ui.session.size).toBe(0);
        expect(ui.settings.recentColors).toEqual([]);
    });
});

describe('Recent is strictly move-to-front', () => {
    // Clicking the same PLACE again and again rotates only the prefix up to it.
    it('clicking slot 4 again and again rotates the first four and leaves the rest', () => {
        const ui = mount(withSettings((s) => ({ ...s, recentColors: ['#aa0000', '#bb0000', '#cc0000', '#dd0000', '#ee0000'] })));
        openFor(ui, WORKSPACE.key);
        const seen: string[][] = [];
        for (let i = 0; i < 4; i += 1) {
            recentSwatches()[3]!.click();
            seen.push([...ui.settings.recentColors]);
        }
        expect(seen).toEqual([
            ['#dd0000', '#aa0000', '#bb0000', '#cc0000', '#ee0000'],
            ['#cc0000', '#dd0000', '#aa0000', '#bb0000', '#ee0000'],
            ['#bb0000', '#cc0000', '#dd0000', '#aa0000', '#ee0000'],
            ['#aa0000', '#bb0000', '#cc0000', '#dd0000', '#ee0000'],
        ]);
    });
});

describe('swatches look like what they are', () => {
    const css = readFileSync('companion/nexus-theme-studio/styles.css', 'utf8').replace(/\r\n/g, '\n');

    const ruleOf = (selector: string): string => {
        const rule = css.slice(css.indexOf(`${selector} {`));
        return rule.slice(0, rule.indexOf('}'));
    };

    // One pipette graphic, defined once in the studio palette.
    it('defines one pipette cursor, hot spot at the tip', () => {
        expect(css.match(/data:image\/svg\+xml/g)).toHaveLength(1);
        expect(css).toMatch(/--nexus-studio-pipette-cursor: url\("data:image\/svg\+xml,[^"]+"\) 2 18;/);
    });

    it('gives Recent and Saved swatches that pipette cursor', () => {
        expect(ruleOf('.nexus-studio-popover .nexus-studio-cp-swatch')).toContain('cursor: var(--nexus-studio-pipette-cursor), copy;');
    });

    // The sampler: the same pipette over the window and over the picker, the
    // mode's own controls keep the pointer.
    it('makes the pipette the cursor wherever the sampler can sample', () => {
        expect(ruleOf('.nexus-studio-pick-shield.is-persistent')).toContain('cursor: var(--nexus-studio-pipette-cursor), crosshair;');
        expect(ruleOf('.nexus-studio-popover.is-sampling-mode')).toContain('cursor: var(--nexus-studio-pipette-cursor), crosshair;');
        expect(ruleOf('.nexus-studio-popover.is-sampling-mode *')).toContain('cursor: inherit;');
        expect(css).toMatch(/\.nexus-studio-popover\.is-sampling-mode :is\([^)]*nexus-studio-cp-sample[^)]*\) \{\n {4}cursor: pointer;/);
        // The one-shot layer (Copy colour, Inspect UI) keeps its crosshair.
        expect(ruleOf('.nexus-studio-pick-shield')).toContain('cursor: crosshair;');
    });

    it('marks the pressed pipette and the sampling picker', () => {
        expect(css).toContain(".nexus-studio-popover .nexus-studio-cp-sample[aria-pressed='true']");
        expect(css).toContain('.nexus-studio-popover.is-sampling-mode');
        expect(css).toContain('.nexus-studio-cp-insert');
    });

    it('keeps the loupe and the reticle neutral: no theme colour paints them', () => {
        const loupe = css.slice(css.indexOf('.nexus-studio-sample-loupe {'), css.indexOf('/* --- top of the panel'));
        expect(loupe).not.toMatch(/var\(--(background|text|interactive)-/);
    });
});

// --- Custom CSS ----------------------------------------------------------------------

describe('a value the picker cannot show is Custom CSS, and stays as written', () => {
    const COMPLEX = 'color-mix(in oklch, #333333 90%, #88aaff 10%)';
    const start = () => mount(withSettings((s) => setOverride(s, FIRST_PROFILE_ID, WORKSPACE.key, COMPLEX)));

    it('opens as Custom CSS, with the raw value in front and no colour controls', () => {
        const ui = start();
        const picker = openFor(ui, WORKSPACE.key);
        expect(picker.classList.contains('is-custom')).toBe(true);
        expect(inPicker('.nexus-studio-cp-readout').textContent).toBe(CUSTOM_CSS_LABEL);
        expect(inPicker<HTMLElement>('.nexus-studio-cp-custom').hidden).toBe(false);
        expect(inPicker<HTMLElement>('.nexus-studio-cp-visual').hidden).toBe(true);
        expect(inPicker<HTMLElement>('.nexus-studio-cp-advanced').hidden).toBe(false);
        expect(inPicker<HTMLInputElement>('.nexus-studio-cp-css').value).toBe(COMPLEX);
        expect(inPicker<HTMLButtonElement>('.nexus-studio-cp-add').disabled).toBe(true);
    });

    it('is not destroyed by opening and closing', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-done').click();
        expect(override(ui, WORKSPACE.key)).toBe(COMPLEX);
        expect(ui.log.updateLive).toBe(0);
    });

    it('takes another complex value as typed, as a draft', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        const next = 'color-mix(in srgb, #000 50%, #fff)';
        type(inPicker<HTMLInputElement>('.nexus-studio-cp-css'), next);
        expect(ui.session.get(WORKSPACE.key)).toBe(next);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-done').click();
        expect(override(ui, WORKSPACE.key)).toBe(next);
    });

    it('refuses what is not a value, without drafting it', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        type(inPicker<HTMLInputElement>('.nexus-studio-cp-css'), '#fff; color: red');
        expect(inPicker('.nexus-studio-cp-css').getAttribute('aria-invalid')).toBe('true');
        expect(ui.session.size).toBe(0);
    });

    // Only on purpose: a converted value is a different value.
    it('converts to a colour only when asked, and says so when it cannot', () => {
        const ui = start();
        openFor(ui, WORKSPACE.key);
        inPicker<HTMLButtonElement>('.nexus-studio-cp-convert').click();
        // happy-dom does not resolve color-mix(); a real Obsidian does.
        if (popover()!.classList.contains('is-custom')) {
            expect(inPicker('.nexus-studio-cp-custom').textContent).toMatch(/cannot be converted/);
            expect(ui.session.size).toBe(0);
        } else {
            expect(parseColorValue(ui.session.get(WORKSPACE.key)!)).not.toBeNull();
        }
        // A plain colour typed into the CSS field is a colour again.
        type(inPicker<HTMLInputElement>('.nexus-studio-cp-css'), '#123456');
        expect(popover()!.classList.contains('is-custom')).toBe(false);
        expect(ui.session.get(WORKSPACE.key)).toBe('#123456');
    });
});

// --- the draft layer ------------------------------------------------------------------

describe('the draft layer is runtime-only', () => {
    it('lays a draft over the profile and under the locator', () => {
        const declarations = overrideDeclarations({ workspaceSurface: '#111111', documentSurface: '#222222' });
        const drafted = withSession(declarations, new Map([['workspaceSurface', '#abcdef']]));
        expect(drafted).toContainEqual([WORKSPACE.cssVariable, '#abcdef']);
        expect(drafted).toContainEqual([DOCUMENT.cssVariable, '#222222']);
        expect(drafted.filter(([name]) => name === WORKSPACE.cssVariable)).toHaveLength(1);
        const located = withPreview(drafted, [WORKSPACE.cssVariable]);
        expect(located).toContainEqual([WORKSPACE.cssVariable, '#ff00ff']);
    });

    it('ignores a draft that is not a valid value, as it ignores such an override', () => {
        expect(withSession([], new Map([['workspaceSurface', 'red; x']]))).toEqual([]);
        expect(withSession([], new Map([['noSuchToken', '#fff']]))).toEqual([]);
    });

    it('is composed in the plugin in that order, and cleared on unload', () => {
        const main = readFileSync('companion/nexus-theme-studio/src/main.ts', 'utf8');
        expect(main).toContain('withPreview(\n                withSession(');
        const unload = main.slice(main.indexOf('onunload(): void'));
        expect(unload.slice(0, unload.indexOf('\n    }'))).toContain('this.sessionValues.clear()');
        // The reader follows drafts through the same event every apply sends.
        const session = main.slice(main.indexOf('setSessionValue(key: string'));
        expect(session.slice(0, session.indexOf('\n    }'))).toContain('this.applyActiveProfile()');
    });
});

// --- the control plane ---------------------------------------------------------------

describe('the picker is on the control plane', () => {
    const css = readFileSync('companion/nexus-theme-studio/styles.css', 'utf8').replace(/\r\n/g, '\n');
    const block = css.slice(css.indexOf('/* --- the colour picker'), css.indexOf('/* --- narrow docks'));

    it('carries the isolation class, which re-points Obsidian variables to the studio palette', () => {
        const ui = mount();
        expect(openFor(ui, WORKSPACE.key).classList.contains('nexus-studio-isolated')).toBe(true);
        expect(css).toContain('.nexus-studio,\n.nexus-studio-isolated {');
    });

    // Its text, surfaces and borders come from the studio's palette. No Nexus
    // presentation token, and no Obsidian variable Nexus re-points, is read.
    it('paints itself from the studio palette only', () => {
        expect(block.length).toBeGreaterThan(500);
        const vars = Array.from(block.matchAll(/var\((--[a-z0-9-]+)/g)).map((match) => match[1]!);
        for (const name of vars) {
            if (name.startsWith('--nexus-')) expect(name.startsWith('--nexus-studio-')).toBe(true);
            expect(['--background-primary', '--background-secondary', '--text-normal', '--text-muted']).not.toContain(
                name
            );
        }
        expect(block).toContain('background-color: var(--nexus-studio-surface-elevated)');
        expect(block).toContain('color: var(--nexus-studio-text)');
    });

    it('draws the keyboard reticle in black and white, never in a theme colour', () => {
        const reticle = css.slice(css.indexOf('.nexus-studio-pick-reticle {'), css.indexOf('.nexus-studio-pick-hint {'));
        expect(reticle).not.toMatch(/var\(--/);
    });
});
