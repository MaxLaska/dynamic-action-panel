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
// grid); the colour library — Recent and Saved (colorLibrary.ts; this file
// only shows it and asks for changes); and, behind "CSS value", the raw text for what
// the picker cannot show — `color-mix()`, `var()`, `oklch()`. Such a value
// opens as Custom CSS and is never rewritten unless the user converts it.
//
// THREE LEVELS, kept apart:
//
//   INTERACTION COMMIT — one finished colour action: a click or drag in the
//     square released, a bar let go, a field confirmed, a swatch chosen, a
//     pixel taken. It records the colour in RECENT at once (`library.use`),
//     while the picker stays open. Never per pointer move.
//   PICKER SESSION COMMIT — Done, Enter, a click outside: the token keeps the
//     draft. Escape or Revert: it does not. Recent is untouched either way.
//   SAVED — only what the user keeps on purpose.
//
// A SESSION, not a form. Every change is a DRAFT: applied to the whole
// workspace at once (and the reader, through the same token path as any other
// value) but not written to the profile. Done, Enter or a click outside
// COMMITS the draft as one ordinary override write. Escape or Revert CANCELS:
// the draft is dropped and the value from before the picker opened is back,
// exactly, because the profile underneath was never touched. The panel owns
// what commit and cancel mean (studioPanel.ts); this file only reports which.
//
// THE PIPETTE IS A TOOL: switched on, every click takes a colour (into the
// draft and, by the one move-to-front rule, into Recent) and the tool stays on
// with the picker visible above it. Pipette again or Escape switches it off;
// Alt held switches it on for as long as it is held. See sampler.ts.
//
// SWATCHES DRAG: Recent → Saved copies, Saved → Saved reorders, and an insert
// marker shows the exact place. Recent is never reordered by hand.
//
// One picker at a time. It lives on the document body, positioned against its
// swatch, so a narrow dock does not clip it; it carries the studio's control
// plane palette, so the colours being edited never style the picker itself.

import { setIcon, setTooltip } from 'obsidian';

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
import { startSamplingMode, type SamplingMode } from './sampler';

/** One entry in a swatch's or the palette's menu. */
export interface PickerMenuItem {
    title: string;
    icon: string;
    disabled?: boolean;
    run(): void;
}

/**
 * The colour library, as the picker sees it. The picker never changes a list
 * itself: it asks, and re-reads. What the rules are is colorLibrary.ts.
 */
export interface PickerLibrary {
    /** Recently used colours, newest first. */
    recent(): readonly string[];
    /**
     * One colour interaction has finished with this colour: it goes to the
     * front of Recent. Not a token write, and not undone by Escape.
     */
    use(value: string): void;
    /** Deliberately saved colours. */
    saved(): readonly string[];
    /** Keeps a colour; answers where it is now (it may already have been there), or -1. */
    save(value: string): number;
    remove(index: number): void;
    replace(index: number, value: string): void;
    /** Keeps a colour at an insertion point (a drop from Recent). A copy. */
    insert(value: string, at: number): { index: number; added: boolean };
    /** Moves a saved colour to an insertion point (a reorder). */
    move(from: number, to: number): void;
    importPalette(): void;
    exportPalette(): void;
    copyAsCss(): void;
    clear(): void;
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
    /** What the browser resolves a CSS value to, for converting Custom CSS. */
    resolve(value: string): string | null;
    /** Recent and saved colours. */
    library: PickerLibrary;
    showMenu(evt: MouseEvent, items: PickerMenuItem[]): void;
}

