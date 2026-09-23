// @vitest-environment happy-dom
//
// Tests for the studio's discovery tools, its typography rows and its contrast
// section, against a real (happy-dom) document.
//
// Electron is faked at exactly one seam — `window.electron.remote
// .getCurrentWebContents()`, the object Obsidian's own renderer uses — and at
// nothing below it. What the real WebContents does with those calls (DevTools
// opening, a pixel captured) is checked live by scripts/smokeView.mjs.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NEXUS_CONTRAST_PAIRS, nexusToken } from '../theme/nexus/src/tokens';
import { inspectAvailable, quadCentre, startInspect } from '../companion/nexus-theme-studio/src/inspectUi';
import { PAINT_WAIT_MS, afterPaint, pickPoint } from '../companion/nexus-theme-studio/src/pickPoint';
import {
    FIRST_PROFILE_ID,
    activeProfile,
    defaultSettings,
    setOverride,
    type NexusStudioSettings,
} from '../companion/nexus-theme-studio/src/profiles';
import { sampleColor, samplerKind } from '../companion/nexus-theme-studio/src/sampler';
import {
    CONTRAST_DISCLAIMER,
    CONTRAST_GROUP,
    StudioPanel,
    type StudioPanelHost,
} from '../companion/nexus-theme-studio/src/studioPanel';
import { LOCATOR_DELAY_MS } from '../companion/nexus-theme-studio/src/tokenRow';

// --- a fake WebContents ---------------------------------------------------------

interface FakeWebContents {
    zoom: number;
    captures: Array<{ x: number; y: number; width: number; height: number }>;
    inspected: Array<[number, number]>;
    commands: Array<[string, unknown]>;
    attached: boolean;
    attachThrows: boolean;
    /** Chromium replays the last `inspectElement` node when Overlay is enabled again. */
    replayOnEnable: boolean;
    listeners: Array<(event: unknown, method: string, params: unknown) => void>;
}

function installElectron(options: Partial<Pick<FakeWebContents, 'zoom' | 'attachThrows' | 'replayOnEnable'>> = {}): FakeWebContents {
    const state: FakeWebContents = {
        zoom: options.zoom ?? 1,
        captures: [],
        inspected: [],
        commands: [],
        attached: false,
        attachThrows: options.attachThrows ?? false,
        replayOnEnable: options.replayOnEnable ?? false,
        listeners: [],
    };
    const wc = {
        getZoomFactor: () => state.zoom,
        capturePage: (rect: { x: number; y: number; width: number; height: number }) => {
            state.captures.push(rect);
            return Promise.resolve({ toPNG: () => new Uint8Array(), getSize: () => ({ width: 1, height: 1 }) });
        },
        inspectElement: (x: number, y: number) => {
            state.inspected.push([x, y]);
        },
        debugger: {
            isAttached: () => state.attached,
            attach: () => {
                if (state.attachThrows) throw new Error('Another debugger is already attached');
                state.attached = true;
            },
            detach: () => {
                state.attached = false;
            },
            sendCommand: (method: string, params?: unknown) => {
                state.commands.push([method, params]);
                if (method === 'Overlay.enable' && state.replayOnEnable) {
                    for (const listener of [...state.listeners]) listener({}, 'Overlay.inspectNodeRequested', { backendNodeId: 99 });
                }
                if (method === 'DOM.getBoxModel') {
                    return Promise.resolve({ model: { content: [10, 20, 30, 20, 30, 40, 10, 40] } });
                }
                return Promise.resolve({});
            },
            on: (_event: string, listener: (event: unknown, method: string, params: unknown) => void) => {
                state.listeners.push(listener);
            },
            removeListener: (_event: string, listener: (event: unknown, method: string, params: unknown) => void) => {
                state.listeners = state.listeners.filter((entry) => entry !== listener);
            },
        },
    };
    (window as unknown as { electron: unknown }).electron = { remote: { getCurrentWebContents: () => wc } };
    return state;
}

