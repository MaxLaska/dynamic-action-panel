// colorPicker.ts
// The Nexus colour picker: the one place a colour token is edited.
//
// WHY OUR OWN. The row used to hide a native `<input type="color">` under its
// swatch. What that opens is Chromium's colour popup — browser UI, drawn
// outside the page. No CSS reaches it, no DOM can be added to it, and it has
// no API: it cannot hold an opacity, a palette, or a different pipette. And its
// own pipette is Chromium's EyeDropper, whose magnifier draws a red grid in
// Electron (see sampler.ts). So the popup could not be extended, only
// replaced; the studio no longer opens it anywhere.
//
// WHAT IT HOLDS, and nothing else: a saturation/brightness square and a hue bar;
// opacity where the token has one; the value as HEX, RGB or HSL (a display
// choice — switching writes nothing); Pick from Obsidian (sampler.ts, no red
// grid); the studio's palette; and, behind "CSS value", the raw text for what
// the picker cannot show — `color-mix()`, `var()`, `oklch()`. Such a value
// opens as Custom CSS and is never rewritten unless the user converts it.
//
// A SESSION, not a form. Every change is a DRAFT: applied to the whole
// workspace at once (and the reader, through the same token path as any other
// value) but not written to the profile. Done, Enter or a click outside
// COMMITS the draft as one ordinary override write. Escape or Revert CANCELS:
// the draft is dropped and the value from before the picker opened is back,
// exactly, because the profile underneath was never touched. The panel owns
// what commit and cancel mean (studioPanel.ts); this file only reports which.
//
// One picker at a time. It lives on the document body, positioned against its
// swatch, so a narrow dock does not clip it; it carries the studio's control
// plane palette, so the colours being edited never style the picker itself.

import { setIcon } from 'obsidian';

import type { ThemeTokenDefinition } from '../../../theme/nexus/src/tokens';
import {
    COLOR_FORMATS,
    describeColor,
    hslToRgba,
    hsvaToRgba,
    parseRgba,
    rgbaToCss,
    rgbaToHex,
    rgbaToHsla,
    rgbaToHsva,
    roundAlpha,
    type ColorFormat,
    type Hsva,
    type Rgba,
} from './colorValue';
import { button, docOf, el } from './dom';
import { isValidValueFor } from './overrides';

/** One entry in a swatch's menu. */
export interface PickerMenuItem {
    title: string;
    icon: string;
    run(): void;
}

/** What the picker needs from the panel. */
export interface ColorPickerHost {
    readonly token: ThemeTokenDefinition;
    /** The token's value when the picker opened: what Escape returns to. */
    readonly initialValue: string;
    /** The display format to open in. */
    readonly format: ColorFormat;
    /** Remembers the display format. Never changes a value. */
    setFormat(format: ColorFormat): void;
    /** Shows a draft on the workspace. Not saved. */
    preview(value: string): void;
    /** The picker is closing: keep the draft, or drop it. */
    finish(outcome: 'commit' | 'cancel', value: string): void;
    /** Whether Pick from Obsidian can work in this window. */
    readonly canSample: boolean;
    /** Takes a colour off the Obsidian window, `#rrggbb`; null when cancelled. */
    sample(): Promise<string | null>;
    /** What the browser resolves a CSS value to, for converting Custom CSS. */
    resolve(value: string): string | null;
    /** The studio's palette. */
    palette: {
        list(): readonly string[];
        add(value: string): void;
        remove(index: number): void;
        replace(index: number, value: string): void;
    };
    showMenu(evt: MouseEvent, items: PickerMenuItem[]): void;
}

export interface ColorPickerHandle {
    readonly token: ThemeTokenDefinition;
    readonly el: HTMLElement;
    /** Closes, committing or cancelling. Harmless when already closed. */
    close(outcome: 'commit' | 'cancel'): void;
}