export interface ColorPickerHandle {
    readonly token: ThemeTokenDefinition;
    readonly el: HTMLElement;
    /** Closes, committing or cancelling. Harmless when already closed. */
    close(outcome: 'commit' | 'cancel'): void;
    /** Re-reads the library, after it changed somewhere else (an import, a clear). */
    refreshLibrary(): void;
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

/** How far a pressed swatch must move before it is dragged rather than clicked. */
export const DRAG_THRESHOLD = 5;

/** The controls that stay clickable while the sampler is on; everything else is sampled. */
export const SAMPLER_CONTROLS = '.nexus-studio-cp-sample, .nexus-studio-cp-format, .nexus-studio-cp-done, .nexus-studio-cp-cancel';

/** A box, as `getBoundingClientRect` gives one. */
export interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * Where a drop at (x, y) lands in a wrapped row of swatches, as a LINEAR
 * insertion point (0 = before the first, length = after the last), plus where
 * to draw the marker. The swatches are grouped into visual rows by their top;
 * the pointer picks a row by height (above the first row is the first, below
 * the last the last), and within it goes before the first swatch whose middle
 * it is left of — or after the row's last swatch. So the end of one row and
 * the start of the next are the same insertion point, and the marker is drawn
 * on the row the pointer is on: no jump at a wrap.
 */
export function insertIndexAt(
    boxes: readonly Box[],
    x: number,
    y: number,
    gap = 4
): { index: number; markerX: number; top: number; bottom: number } | null {
    if (boxes.length === 0) return null;
    const rows: Array<{ top: number; bottom: number; items: number[] }> = [];
    boxes.forEach((box, index) => {
        const row = rows.find((candidate) => Math.abs(candidate.top - box.top) < (box.bottom - box.top) / 2);
        if (row) {
            row.items.push(index);
            row.bottom = Math.max(row.bottom, box.bottom);
        } else {
            rows.push({ top: box.top, bottom: box.bottom, items: [index] });
        }
    });
    rows.sort((a, b) => a.top - b.top);
    let row = rows[rows.length - 1]!;
    for (let r = 0; r < rows.length; r += 1) {
        const next = rows[r + 1];
        // A row owns the space down to halfway into the gap before the next.
        const limit = next ? (rows[r]!.bottom + next.top) / 2 : Infinity;
        if (y < limit) {
            row = rows[r]!;
            break;
        }
    }
    for (const index of row.items) {
        const box = boxes[index]!;
        // The marker stands in the middle of the gap before this swatch.
        if (x < (box.left + box.right) / 2) return { index, markerX: box.left - gap / 2, top: row.top, bottom: row.bottom };
    }
    const last = row.items[row.items.length - 1]!;
    return { index: last + 1, markerX: boxes[last]!.right + gap / 2, top: row.top, bottom: row.bottom };
}

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
    let closed = false;
    /**
     * The sampler as a TOOL: off, on until switched off ('persistent'), or on
     * while Alt is held ('temporary'). One state, so two ways in cannot fight.
     */
    let tool: SamplingMode | null = null;
    let toolKind: 'persistent' | 'temporary' | null = null;
    /** Whether Alt is down now, so a right-click can hand a permanent pipette back to Alt. */
    let altHeld = false;
    /** The context menu that follows a right-click the sampler has already answered. */
    let eatContextMenu = false;
    let eatTimer = 0;
    const sampling = (): boolean => tool !== null;
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

    // The value line: the fields, one format button that cycles, and the pipette.
    const valuebar = el(visual, 'div', { cls: 'nexus-studio-cp-valuebar' });
    const fields = el(valuebar, 'div', { cls: 'nexus-studio-cp-fields' });
    let fieldDetaches: Detach[] = [];
    const fieldInputs = new Map<string, HTMLInputElement>();
    const formatButton = button(valuebar, { cls: 'nexus-studio-cp-format' });
    setTooltip(formatButton, 'Change colour format');
    on(formatButton, 'click', () => {
        // HEX → RGB → HSL → HEX. A display choice: the fields change, the value does not.
        format = COLOR_FORMATS[(COLOR_FORMATS.indexOf(format) + 1) % COLOR_FORMATS.length] ?? 'hex';
        host.setFormat(format);
        buildFields();
        refresh();
    });

    let sampleButton: HTMLButtonElement | null = null;
    if (host.canSample) {
        // A toggle: pressed while the sampler is on. The label says what it
        // does; aria-pressed says whether it is doing it.
        sampleButton = button(valuebar, {
            cls: ['clickable-icon', 'nexus-studio-cp-sample'],
            attr: { 'aria-label': 'Pick from Obsidian', 'aria-pressed': 'false' },
        });
        setIcon(sampleButton, 'pipette');
        setTooltip(
            sampleButton,
            'Pick from Obsidian: click to switch the sampler on or off; every click then takes a colour. Hold Alt to sample briefly. Esc ends it.'
        );
    }