const flush = () => new Promise((resolve) => window.setTimeout(resolve, 0));

beforeEach(() => {
    document.body.replaceChildren();
});

afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { electron?: unknown }).electron;
    delete (window as unknown as { EyeDropper?: unknown }).EyeDropper;
});

// --- the pick layer -------------------------------------------------------------

describe('picking a point', () => {
    it('lays a transparent shield with a hint, and reports the click', async () => {
        const pick = pickPoint(document, 'Click somewhere');
        const shield = document.querySelector<HTMLElement>('.nexus-studio-pick-shield')!;
        expect(shield).not.toBeNull();
        expect(shield.querySelector('.nexus-studio-pick-hint')?.textContent).toBe('Click somewhere');
        shield.dispatchEvent(new MouseEvent('click', { clientX: 12, clientY: 34, bubbles: true }));
        await expect(pick.result).resolves.toEqual({ x: 12, y: 34 });
        // The hint goes at once; the shield stays until released, so nothing
        // under the click turns to its hover colour before a capture.
        expect(document.querySelector('.nexus-studio-pick-hint')).toBeNull();
        expect(document.querySelector('.nexus-studio-pick-shield')).not.toBeNull();
        pick.release();
        expect(document.querySelector('.nexus-studio-pick-shield')).toBeNull();
    });

    it('cancels on Escape and leaves nothing behind', async () => {
        const pick = pickPoint(document, 'x');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await expect(pick.result).resolves.toBeNull();
        expect(document.querySelector('.nexus-studio-pick-shield')).toBeNull();
    });

    it('cancels on a right-click', async () => {
        const pick = pickPoint(document, 'x');
        document.querySelector('.nexus-studio-pick-shield')!.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
        );
        await expect(pick.result).resolves.toBeNull();
    });

    // Measured live: a hidden or fully covered Obsidian window produces no
    // animation frames at all. Waiting for two of them with no ceiling left the
    // sampler hanging and its layer on screen.
    it('does not wait for a frame that never comes', async () => {
        vi.useFakeTimers();
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
        let done = false;
        void afterPaint(document).then(() => {
            done = true;
        });
        await vi.advanceTimersByTimeAsync(PAINT_WAIT_MS - 1);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        expect(done).toBe(true);
        raf.mockRestore();
    });

    it('can be cancelled from outside, once', async () => {
        const pick = pickPoint(document, 'x');
        pick.cancel();
        pick.cancel();
        await expect(pick.result).resolves.toBeNull();
        expect(document.querySelector('.nexus-studio-pick-shield')).toBeNull();
    });
});

// --- the sampler ------------------------------------------------------------------

describe('taking a colour off Obsidian', () => {
    it('prefers the capture sampler where Electron is reachable', () => {
        expect(samplerKind(window)).toBe('none');
        (window as unknown as { EyeDropper: unknown }).EyeDropper = class {};
        expect(samplerKind(window)).toBe('eyedropper');
        installElectron();
        expect(samplerKind(window)).toBe('capture');
    });

    it('reads exactly one pixel under the click', async () => {
        const wc = installElectron();
        const session = sampleColor(window, () => Promise.resolve([51, 51, 51, 255]));
        document
            .querySelector('.nexus-studio-pick-shield')!
            .dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 50, bubbles: true }));
        await expect(session.result).resolves.toBe('#333333');
        expect(wc.captures).toEqual([{ x: 100, y: 50, width: 1, height: 1 }]);
        expect(document.querySelector('.nexus-studio-pick-shield')).toBeNull();
    });

    // Obsidian's zoom (Ctrl+= / Ctrl+-) separates page pixels from window pixels.
    it('asks for the pixel in window coordinates at any zoom', async () => {
        const wc = installElectron({ zoom: 1.25 });
        const session = sampleColor(window, () => Promise.resolve([0, 0, 0, 255]));
        document
            .querySelector('.nexus-studio-pick-shield')!
            .dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 40, bubbles: true }));
        await session.result;
        expect(wc.captures[0]).toEqual({ x: 125, y: 50, width: 1, height: 1 });
    });

    it('captures nothing and answers null when cancelled', async () => {
        const wc = installElectron();
        const session = sampleColor(window, () => Promise.resolve([255, 0, 0, 255]));
        session.cancel();
        await expect(session.result).resolves.toBeNull();
        expect(wc.captures).toEqual([]);
    });

    it('answers null rather than guessing when a pixel cannot be read', async () => {
        installElectron();
        const session = sampleColor(window, () => Promise.resolve(null));
        document
            .querySelector('.nexus-studio-pick-shield')!
            .dispatchEvent(new MouseEvent('click', { clientX: 1, clientY: 1, bubbles: true }));
        await expect(session.result).resolves.toBeNull();
    });

    it('falls back to the native pipette only where capture is not reachable', async () => {
        (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
            open(): Promise<{ sRGBHex: string }> {
                return Promise.resolve({ sRGBHex: '#123456' });
            }
        };
        await expect(sampleColor(window).result).resolves.toBe('#123456');
        expect(document.querySelector('.nexus-studio-pick-shield')).toBeNull();
    });
});