/** What the Custom CSS state is called. */
export const CUSTOM_CSS_LABEL = 'Custom CSS';

/** Shift+arrow on the square or a bar moves this far. */
export const PICKER_STEP_LARGE = 10;

/** Distance kept from the window's edges and from the swatch. */
const EDGE = 8;
const GAP = 6;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

type Detach = () => void;

export function openColorPicker(anchor: HTMLElement, host: ColorPickerHost): ColorPickerHandle {
    const doc = docOf(anchor);
    const win = doc.defaultView ?? window;
    const token = host.token;
    const detaches: Detach[] = [];
    const on = <K extends keyof HTMLElementEventMap>(
        target: HTMLElement,
        type: K,
        handler: (event: HTMLElementEventMap[K]) => void
    ): void => {
        target.addEventListener(type, handler);
        detaches.push(() => target.removeEventListener(type, handler));
    };

    // --- state ------------------------------------------------------------------
    const initial = parseRgba(host.initialValue);
    let mode: 'color' | 'custom' = initial ? 'color' : 'custom';
    let hsva: Hsva = rgbaToHsva(initial ?? { r: 0, g: 0, b: 0, a: 1 });
    let rgba: Rgba = initial ?? { r: 0, g: 0, b: 0, a: 1 };
    /** The CSS text of the draft: what is previewed, and what a commit keeps. */
    let current = host.initialValue;
    let format: ColorFormat = host.format;
    let sampling = false;
    let closed = false;
    const withAlpha = token.supportsAlpha === true || (initial !== null && initial.a < 1);

    // --- the shell ----------------------------------------------------------------
    const root = doc.createElement('div');
    root.className = 'nexus-studio-popover nexus-studio-isolated';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', `${token.label} colour`);
    root.setAttribute('data-token', token.key);
    doc.body.appendChild(root);

    const head = el(root, 'div', { cls: 'nexus-studio-cp-head' });
    const compare = el(head, 'span', { cls: 'nexus-studio-cp-compare' });
    const before = el(compare, 'span', {
        cls: 'nexus-studio-cp-before',
        attr: { title: `Before: ${host.initialValue} — Esc returns to it` },
    });
    before.style.setProperty('--nexus-studio-swatch', host.initialValue);
    const now = el(compare, 'span', { cls: 'nexus-studio-cp-now' });
    const titles = el(head, 'div', { cls: 'nexus-studio-cp-titles' });
    el(titles, 'div', { cls: 'nexus-studio-cp-title', text: token.label });
    const readout = el(titles, 'div', { cls: 'nexus-studio-cp-readout' });

    // Custom CSS: said in words, with the one explicit way out.
    const custom = el(root, 'div', { cls: 'nexus-studio-cp-custom' });
    el(custom, 'strong', { text: CUSTOM_CSS_LABEL });
    const customNote = el(custom, 'span', {
        text: ' — the picker cannot show this value without changing it, so it stays exactly as written.',
    });
    const convert = button(custom, { cls: 'nexus-studio-cp-convert', text: 'Convert to colour' });

    const visual = el(root, 'div', { cls: 'nexus-studio-cp-visual' });
    const area = el(visual, 'div', {
        cls: 'nexus-studio-cp-area',
        attr: {
            tabindex: '0',
            role: 'slider',
            'aria-label': 'Saturation and brightness',
            'aria-valuemin': '0',
            'aria-valuemax': '100',
        },
    });
    const thumb = el(area, 'span', { cls: 'nexus-studio-cp-thumb' });
    const hue = el(visual, 'input', {
        cls: 'nexus-studio-cp-hue',
        attr: { type: 'range', min: '0', max: '360', step: '1', 'aria-label': 'Hue' },
    });
    let alphaRange: HTMLInputElement | null = null;
    let alphaNumber: HTMLInputElement | null = null;
    if (withAlpha) {
        const line = el(visual, 'div', { cls: 'nexus-studio-cp-alpha-line' });
        alphaRange = el(line, 'input', {
            cls: 'nexus-studio-cp-alpha',
            attr: { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Opacity' },
        });
        alphaNumber = el(line, 'input', {
            cls: 'nexus-studio-cp-alpha-number',
            attr: { type: 'number', min: '0', max: '100', step: '1', 'aria-label': 'Opacity percent' },
        });
        el(line, 'span', { cls: 'nexus-studio-cp-unit', text: '%' });
    }

    const formats = el(visual, 'div', {
        cls: 'nexus-studio-cp-formats',
        attr: { role: 'group', 'aria-label': 'Format' },
    });
    const formatButtons = new Map<ColorFormat, HTMLButtonElement>();
    for (const option of COLOR_FORMATS) {
        const chip = button(formats, {
            cls: 'nexus-studio-cp-format',
            text: option.toUpperCase(),
            attr: { 'data-format': option },
        });
        formatButtons.set(option, chip);
        on(chip, 'click', () => {
            // A display choice: the fields change, the value does not.
            format = option;
            host.setFormat(option);
            buildFields();
            refresh();
        });
    }
    const fields = el(visual, 'div', { cls: 'nexus-studio-cp-fields' });
    let fieldDetaches: Detach[] = [];
    const fieldInputs = new Map<string, HTMLInputElement>();

    let sampleButton: HTMLButtonElement | null = null;
    if (host.canSample) {
        sampleButton = button(root, {
            cls: 'nexus-studio-cp-sample',
            attr: { 'aria-label': 'Pick from Obsidian — click a point, or aim with the arrows and press Enter' },
        });
        setIcon(el(sampleButton, 'span', { cls: 'nexus-studio-cp-sample-icon' }), 'pipette');
        el(sampleButton, 'span', { text: 'Pick from Obsidian' });
    }

    const paletteBox = el(root, 'div', { cls: 'nexus-studio-cp-palette' });
    el(paletteBox, 'div', { cls: 'nexus-studio-cp-palette-label', text: 'Swatches' });
    const grid = el(paletteBox, 'div', {
        cls: 'nexus-studio-cp-swatches',
        attr: { role: 'group', 'aria-label': 'Saved swatches' },
    });

    const advancedToggle = button(root, {
        cls: 'nexus-studio-cp-advanced-toggle',
        text: 'CSS value',
        attr: { 'aria-expanded': 'false' },
    });
    const advanced = el(root, 'div', { cls: 'nexus-studio-cp-advanced' });
    const cssInput = el(advanced, 'input', {
        cls: 'nexus-studio-cp-css',
        attr: { type: 'text', spellcheck: 'false', 'aria-label': `${token.label} CSS value` },
    });
    cssInput.value = host.initialValue;

    const actions = el(root, 'div', { cls: 'nexus-studio-cp-actions' });
    const revert = button(actions, {
        cls: 'nexus-studio-cp-cancel',
        text: 'Revert',
        attr: { title: 'Back to the value from before (Esc)' },
    });
    const done = button(actions, {
        cls: ['mod-cta', 'nexus-studio-cp-done'],
        text: 'Done',
        attr: { title: 'Keep this colour (Enter, or click outside)' },
    });

    // --- writing ----------------------------------------------------------------------
    let previewed = host.initialValue;
    const show = (value: string): void => {
        current = value;
        if (value === previewed) return;
        previewed = value;
        host.preview(value);
    };

    /** A new colour from the square, the bars or a field: the one path. */
    const setHsva = (next: Hsva): void => {
        mode = 'color';
        hsva = { h: clamp(next.h, 0, 360), s: clamp(next.s, 0, 100), v: clamp(next.v, 0, 100), a: roundAlpha(next.a) };
        rgba = hsvaToRgba(hsva);
        show(rgbaToCss(rgba));
        refresh();
    };

    /**
     * A new colour given as RGBA. A grey or black has no hue (and black no
     * saturation) of its own, so the picker keeps the ones it had — dragging
     * the square through black does not throw the hue bar back to red.
     */
    const setRgba = (next: Rgba): void => {
        const derived = rgbaToHsva(next);
        const hueless = derived.s === 0 || derived.v === 0;
        mode = 'color';
        hsva = {
            h: hueless ? hsva.h : derived.h,
            s: derived.v === 0 ? hsva.s : derived.s,
            v: derived.v,
            a: roundAlpha(next.a),
        };
        rgba = { r: Math.round(next.r), g: Math.round(next.g), b: Math.round(next.b), a: roundAlpha(next.a) };
        show(rgbaToCss(rgba));
        refresh();
    };

    // --- the square ---------------------------------------------------------------------
    const fromPointer = (event: PointerEvent): void => {
        const box = area.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return;
        const s = ((event.clientX - box.left) / box.width) * 100;
        const v = 100 - ((event.clientY - box.top) / box.height) * 100;
        setHsva({ ...hsva, s, v });
    };
    let dragging = false;
    on(area, 'pointerdown', (event) => {
        dragging = true;
        area.setPointerCapture?.(event.pointerId);
        area.focus();
        fromPointer(event);
        event.preventDefault();
    });
    on(area, 'pointermove', (event) => {
        if (dragging) fromPointer(event);
    });
    const endDrag = (event: PointerEvent): void => {
        if (!dragging) return;
        dragging = false;
        area.releasePointerCapture?.(event.pointerId);
    };
    on(area, 'pointerup', endDrag);
    on(area, 'pointercancel', endDrag);
    on(area, 'keydown', (event) => {
        const step = event.shiftKey ? PICKER_STEP_LARGE : 1;
        const moves: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
        };
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        setHsva({ ...hsva, s: hsva.s + move[0], v: hsva.v + move[1] });
    });

    // --- the bars -----------------------------------------------------------------------
    // Native range inputs: arrows, Page Up/Down, Home/End and focus rings come
    // with them, and `input` streams while they are dragged.
    on(hue, 'input', () => setHsva({ ...hsva, h: Number(hue.value) }));
    if (alphaRange) {
        const range = alphaRange;
        on(range, 'input', () => setHsva({ ...hsva, a: Number(range.value) / 100 }));
    }
    if (alphaNumber) {
        const number = alphaNumber;
        on(number, 'input', () => {
            const percent = Number(number.value);
            const valid = number.value.trim() !== '' && Number.isFinite(percent) && percent >= 0 && percent <= 100;
            number.toggleAttribute('aria-invalid', !valid);
            if (valid) setHsva({ ...hsva, a: percent / 100 });
        });
    }

    // --- the fields ---------------------------------------------------------------------
    function field(name: string, label: string, kind: 'text' | 'number', max?: number): HTMLInputElement {
        const wrap = el(fields, 'label', { cls: 'nexus-studio-cp-field-wrap' });
        const input = el(wrap, 'input', {
            cls: 'nexus-studio-cp-field',
            attr: {
                type: kind,
                'data-field': name,
                spellcheck: 'false',
                'aria-label': label,
                ...(kind === 'number' ? { min: '0', max: String(max ?? 255), step: '1' } : {}),
            },
        });
        el(wrap, 'span', { cls: 'nexus-studio-cp-field-label', text: name.toUpperCase() });
        fieldInputs.set(name, input);
        return input;
    }

    /** Reads a number field; marks it and answers null when it is not one. */
    const numberIn = (input: HTMLInputElement, max: number): number | null => {
        const value = Number(input.value);
        const valid = input.value.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= max;
        input.toggleAttribute('aria-invalid', !valid);
        return valid ? value : null;
    };

    function buildFields(): void {
        for (const detach of fieldDetaches) detach();
        fieldDetaches = [];
        fieldInputs.clear();
        fields.replaceChildren();
        fields.setAttribute('data-format', format);
        const listen = (input: HTMLInputElement, handler: () => void): void => {
            input.addEventListener('input', handler);
            fieldDetaches.push(() => input.removeEventListener('input', handler));
        };
        if (format === 'hex') {
            const input = field('hex', 'Hex', 'text');
            listen(input, () => {
                const text = input.value.trim().replace(/^#?/, '#');
                const valid = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text);
                const parsed = valid ? parseRgba(text) : null;
                input.toggleAttribute('aria-invalid', !parsed);
                if (!parsed) return;
                // Digits for opacity count only where the token has one.
                const hasAlphaDigits = text.length === 5 || text.length === 9;
                setRgba({ ...parsed, a: hasAlphaDigits && withAlpha ? parsed.a : rgba.a });
            });
        } else if (format === 'rgb') {
            const inputs = (['r', 'g', 'b'] as const).map((name) =>
                field(name, { r: 'Red', g: 'Green', b: 'Blue' }[name], 'number', 255)
            );
            for (const input of inputs) {
                listen(input, () => {
                    const [r, g, b] = inputs.map((each) => numberIn(each, 255));
                    if (r == null || g == null || b == null) return;
                    setRgba({ r, g, b, a: rgba.a });
                });
            }
        } else {
            const h = field('h', 'Hue', 'number', 360);
            const s = field('s', 'Saturation', 'number', 100);
            const l = field('l', 'Lightness', 'number', 100);
            for (const input of [h, s, l]) {
                listen(input, () => {
                    const hv = numberIn(h, 360);
                    const sv = numberIn(s, 100);
                    const lv = numberIn(l, 100);
                    if (hv === null || sv === null || lv === null) return;
                    const next = hslToRgba({ h: hv, s: sv, l: lv, a: rgba.a });
                    setRgba(next);
                    // The hue typed is the hue meant, even where the colour is grey.
                    hsva = { ...hsva, h: hv };
                    refresh();
                });
            }
        }
    }

    // --- sampling -----------------------------------------------------------------------
    if (sampleButton) {
        const sampler = sampleButton;
        on(sampler, 'click', () => {
            if (sampling) return;
            sampling = true;
            // Hidden, not closed: the whole window can be sampled, including
            // what sits under the picker, and the session is still open after.
            root.classList.add('is-sampling');
            void host
                .sample()
                .then((picked) => {
                    if (closed || !picked) return;
                    const taken = parseRgba(picked);
                    // A pixel has no opacity of its own; the draft keeps the one it had.
                    if (taken) setRgba({ ...taken, a: mode === 'color' ? rgba.a : 1 });
                })
                .finally(() => {
                    sampling = false;
                    if (closed) return;
                    root.classList.remove('is-sampling');
                    sampler.focus();
                });
        });
    }

    // --- the palette --------------------------------------------------------------------
    function renderPalette(): void {
        grid.replaceChildren();
        host.palette.list().forEach((value, index) => {
            const swatch = button(grid, {
                cls: 'nexus-studio-cp-swatch',
                attr: {
                    'data-index': String(index),
                    'aria-label': `Use ${value}`,
                    title: `${value} — click to use · right-click to replace or delete`,
                },
            });
            swatch.style.setProperty('--nexus-studio-swatch', value);
            // Using a swatch loads it; the swatch itself is never changed by
            // that. A token without an opacity takes the colour opaque.
            swatch.addEventListener('click', () => {
                const colour = parseRgba(value);
                if (colour) setRgba(withAlpha ? colour : { ...colour, a: 1 });
            });
            swatch.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                host.showMenu(event, [
                    {
                        title: 'Replace with current colour',
                        icon: 'replace',
                        run: () => {
                            if (mode !== 'color') return;
                            host.palette.replace(index, rgbaToCss(rgba));
                            renderPalette();
                        },
                    },
                    {
                        title: 'Delete swatch',
                        icon: 'trash-2',
                        run: () => {
                            host.palette.remove(index);
                            renderPalette();
                        },
                    },
                ]);
            });
            swatch.addEventListener('keydown', (event) => {
                if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                event.preventDefault();
                host.palette.remove(index);
                renderPalette();
                grid.querySelector<HTMLButtonElement>('.nexus-studio-cp-swatch, .nexus-studio-cp-add')?.focus();
            });
        });
        const add = button(grid, {
            cls: 'nexus-studio-cp-add',
            attr: { 'aria-label': 'Save the current colour as a swatch', title: 'Save the current colour as a swatch' },
        });
        setIcon(add, 'plus');
        add.disabled = mode !== 'color';
        add.addEventListener('click', () => {
            if (mode !== 'color') return;
            host.palette.add(rgbaToCss(rgba));
            renderPalette();
        });
    }

    // --- raw CSS ------------------------------------------------------------------------
    const setAdvanced = (open: boolean): void => {
        advanced.hidden = !open;
        advancedToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    on(advancedToggle, 'click', () => {
        const opening = advanced.hidden;
        setAdvanced(opening);
        if (opening) cssInput.focus();
    });
    on(cssInput, 'input', () => {
        const text = cssInput.value.trim();
        if (text.length === 0 || !isValidValueFor(token, text)) {
            cssInput.setAttribute('aria-invalid', 'true');
            return;
        }
        cssInput.removeAttribute('aria-invalid');
        const colour = parseRgba(text);
        if (colour) {
            setRgba(colour);
            return;
        }
        // Valid CSS the picker cannot show: kept as typed, and said so.
        mode = 'custom';
        show(text);
        refresh();
    });
    on(convert, 'click', () => {
        const resolved = host.resolve(current);
        const colour = resolved ? parseRgba(resolved) : null;
        if (!colour) {
            customNote.textContent = ' — this value does not resolve to a colour here, so it cannot be converted.';
            return;
        }
        setRgba(withAlpha ? colour : { ...colour, a: 1 });
        area.focus();
    });

    // --- reading --------------------------------------------------------------------------
    function refresh(): void {
        const focused = doc.activeElement;
        const isColour = mode === 'color';
        root.classList.toggle('is-custom', !isColour);
        custom.hidden = isColour;
        visual.hidden = !isColour;
        now.style.setProperty('--nexus-studio-swatch', current);
        readout.textContent = isColour ? describeColor(rgba, format) : CUSTOM_CSS_LABEL;
        readout.setAttribute('title', current);

        const pureHue = rgbaToHex(hsvaToRgba({ h: hsva.h, s: 100, v: 100, a: 1 }));
        area.style.setProperty('--nexus-studio-cp-hue', pureHue);
        thumb.style.left = `${hsva.s}%`;
        thumb.style.top = `${100 - hsva.v}%`;
        area.setAttribute(
            'aria-valuetext',
            `Saturation ${Math.round(hsva.s)}%, brightness ${Math.round(hsva.v)}%`
        );
        if (focused !== hue) hue.value = String(Math.round(hsva.h));
        const opaque = rgbaToHex(rgba);
        root.style.setProperty('--nexus-studio-cp-opaque', opaque);
        const percent = Math.round(rgba.a * 100);
        if (alphaRange && focused !== alphaRange) alphaRange.value = String(percent);
        if (alphaNumber && focused !== alphaNumber) alphaNumber.value = String(percent);

        for (const [option, chip] of formatButtons) {
            chip.setAttribute('aria-pressed', option === format ? 'true' : 'false');
        }
        const hsl = rgbaToHsla(rgba);
        const values: Record<string, string> = {
            hex: opaque,
            r: String(rgba.r),
            g: String(rgba.g),
            b: String(rgba.b),
            h: String(Math.round(hsva.h)),
            s: String(Math.round(hsl.s)),
            l: String(Math.round(hsl.l)),
        };
        for (const [name, input] of fieldInputs) {
            // Never overwrite what somebody is typing.
            if (focused === input) continue;
            input.value = values[name] ?? '';
            input.removeAttribute('aria-invalid');
        }
        if (focused !== cssInput) {
            cssInput.value = current;
            cssInput.removeAttribute('aria-invalid');
        }
        const add = grid.querySelector<HTMLButtonElement>('.nexus-studio-cp-add');
        if (add) add.disabled = !isColour;
    }

    // --- placement ------------------------------------------------------------------------
    /**
     * Beside the swatch, inside the window: below it when there is room, above
     * when there is more room there, and shifted left rather than cut off at
     * the right edge — the studio's usual home is the RIGHT dock.
     */
    function place(): void {
        const box = anchor.getBoundingClientRect();
        const width = root.offsetWidth;
        const height = root.offsetHeight;
        const vw = win.innerWidth;
        const vh = win.innerHeight;
        // A swatch with no box — in a folded group, or scrolled out by a
        // rebuild — has nothing to sit beside: the middle of the window then.
        if (box.width === 0 && box.height === 0) {
            root.style.left = `${Math.round(Math.max(EDGE, (vw - width) / 2))}px`;
            root.style.top = `${Math.round(Math.max(EDGE, (vh - height) / 2))}px`;
            return;
        }
        const left = clamp(box.left, EDGE, Math.max(EDGE, vw - width - EDGE));
        let top = box.bottom + GAP;
        if (top + height > vh - EDGE && box.top - GAP - height >= EDGE) top = box.top - GAP - height;
        top = clamp(top, EDGE, Math.max(EDGE, vh - height - EDGE));
        root.style.left = `${Math.round(left)}px`;
        root.style.top = `${Math.round(top)}px`;
    }

    // --- closing --------------------------------------------------------------------------
    const close = (outcome: 'commit' | 'cancel'): void => {
        if (closed) return;
        closed = true;
        for (const detach of detaches) detach();
        for (const detach of fieldDetaches) detach();
        root.remove();
        host.finish(outcome, outcome === 'commit' ? current : host.initialValue);
        if (anchor.isConnected) anchor.focus();
    };

    on(revert, 'click', () => close('cancel'));
    on(done, 'click', () => close('commit'));
    on(root, 'keydown', (event) => {
        if (event.key !== 'Enter') return;
        const target = event.target as HTMLElement | null;
        // Enter on a button presses the button; anywhere else it means "done".
        if (target?.tagName === 'BUTTON') return;
        event.preventDefault();
        close('commit');
    });

    const onDocKey = (event: KeyboardEvent): void => {
        // While sampling, Escape belongs to the sampler: it cancels the pick,
        // not the picker.
        if (event.key !== 'Escape' || sampling) return;
        event.preventDefault();
        event.stopPropagation();
        close('cancel');
    };
    const onDocPointer = (event: PointerEvent): void => {
        if (sampling) return;
        const target = event.target as Node | null;
        if (target && (root.contains(target) || anchor.contains(target))) return;
        close('commit');
    };
    const onScroll = (): void => place();
    doc.addEventListener('keydown', onDocKey, true);
    doc.addEventListener('pointerdown', onDocPointer, true);
    doc.addEventListener('scroll', onScroll, true);
    win.addEventListener('resize', onScroll);
    detaches.push(() => {
        doc.removeEventListener('keydown', onDocKey, true);
        doc.removeEventListener('pointerdown', onDocPointer, true);
        doc.removeEventListener('scroll', onScroll, true);
        win.removeEventListener('resize', onScroll);
    });

    // --- open -----------------------------------------------------------------------------
    buildFields();
    renderPalette();
    setAdvanced(mode === 'custom');
    refresh();
    place();
    if (mode === 'color') area.focus();
    else cssInput.focus();

    return {
        token,
        el: root,
        close,
    };
}