    // Two memories, visibly apart: what was used, and what was kept.
    const recentBox = el(root, 'div', { cls: 'nexus-studio-cp-palette', attr: { 'data-section': 'recent' } });
    el(recentBox, 'div', { cls: 'nexus-studio-cp-palette-label', text: 'Recent' });
    const recentGrid = el(recentBox, 'div', {
        cls: ['nexus-studio-cp-swatches', 'nexus-studio-cp-recent'],
        attr: { role: 'group', 'aria-label': 'Recent colours' },
    });
    const savedBox = el(root, 'div', { cls: 'nexus-studio-cp-palette', attr: { 'data-section': 'saved' } });
    el(savedBox, 'div', { cls: 'nexus-studio-cp-palette-label', text: 'Saved' });
    const grid = el(savedBox, 'div', {
        cls: ['nexus-studio-cp-swatches', 'nexus-studio-cp-saved'],
        attr: { role: 'group', 'aria-label': 'Saved colours' },
    });
    /** The saved colour last loaded into the picker, which the ⋯ menu can replace or delete. */
    let loadedSaved: number | null = null;

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

    // --- interaction commits ------------------------------------------------------------
    /**
     * The end of ONE colour interaction: the colour now in the picker has been
     * used. Recent is updated at once and shown at once; only the Recent row is
     * redrawn, so the focus stays where it is. A Custom CSS value is not a
     * colour and is not recorded.
     */
    const markUsed = (): void => {
        if (closed || mode !== 'color') return;
        host.library.use(rgbaToCss(rgba));
        renderRecent();
    };