// --- Inspect UI -----------------------------------------------------------------

describe('Inspect UI', () => {
    it('says it is unavailable where Electron is not reachable', async () => {
        expect(inspectAvailable(window)).toBe(false);
        await expect(startInspect(window).result).resolves.toBe('unavailable');
    });

    it('switches on DevTools\' own element picker through the protocol', async () => {
        const wc = installElectron();
        const session = startInspect(window);
        await flush();
        expect(wc.attached).toBe(true);
        const inspectMode = wc.commands.find(([method]) => method === 'Overlay.setInspectMode');
        expect((inspectMode?.[1] as { mode: string }).mode).toBe('searchForNode');

        // The user clicks an element: DevTools opens on it, the picker goes off.
        for (const listener of wc.listeners) listener({}, 'Overlay.inspectNodeRequested', { backendNodeId: 7 });
        await expect(session.result).resolves.toBe('inspected');
        expect(wc.inspected).toEqual([[20, 30]]);
        expect(wc.attached).toBe(false);
        expect(wc.listeners).toHaveLength(0);
        const last = wc.commands.filter(([method]) => method === 'Overlay.setInspectMode').at(-1);
        expect((last?.[1] as { mode: string }).mode).toBe('none');
    });

    it('ignores the pick Chromium replays before the picker is on', async () => {
        // Live in Obsidian 1.13.7: after one inspect, the next Overlay.enable
        // fires inspectNodeRequested for the old node with no click at all.
        const wc = installElectron({ replayOnEnable: true });
        const session = startInspect(window);
        await flush();
        expect(wc.inspected).toEqual([]);
        expect(wc.attached).toBe(true);

        // A real click after that still works.
        for (const listener of wc.listeners) listener({}, 'Overlay.inspectNodeRequested', { backendNodeId: 7 });
        await expect(session.result).resolves.toBe('inspected');
        expect(wc.inspected).toEqual([[20, 30]]);
    });

    it('opens DevTools at the element under a zoomed page', async () => {
        const wc = installElectron({ zoom: 2 });
        const session = startInspect(window);
        await flush();
        for (const listener of wc.listeners) listener({}, 'Overlay.inspectNodeRequested', { backendNodeId: 1 });
        await session.result;
        expect(wc.inspected).toEqual([[40, 60]]);
    });

    it('switches the picker off and lets go on Escape', async () => {
        const wc = installElectron();
        const session = startInspect(window);
        await flush();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await expect(session.result).resolves.toBe('cancelled');
        expect(wc.attached).toBe(false);
        expect(wc.inspected).toEqual([]);
    });

    it('can be cancelled from outside — a closing view, an unloading plugin', async () => {
        const wc = installElectron();
        const session = startInspect(window);
        await flush();
        session.cancel();
        await expect(session.result).resolves.toBe('cancelled');
        expect(wc.attached).toBe(false);
    });

    // Something else holding the protocol client is not a reason to give up:
    // the same result through a click and inspectElement, minus the highlight.
    it('falls back to a click when the protocol client is taken', async () => {
        const wc = installElectron({ attachThrows: true });
        const session = startInspect(window);
        document
            .querySelector('.nexus-studio-pick-shield')!
            .dispatchEvent(new MouseEvent('click', { clientX: 55, clientY: 66, bubbles: true }));
        await expect(session.result).resolves.toBe('inspected');
        expect(wc.inspected).toEqual([[55, 66]]);
    });

    // A synthetic Ctrl+Shift+I is not an API, and is not a fallback here.
    it('never simulates a keyboard shortcut', () => {
        const source = readFileSync('companion/nexus-theme-studio/src/inspectUi.ts', 'utf8');
        const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code).not.toMatch(/new KeyboardEvent|sendInputEvent|dispatchEvent|Ctrl\+Shift/);
    });

    it('finds the centre of a box model quad', () => {
        expect(quadCentre([10, 20, 30, 20, 30, 40, 10, 40])).toEqual({ x: 20, y: 30 });
        expect(quadCentre([1, 2, 3])).toBeNull();
    });

    it('is a command as well as a button', () => {
        const main = readFileSync('companion/nexus-theme-studio/src/main.ts', 'utf8');
        expect(main).toContain("id: 'inspect-ui'");
        expect(main).toContain("name: 'Inspect UI'");
        const unload = main.slice(main.indexOf('onunload(): void'));
        expect(unload.slice(0, unload.indexOf('clearTokenOverrides'))).toContain('this.inspectSession?.cancel()');
    });
});

// --- the panel ----------------------------------------------------------------------

function mount(initial: NexusStudioSettings = defaultSettings()) {
    let settings = initial;
    const log = { updateLive: 0, update: 0, previews: [] as string[][] };
    const root = document.createElement('div');
    document.body.appendChild(root);
    let panel: StudioPanel | null = null;
    const host: StudioPanelHost = {
        settings: () => settings,
        themeIsActive: () => true,
        update: (next) => {
            settings = next;
            log.update += 1;
            panel?.render();
            return Promise.resolve();
        },
        updateLive: (next) => {
            settings = next;
            log.updateLive += 1;
        },
        updateUi: (next) => {
            settings = next;
            return Promise.resolve();
        },
        setPreview: (variables) => {
            log.previews.push([...variables]);
        },
        promptName: () => Promise.resolve(null),
        openTransfer: () => undefined,
        showMenu: () => undefined,
        notify: () => undefined,
    };
    panel = new StudioPanel(root, host);
    panel.render();
    const row = (key: string) => root.querySelector<HTMLElement>(`.nexus-studio-row[data-token="${key}"]`)!;
    return {
        root,
        panel,
        log,
        get settings() {
            return settings;
        },
        row,
        inRow: <T extends Element>(key: string, selector: string) => row(key).querySelector<T>(selector)!,
    };
}

const type = (input: HTMLInputElement | HTMLSelectElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};