    /**
     * A native range input: it streams `input` while moving, and its end is
     * `change` for the pointer. From the keyboard, `change` fires on every
     * step while a key is held, so the end there is the key going up.
     */
    const commitOnRelease = (input: HTMLInputElement): void => {
        let keyHeld = false;
        on(input, 'keydown', () => {
            keyHeld = true;
        });
        on(input, 'keyup', () => {
            if (!keyHeld) return;
            keyHeld = false;
            markUsed();
        });
        on(input, 'change', () => {
            if (!keyHeld) markUsed();
        });
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
        // One click or one whole drag is one colour: its end value.
        if (event.type === 'pointerup') markUsed();
    };
    on(area, 'pointerup', endDrag);
    on(area, 'pointercancel', endDrag);
    // Arrows: each key press moves the draft; letting go is the decision.
    on(area, 'keyup', (event) => {
        if (event.key.startsWith('Arrow')) markUsed();
    });
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
    commitOnRelease(hue);
    if (alphaRange) {
        const range = alphaRange;
        on(range, 'input', () => setHsva({ ...hsva, a: Number(range.value) / 100 }));
        commitOnRelease(range);
    }
    if (alphaNumber) {
        const number = alphaNumber;
        on(number, 'input', () => {
            const percent = Number(number.value);
            const valid = number.value.trim() !== '' && Number.isFinite(percent) && percent >= 0 && percent <= 100;
            number.toggleAttribute('aria-invalid', !valid);
            if (valid) setHsva({ ...hsva, a: percent / 100 });
        });
        // A typed value is decided when it is confirmed: Enter or leaving the field.
        on(number, 'change', () => markUsed());
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
            // Confirmed (Enter or leaving the field): one used colour.
            input.addEventListener('change', markUsed);
            fieldDetaches.push(() => {
                input.removeEventListener('input', handler);
                input.removeEventListener('change', markUsed);
            });
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

    // --- sampling, as a tool -----------------------------------------------------------------
    const setToolState = (): void => {
        root.classList.toggle('is-sampling-mode', tool !== null);
        sampleButton?.setAttribute('aria-pressed', tool !== null ? 'true' : 'false');
        sampleButton?.classList.toggle('is-active', tool !== null);
    };

    const stopSampling = (): void => {
        tool?.stop();
        tool = null;
        toolKind = null;
        setToolState();
    };

    const startSampling = (kind: 'persistent' | 'temporary'): void => {
        if (closed) return;
        if (tool) {
            // Already on: a click on the pipette during Alt makes it stay.
            if (kind === 'persistent') toolKind = 'persistent';
            return;
        }
        tool = startSamplingMode(win, {
            // The mode's own controls stay clickable, and so does any dialog.
            keepLive: (target) =>
                (root.contains(target) && !!target.closest(SAMPLER_CONTROLS)) || !!target.closest('.modal-container'),
            onSample: (picked) => {
                const taken = parseRgba(picked);
                if (!taken || closed) return;
                // A pixel has no opacity of its own; the draft keeps the one it had.
                setRgba({ ...taken, a: mode === 'color' ? rgba.a : 1 });
                // The same rule as every other colour action: move to front.
                markUsed();
            },
            // Escape ended it: the tool is off, the picker and its draft stay.
            onEnd: () => {
                tool = null;
                toolKind = null;
                setToolState();
            },
            reference: () => current,
            // Right-click is the mouse's way out of a PERMANENT pipette — like the
            // pipette button again, or Escape: the tool goes, the picker, its
            // draft and Recent stay. Sampling that exists only because Alt is
            // held has nothing permanent to end; Alt going up is its way out.
            // With both, the permanent part ends and Alt keeps it until let go.
            onSecondary: () => {
                eatContextMenu = true;
                win.clearTimeout(eatTimer);
                // The menu follows the press, or not at all; never eat a later one.
                eatTimer = win.setTimeout(() => (eatContextMenu = false), 800);
                if (toolKind !== 'persistent') return;
                if (altHeld) {
                    toolKind = 'temporary';
                    setToolState();
                    return;
                }
                stopSampling();
            },
        });
        toolKind = tool ? kind : null;
        setToolState();
    };

    if (sampleButton) {
        on(sampleButton, 'click', () => {
            if (toolKind === 'persistent') stopSampling();
            else startSampling('persistent');
        });
    }

        // --- dragging swatches --------------------------------------------------------------------
    //
    // Recent → Saved is a COPY; Saved → Saved is a MOVE; nothing reorders Recent.
    // A press becomes a drag only past DRAG_THRESHOLD, so a click stays a click;
    // after a real drag the click that follows is swallowed. Nothing changes
    // until the drop, and a drop outside Saved, Escape, or losing the pointer
    // changes nothing. While the sampler is on, presses are samples, never drags.
    let drag: {
        kind: 'recent' | 'saved';
        index: number;
        value: string;
        x: number;
        y: number;
        active: boolean;
        insert: number | null;
        source: HTMLElement;
    } | null = null;
    let ghost: HTMLElement | null = null;
    let marker: HTMLElement | null = null;
    let swallowClick = false;

    const clearDragVisuals = (): void => {
        ghost?.remove();
        ghost = null;
        marker?.remove();
        marker = null;
        root.classList.remove('is-dragging');
        savedBox.classList.remove('is-drop-target');
        drag?.source.classList.remove('is-drag-source');
    };

    const cancelDrag = (): void => {
        clearDragVisuals();
        drag = null;
    };

    const beginPress = (event: PointerEvent, kind: 'recent' | 'saved', index: number, value: string): void => {
        if (event.button !== 0 || sampling()) return;
        drag = {
            kind,
            index,
            value,
            x: event.clientX,
            y: event.clientY,
            active: false,
            insert: null,
            source: event.currentTarget as HTMLElement,
        };
    };

    const showMarker = (x: number, y: number): number | null => {
        const box = savedBox.getBoundingClientRect();
        const slack = 8;
        const inside = x >= box.left - slack && x <= box.right + slack && y >= box.top - slack && y <= box.bottom + slack;
        const swatches = Array.from(grid.querySelectorAll<HTMLElement>('.nexus-studio-cp-swatch[data-kind="saved"]'));
        if (!inside) {
            marker?.remove();
            marker = null;
            savedBox.classList.remove('is-drop-target');
            return null;
        }
        savedBox.classList.add('is-drop-target');
        const spot = insertIndexAt(swatches.map((swatch) => swatch.getBoundingClientRect()), x, y);
        if (!marker) marker = el(savedBox, 'span', { cls: 'nexus-studio-cp-insert', attr: { 'aria-hidden': 'true' } });
        if (!spot) {
            // An empty palette: the one place there is.
            const g = grid.getBoundingClientRect();
            marker.style.left = `${Math.round(g.left - box.left)}px`;
            marker.style.top = `${Math.round(g.top - box.top)}px`;
            // Height: the stylesheet's default, one swatch.
            marker.style.removeProperty('--nexus-studio-insert-height');
            marker.dataset.index = '0';
            return 0;
        }
        // Two pixels wide, centred on the gap.
        marker.style.left = `${Math.round(spot.markerX - box.left - 1)}px`;
        marker.style.top = `${Math.round(spot.top - box.top)}px`;
        marker.style.setProperty('--nexus-studio-insert-height', `${Math.round(spot.bottom - spot.top)}px`);
        marker.dataset.index = String(spot.index);
        return spot.index;
    };

    const onDragMove = (event: PointerEvent): void => {
        if (!drag) return;
        if (!drag.active) {
            if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return;
            drag.active = true;
            root.classList.add('is-dragging');
            drag.source.classList.add('is-drag-source');
            ghost = doc.createElement('div');
            ghost.className = 'nexus-studio-cp-ghost nexus-studio-isolated';
            ghost.style.setProperty('--nexus-studio-swatch', drag.value);
            doc.body.appendChild(ghost);
        }
        if (ghost) {
            ghost.style.left = `${event.clientX - 11}px`;
            ghost.style.top = `${event.clientY - 11}px`;
        }
        drag.insert = showMarker(event.clientX, event.clientY);
    };

    const onDragEnd = (event: PointerEvent): void => {
        if (!drag) return;
        const finished = drag;
        drag = null;
        clearDragVisuals();
        if (!finished.active) return; // a click: it goes ahead
        swallowClick = true;
        win.setTimeout(() => (swallowClick = false), 0);
        if (event.type !== 'pointerup' || finished.insert === null) return;
        if (finished.kind === 'recent') {
            const result = host.library.insert(finished.value, finished.insert);
            renderPalette();
            // Already saved: nothing changes, and the one there says so.
            if (!result.added) flash(result.index);
        } else {
            host.library.move(finished.index, finished.insert);
            loadedSaved = null;
            renderPalette();
        }
    };

    const onDragClick = (event: MouseEvent): void => {
        if (!swallowClick) return;
        swallowClick = false;
        event.preventDefault();
        event.stopPropagation();
    };

    const flash = (index: number): void => {
        const found = grid.querySelector<HTMLButtonElement>(`.nexus-studio-cp-swatch[data-index="${index}"]`);
        if (!found) return;
        found.classList.add('is-found');
        win.setTimeout(() => found.classList.remove('is-found'), 900);
    };

    // --- the library ----------------------------------------------------------------------
    /** Loads a library colour as a draft. The entry itself is never changed by that. */
    const load = (value: string): void => {
        const colour = parseRgba(value);
        // A token without an opacity takes the colour opaque.
        if (colour) setRgba(withAlpha ? colour : { ...colour, a: 1 });
    };

    const swatchButton = (parent: HTMLElement, kind: 'recent' | 'saved', value: string, index: number) => {
        const swatch = button(parent, {
            cls: 'nexus-studio-cp-swatch',
            attr: {
                'data-kind': kind,
                'data-index': String(index),
                'aria-label': `Use ${value}`,
                title:
                    kind === 'saved'
                        ? `${value} — click to use · Delete removes · right-click to replace or delete`
                        : `${value} — click to use`,
            },
        });
        swatch.style.setProperty('--nexus-studio-swatch', value);
        swatch.addEventListener('pointerdown', (event) => beginPress(event, kind, index, value));
        return swatch;
    };

    function renderRecent(): void {
        recentGrid.replaceChildren();
        const recent = host.library.recent();
        recentBox.classList.toggle('is-empty', recent.length === 0);
        if (recent.length === 0) {
            el(recentGrid, 'span', { cls: 'nexus-studio-cp-empty', text: 'Colours you use appear here.' });
            return;
        }
        recent.forEach((value, index) => {
            const swatch = swatchButton(recentGrid, 'recent', value, index);
            swatch.addEventListener('click', () => {
                // A swatch redrawn away by a drop is not there to be clicked.
                if (!swatch.isConnected) return;
                loadedSaved = null;
                load(value);
                // Using it again is a use: it moves to the front, now.
                markUsed();
                renderPalette();
                recentGrid.querySelector<HTMLButtonElement>('.nexus-studio-cp-swatch')?.focus();
            });
        });
    }

    const removeAt = (index: number): void => {
        host.library.remove(index);
        if (loadedSaved === index) loadedSaved = null;
        else if (loadedSaved !== null && loadedSaved > index) loadedSaved -= 1;
        renderPalette();
    };
    const replaceAt = (index: number): void => {
        if (mode !== 'color') return;
        host.library.replace(index, rgbaToCss(rgba));
        renderPalette();
    };

    function renderPalette(): void {
        grid.replaceChildren();
        host.library.saved().forEach((value, index) => {
            const swatch = swatchButton(grid, 'saved', value, index);
            swatch.setAttribute('aria-pressed', loadedSaved === index ? 'true' : 'false');
            swatch.addEventListener('click', () => {
                if (!swatch.isConnected) return;
                loadedSaved = index;
                load(value);
                // The saved colour is used, not changed: Recent records it.
                markUsed();
                renderPalette();
                grid.querySelector<HTMLButtonElement>(`.nexus-studio-cp-swatch[data-index="${index}"]`)?.focus();
            });
            swatch.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                host.showMenu(event, [
                    { title: 'Replace with current colour', icon: 'replace', disabled: mode !== 'color', run: () => replaceAt(index) },
                    { title: 'Delete swatch', icon: 'trash-2', run: () => removeAt(index) },
                ]);
            });
            swatch.addEventListener('keydown', (event) => {
                if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                event.preventDefault();
                removeAt(index);
                grid.querySelector<HTMLButtonElement>('.nexus-studio-cp-swatch, .nexus-studio-cp-add')?.focus();
            });
        });
        const add = button(grid, {
            cls: 'nexus-studio-cp-add',
            attr: { 'aria-label': 'Save the current colour', title: 'Save the current colour' },
        });
        setIcon(add, 'plus');
        add.disabled = mode !== 'color';
        add.addEventListener('click', () => {
            if (mode !== 'color') return;
            const at = host.library.save(rgbaToCss(rgba));
            renderPalette();
            // Already saved: no second copy, and the one there is shown.
            flash(at);
        });
        // The palette's own actions — no context menu needed for any of them.
        const more = button(grid, {
            cls: 'nexus-studio-cp-more',
            attr: { 'aria-label': 'Saved colours: more', title: 'Replace, delete, import, export' },
        });
        setIcon(more, 'more-horizontal');
        more.addEventListener('click', (event) => {
            const saved = host.library.saved();
            const target = loadedSaved !== null ? saved[loadedSaved] : undefined;
            const items: PickerMenuItem[] = [];
            if (target !== undefined && loadedSaved !== null) {
                const index = loadedSaved;
                items.push(
                    { title: `Replace ${target} with current colour`, icon: 'replace', disabled: mode !== 'color', run: () => replaceAt(index) },
                    { title: `Delete ${target}`, icon: 'trash-2', run: () => removeAt(index) }
                );
            }
            items.push(
                { title: 'Import palette…', icon: 'download', run: () => host.library.importPalette() },
                { title: 'Export palette…', icon: 'upload', disabled: saved.length === 0, run: () => host.library.exportPalette() },
                { title: 'Copy as CSS variables', icon: 'copy', disabled: saved.length === 0, run: () => host.library.copyAsCss() },
                { title: 'Clear saved colours…', icon: 'trash-2', disabled: saved.length === 0, run: () => host.library.clear() }
            );
            host.showMenu(event, items);
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
    on(cssInput, 'change', () => markUsed());
    on(convert, 'click', () => {
        const resolved = host.resolve(current);
        const colour = resolved ? parseRgba(resolved) : null;
        if (!colour) {
            customNote.textContent = ' — this value does not resolve to a colour here, so it cannot be converted.';
            return;
        }
        setRgba(withAlpha ? colour : { ...colour, a: 1 });
        markUsed();
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

        const label = format.toUpperCase();
        formatButton.textContent = label;
        formatButton.setAttribute('data-format', format);
        formatButton.setAttribute('aria-label', `Colour format: ${label}. Change colour format`);
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
        // The tool and any drag end with the picker: no layer, loupe or marker left behind.
        stopSampling();
        cancelDrag();
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
        // A value typed and confirmed with Enter was used, even as the picker closes.
        if (target?.tagName === 'INPUT') markUsed();
        close('commit');
    });

    /** Inside one of Obsidian's dialogs — an import or export the picker itself opened. */
    const inDialog = (target: EventTarget | null): boolean => {
        const node = target as (Node & { closest?: (selector: string) => Element | null }) | null;
        const element = node?.closest ? node : node?.parentElement;
        return !!element?.closest?.('.modal-container');
    };

    /**
     * Whether one of Obsidian's dialogs is open. Obsidian closes the topmost
     * dialog on Escape wherever the focus is, so while one is open, Escape is
     * the dialog's — found live: with the focus outside the dialog, one Escape
     * closed the export dialog AND cancelled the picker session.
     */
    const dialogOpen = (): boolean => !!doc.querySelector('.modal-container');

    /**
     * Whether a key was already handled by a dialog that closed on it. Traced
     * live: Obsidian closes a dialog in its own keydown handler, which runs
     * BEFORE these listeners — so by the time the picker sees that Escape, the
     * dialog is gone, and its field (the event's target) is no longer in the
     * document. A key whose target has been taken out was somebody else's.
     */
    const alreadyHandled = (target: EventTarget | null): boolean => {
        const node = target as Node | null;
        return !!node && node !== doc && typeof node.isConnected === 'boolean' && !node.isConnected;
    };

    const onDocKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape' || inDialog(event.target) || dialogOpen() || alreadyHandled(event.target)) return;
        // One Escape ends ONE thing. A drag first; then the sampler, which
        // handles its own Escape and leaves the picker open; only then the
        // picker session.
        if (drag) {
            cancelDrag();
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (sampling()) return;
        event.preventDefault();
        event.stopPropagation();
        close('cancel');
    };
    const onDocPointer = (event: PointerEvent): void => {
        if (sampling()) return;
        const target = event.target as Node | null;
        if (target && (root.contains(target) || anchor.contains(target))) return;
        if (inDialog(target)) return;
        close('commit');
    };
    const onScroll = (): void => place();

    /**
     * Alt held: the sampler, for as long as it is held — only while this picker
     * is open, and never over a permanent sampler, which Alt leaves alone. Alt
     * pressed as part of a chord (Alt+Tab, Alt+arrow) is not a tool: the
     * temporary sampler ends at the other key, and the chord goes on.
     */
    const onAltDown = (event: KeyboardEvent): void => {
        if (inDialog(event.target) || dialogOpen()) return;
        if (event.key === 'Alt') {
            altHeld = true;
            if (event.repeat || toolKind === 'persistent' || tool || !host.canSample || mode !== 'color') return;
            // Keeps Alt from reaching the window menu while it is a tool.
            event.preventDefault();
            startSampling('temporary');
            return;
        }
        if (event.altKey && toolKind === 'temporary') stopSampling();
    };
    const onAltUp = (event: KeyboardEvent): void => {
        if (event.key === 'Alt') altHeld = false;
        if (event.key !== 'Alt' || toolKind !== 'temporary') return;
        event.preventDefault();
        stopSampling();
    };
    // Alt released outside the window never arrives: losing focus ends it.
    const onBlur = (): void => {
        altHeld = false;
        if (toolKind === 'temporary') stopSampling();
        cancelDrag();
    };

    /**
     * No context menu while the sampler is on, and none for the right-click
     * that switched it off: that click was the tool's, and only the tool's.
     * In the ordinary picker every context menu (Saved's too) is untouched.
     */
    const onContextMenu = (event: MouseEvent): void => {
        if (!eatContextMenu && !sampling()) return;
        eatContextMenu = false;
        win.clearTimeout(eatTimer);
        event.preventDefault();
        event.stopPropagation();
    };

    doc.addEventListener('contextmenu', onContextMenu, true);
    doc.addEventListener('keydown', onDocKey, true);
    doc.addEventListener('keydown', onAltDown, true);
    doc.addEventListener('keyup', onAltUp, true);
    doc.addEventListener('pointerdown', onDocPointer, true);
    doc.addEventListener('pointermove', onDragMove, true);
    doc.addEventListener('pointerup', onDragEnd, true);
    doc.addEventListener('pointercancel', onDragEnd, true);
    doc.addEventListener('click', onDragClick, true);
    doc.addEventListener('scroll', onScroll, true);
    win.addEventListener('resize', onScroll);
    win.addEventListener('blur', onBlur);
    detaches.push(() => {
        win.clearTimeout(eatTimer);
        doc.removeEventListener('contextmenu', onContextMenu, true);
        doc.removeEventListener('keydown', onDocKey, true);
        doc.removeEventListener('keydown', onAltDown, true);
        doc.removeEventListener('keyup', onAltUp, true);
        doc.removeEventListener('pointerdown', onDocPointer, true);
        doc.removeEventListener('pointermove', onDragMove, true);
        doc.removeEventListener('pointerup', onDragEnd, true);
        doc.removeEventListener('pointercancel', onDragEnd, true);
        doc.removeEventListener('click', onDragClick, true);
        doc.removeEventListener('scroll', onScroll, true);
        win.removeEventListener('resize', onScroll);
        win.removeEventListener('blur', onBlur);
    });

    // --- open -----------------------------------------------------------------------------
    buildFields();
    renderRecent();
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
        refreshLibrary(): void {
            if (closed) return;
            loadedSaved = null;
            renderRecent();
            renderPalette();
        },
    };
}