describe('the discovery tools in the panel', () => {
    it('offers Inspect UI, disabled with a reason where DevTools cannot be reached', () => {
        const ui = mount();
        const inspect = ui.root.querySelector<HTMLButtonElement>('[data-tool="inspect"]')!;
        expect(inspect.textContent).toContain('Inspect UI');
        expect(inspect.disabled).toBe(true);
        expect(inspect.getAttribute('aria-label')).toMatch(/cannot be reached/);
    });

    it('enables it where DevTools can be reached', () => {
        installElectron();
        const ui = mount();
        expect(ui.root.querySelector<HTMLButtonElement>('[data-tool="inspect"]')!.disabled).toBe(false);
    });

    it('offers a colour pick only where some sampler exists', () => {
        expect(mount().root.querySelector('[data-tool="pick"]')).toBeNull();
        installElectron();
        expect(mount().root.querySelector('[data-tool="pick"]')).not.toBeNull();
    });

    it('ends a running pick when the panel goes away', () => {
        installElectron();
        const ui = mount();
        ui.inRow<HTMLButtonElement>('workspaceSurface', '.nexus-studio-pipette').click();
        expect(document.querySelector('.nexus-studio-pick-shield')).not.toBeNull();
        ui.panel.dispose();
        expect(document.querySelector('.nexus-studio-pick-shield')).toBeNull();
    });

    it('writes nothing until a colour has actually been taken', async () => {
        installElectron();
        const ui = mount();
        ui.inRow<HTMLButtonElement>('workspaceSurface', '.nexus-studio-pipette').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await flush();
        expect(ui.log.updateLive).toBe(0);
    });
});

describe('typography rows', () => {
    it('drive the size with a slider written the way the default is written', () => {
        const ui = mount();
        type(ui.inRow<HTMLInputElement>('uiFontSize', '.nexus-studio-range'), '14.5');
        expect(activeProfile(ui.settings).overrides.uiFontSize).toBe('14.5px');
        expect(ui.inRow<HTMLElement>('uiFontSize', '.nexus-studio-range-readout').textContent).toBe('14.5px');
        type(ui.inRow<HTMLInputElement>('uiFontSize', '.nexus-studio-range'), '13');
        expect(activeProfile(ui.settings).overrides.uiFontSize).toBe('13px');
    });

    it('drive the line height with a unitless slider', () => {
        const ui = mount();
        type(ui.inRow<HTMLInputElement>('uiLineHeight', '.nexus-studio-range'), '1.45');
        expect(activeProfile(ui.settings).overrides.uiLineHeight).toBe('1.45');
    });

    // A value the slider cannot show keeps its text, and the slider waits.
    it('park the slider for a value it cannot show, rather than snapping it', () => {
        const ui = mount(setOverride(defaultSettings(), FIRST_PROFILE_ID, 'uiFontSize', 'calc(13px * 1.1)'));
        expect(ui.inRow<HTMLInputElement>('uiFontSize', '.nexus-studio-range').disabled).toBe(true);
        expect(ui.inRow<HTMLElement>('uiFontSize', '.nexus-studio-value').textContent).toBe('CSS');
        expect(activeProfile(ui.settings).overrides.uiFontSize).toBe('calc(13px * 1.1)');
    });

    it('refuse a size that is not one, without writing', () => {
        const ui = mount();
        ui.inRow<HTMLButtonElement>('uiFontSize', '.nexus-studio-value').click();
        const field = ui.inRow<HTMLInputElement>('uiFontSize', '.nexus-studio-css-input');
        type(field, 'huge');
        expect(field.getAttribute('aria-invalid')).toBe('true');
        expect(ui.log.updateLive).toBe(0);
    });

    it('offer font suggestions and take any family list', () => {
        const ui = mount();
        const select = ui.inRow<HTMLSelectElement>('uiFontFamily', '.nexus-studio-font-select');
        const suggestions = nexusToken('uiFontFamily')!.suggestions!;
        expect(Array.from(select.options).map((option) => option.value).filter(Boolean)).toEqual(
            suggestions.map((suggestion) => suggestion.value)
        );
        type(select, suggestions[1]!.value);
        expect(activeProfile(ui.settings).overrides.uiFontFamily).toBe(suggestions[1]!.value);
        expect(ui.inRow<HTMLInputElement>('uiFontFamily', '.nexus-studio-font-input').value).toBe(
            suggestions[1]!.value
        );

        type(ui.inRow<HTMLInputElement>('uiFontFamily', '.nexus-studio-font-input'), 'Optima, sans-serif');
        expect(activeProfile(ui.settings).overrides.uiFontFamily).toBe('Optima, sans-serif');
    });

    it('show the font in its own family', () => {
        const ui = mount(setOverride(defaultSettings(), FIRST_PROFILE_ID, 'uiFontFamily', 'Georgia, serif'));
        const glyph = ui.inRow<HTMLElement>('uiFontFamily', '.nexus-studio-glyph');
        expect(glyph.style.getPropertyValue('--nexus-studio-font-preview')).toBe('Georgia, serif');
    });

    it('reset one token back to the theme', () => {
        const ui = mount(setOverride(defaultSettings(), FIRST_PROFILE_ID, 'uiFontSize', '15px'));
        ui.inRow<HTMLButtonElement>('uiFontSize', '.nexus-studio-reset').click();
        expect(activeProfile(ui.settings).overrides.uiFontSize).toBeUndefined();
        expect(ui.inRow<HTMLInputElement>('uiFontSize', '.nexus-studio-range').value).toBe('13');
    });

    // Painting a font size magenta is not a preview; it breaks every size.
    it('are never painted by the locator', () => {
        vi.useFakeTimers();
        const ui = mount();
        ui.log.previews.length = 0;
        ui.row('uiFontSize').dispatchEvent(new Event('pointerenter'));
        vi.advanceTimersByTime(LOCATOR_DELAY_MS * 3);
        expect(ui.log.previews.filter((entry) => entry.length > 0)).toEqual([]);
    });
});

describe('the contrast section', () => {
    it('shows every registered pair, with the disclaimer', () => {
        const ui = mount();
        const group = ui.root.querySelector(`.nexus-studio-group[data-group="${CONTRAST_GROUP}"]`)!;
        expect(group.querySelectorAll('.nexus-studio-contrast-row')).toHaveLength(NEXUS_CONTRAST_PAIRS.length);
        expect(group.textContent).toContain(CONTRAST_DISCLAIMER);
    });

    it('passes every pair at the theme defaults', () => {
        const ui = mount();
        for (const row of Array.from(ui.root.querySelectorAll('.nexus-studio-contrast-row'))) {
            expect(row.classList.contains('is-text')).toBe(true);
            expect(row.querySelector('.nexus-studio-contrast-figure')!.textContent).toMatch(/^\d+\.\d:1 ✓$/);
        }
    });

    it('warns, live, when text sinks into its surface — and changes nothing', () => {
        const ui = mount();
        type(ui.inRow<HTMLInputElement>('textPrimary', '.nexus-studio-picker'), '#3a3a3a');
        const onDocks = ui.root.querySelector('[data-pair="textPrimary:workspaceSurface"]')!;
        expect(onDocks.classList.contains('is-too-low')).toBe(true);
        expect(onDocks.querySelector('.nexus-studio-contrast-figure')!.textContent).toMatch(/✗$/);
        const meta = ui.root.querySelector(`.nexus-studio-group[data-group="${CONTRAST_GROUP}"] .nexus-studio-group-meta`)!;
        expect(meta.textContent).toMatch(/below 4\.5:1/);
        // The one write is the user's own; contrast added none.
        expect(ui.log.updateLive).toBe(1);
        expect(activeProfile(ui.settings).overrides.textPrimary).toBe('#3a3a3a');
    });

    it('does not guess a value it cannot read', () => {
        const ui = mount(
            setOverride(defaultSettings(), FIRST_PROFILE_ID, 'textPrimary', 'color-mix(in oklch, #fff, #000)')
        );
        const onDocks = ui.root.querySelector('[data-pair="textPrimary:workspaceSurface"]')!;
        // happy-dom does not resolve color-mix; a real Obsidian may, and then
        // the figure is real. Either way it is never a made-up number.
        const figure = onDocks.querySelector('.nexus-studio-contrast-figure')!.textContent ?? '';
        expect(figure === '—' || /^\d+\.\d:1/.test(figure)).toBe(true);
    });
});
