// tokenRow.ts
// One token's controls, and the one rule that keeps them honest.
//
// THE RULE: the controls are a VIEW of the stored value. Every path writes a
// CSS string and then re-reads the state to redraw itself. The first version
// computed each control's state once, at render, and a write deliberately does
// not re-render; the reset arrow was therefore rendered disabled and stayed
// disabled after the value changed. Holding the elements and re-syncing them is
// the habit, not a patch.
//
// THE SHAPE. Every row has the same shell — a preview on the left, the name and
// one line of description, and on the right the value readout and the reset —
// and below it the editor its `controlType` calls for:
//
//   color        swatch, pipette, opacity where `supportsAlpha`, raw CSS
//   length       a slider over the registry's range, raw CSS
//   number       the same, unitless
//   font-family  suggestions and the family list itself, which IS the raw CSS
//
// The kind comes from the registry. Nothing here names a token, and adding a
// token of an existing kind is a row in the table and nothing else.
//
// The locator (resting the pointer on a row) paints COLOUR tokens only. It
// works by setting the token to magenta; a font size set to "#ff00ff" is not a
// preview, it is every size derived from it becoming invalid.
//
// Built on plain DOM (see dom.ts) so that it behaves the same in Obsidian and
// in the happy-dom tests that pin it.

import { setIcon, setTooltip } from 'obsidian';

import type { ThemeTokenDefinition } from '../../../theme/nexus/src/tokens';
import {
    alphaToPercent,
    formatColorValue,
    parseColorValue,
    percentToAlpha,
} from './colorValue';
import { button, docOf, el } from './dom';
import { isValidValueFor } from './overrides';

/** What the row needs from its panel, so this file needs no plugin reference. */
export interface TokenRowHost {
    /** The value this token currently resolves to, override or theme default. */
    currentValue(token: ThemeTokenDefinition): string;
    /** Whether the active profile says anything of its own about this token. */
    isOverridden(token: ThemeTokenDefinition): boolean;
    /** Whether the active profile may be edited at all. */
    isLocked(): boolean;
    /** Stores a value, or clears the override when null. Applies immediately. */
    write(token: ThemeTokenDefinition, value: string | null): void;
    /** Starts or stops the locator preview for this token. */
    preview(token: ThemeTokenDefinition | null): void;
    /**
     * How colours can be taken off the screen here, or null when they cannot.
     * `capture` reads Obsidian's own rendering; `screen` is the native pipette.
     */
    readonly pickKind: 'capture' | 'screen' | null;
    /** Takes a colour off the screen; null when cancelled. Writes nothing. */
    pickColor(): Promise<string | null>;
    /** The window this row lives in, for timers. */
    win: Window;
}

/** A row that can be told to redraw itself from the current state. */
export interface TokenRowHandle {
    readonly el: HTMLElement;
    /** Re-reads everything. Never overwrites the element that has focus. */
    sync(): void;
    /** Detaches what this row attached and cancels anything pending. */
    dispose(): void;
}

/**
 * How long the pointer must rest on a row before the locator paints. Without a
 * delay, sweeping the pointer down the panel flashes half the workspace magenta
 * on the way past.
 */
export const LOCATOR_DELAY_MS = 200;

/** The one tooltip the per-token reset has, whatever the value is. */
export const RESET_TOOLTIP = 'Reset to default';

/** What the value chip says when the stored value has no swatch form. */
export const COMPLEX_VALUE_LABEL = 'CSS';

/** What a font row says when the stored value matches no suggestion. */
export const CUSTOM_FONT_LABEL = 'Custom';

/** Unique element ids across every row in every open studio view. */
let rowSerial = 0;

/** Something a row attached that has to come off again. */
type Detach = () => void;

function listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    detaches: Detach[]
): void {
    target.addEventListener(type, handler);
    detaches.push(() => target.removeEventListener(type, handler));
}

export function renderTokenRow(
    parent: HTMLElement,
    token: ThemeTokenDefinition,
    host: TokenRowHost
): TokenRowHandle {
    const win = host.win;
    const serial = (rowSerial += 1);
    const detaches: Detach[] = [];
    const syncs: Array<() => void> = [];
    let hoverTimer = 0;

    const row = el(parent, 'div', {
        cls: ['nexus-studio-row', `is-${token.controlType}`],
        attr: { 'data-token': token.key },
    });

    // --- the shell ---------------------------------------------------------
    const preview = el(row, token.controlType === 'color' ? 'label' : 'div', {
        cls: token.controlType === 'color' ? 'nexus-studio-swatch' : 'nexus-studio-glyph',
    });
    const text = el(row, 'div', { cls: 'nexus-studio-row-text' });
    el(text, 'div', { cls: 'nexus-studio-row-label', text: token.label });
    el(text, 'div', { cls: 'nexus-studio-row-desc', text: token.description });
    const actions = el(row, 'div', { cls: 'nexus-studio-row-actions' });

    const commit = (value: string | null): void => {
        host.write(token, value);
        sync();
    };

    // The value chip and its raw editor, for every kind whose main control is
    // not already the raw text (font families are).
    let cssInput: HTMLInputElement | null = null;
    let chip: HTMLButtonElement | null = null;
    if (token.controlType !== 'font-family') {
        const cssId = `nexus-studio-css-${serial}`;
        chip = button(actions, {
            cls: 'nexus-studio-value',
            attr: { 'aria-expanded': 'false', 'aria-controls': cssId },
        });
        const cssLine = el(row, 'div', { cls: 'nexus-studio-row-css', attr: { id: cssId } });
        cssLine.hidden = true;
        const input = el(cssLine, 'input', {
            cls: 'nexus-studio-css-input',
            attr: {
                type: 'text',
                spellcheck: 'false',
                placeholder: token.defaultValue,
                'aria-label': `${token.label} CSS value`,
            },
        });
        cssInput = input;
        const theChip = chip;
        listen(theChip, 'click', () => {
            const opening = cssLine.hidden;
            cssLine.hidden = !opening;
            theChip.setAttribute('aria-expanded', opening ? 'true' : 'false');
            row.toggleAttribute('data-css-open', opening);
            if (opening) {
                input.value = host.currentValue(token);
                input.focus();
            }
            // Closing writes nothing: whatever was valid was written as typed.
        }, detaches);
        listen(input, 'input', () => writeRaw(input), detaches);
    }

    /** A raw value typed into a field: written when valid, left alone when not. */
    const writeRaw = (input: HTMLInputElement): void => {
        if (host.isLocked()) return;
        const next = input.value;
        if (next.trim().length === 0) {
            input.removeAttribute('aria-invalid');
            commit(null);
            return;
        }
        // Neither written nor reverted: the user is probably still typing.
        if (!isValidValueFor(token, next)) {
            input.setAttribute('aria-invalid', 'true');
            return;
        }
        input.removeAttribute('aria-invalid');
        commit(next);
    };

    // --- the editor for this kind --------------------------------------------
    let pipette: HTMLButtonElement | null = null;
    switch (token.controlType) {
        case 'color':
            pipette = buildColorEditor();
            break;
        case 'length':
        case 'number':
            buildRangeEditor();
            break;
        case 'font-family':
            buildFontEditor();
            break;
    }

    const reset = button(actions, {
        cls: ['clickable-icon', 'nexus-studio-reset'],
        attr: { 'aria-label': RESET_TOOLTIP },
    });
    setIcon(reset, 'rotate-ccw');
    setTooltip(reset, RESET_TOOLTIP);
    listen(reset, 'click', () => {
        // The disabled state is the affordance; this is the behaviour.
        if (host.isLocked() || !host.isOverridden(token)) return;
        commit(null);
    }, detaches);

    // --- the locator ---------------------------------------------------------
    if (token.controlType === 'color') {
        const start = (): void => {
            win.clearTimeout(hoverTimer);
            hoverTimer = win.setTimeout(() => host.preview(token), LOCATOR_DELAY_MS);
        };
        const stop = (): void => {
            win.clearTimeout(hoverTimer);
            hoverTimer = 0;
            host.preview(null);
        };
        listen(row, 'pointerenter', start, detaches);
        listen(row, 'pointerleave', stop, detaches);
    }

    function buildColorEditor(): HTMLButtonElement | null {
        // A label wrapping an invisible native colour input. The label paints
        // the STORED STRING through a custom property — so it shows
        // translucency and `color-mix()` truthfully — and the input across it
        // takes the click. Owning the input is what makes it live: Obsidian's
        // ColorComponent listens for `change` only, which does not arrive until
        // the native picker is dismissed.
        const picker = el(preview, 'input', {
            cls: 'nexus-studio-picker',
            attr: { type: 'color', 'aria-label': `${token.label} colour` },
        });

        const parsed = () => parseColorValue(host.currentValue(token));
        const writeColor = (hexValue: string, nextAlpha?: number): void => {
            if (host.isLocked()) return;
            commit(formatColorValue(hexValue, nextAlpha ?? parsed()?.alpha ?? 1));
        };
        // `input` streams while the colour moves; `change` covers the keyboard
        // path and any platform where the picker only commits.
        listen(picker, 'input', () => writeColor(picker.value), detaches);
        listen(picker, 'change', () => writeColor(picker.value), detaches);

        let tool: HTMLButtonElement | null = null;
        if (host.pickKind) {
            const tip =
                host.pickKind === 'capture'
                    ? 'Take a colour from Obsidian'
                    : 'Pick a colour from the screen';
            const theTool = button(actions, {
                cls: ['clickable-icon', 'nexus-studio-pipette'],
                attr: { 'aria-label': tip },
            });
            tool = theTool;
            setIcon(theTool, 'pipette');
            setTooltip(theTool, tip);
            listen(theTool, 'click', () => {
                if (host.isLocked()) return;
                // The preview goes first, or the pick would take the locator's
                // magenta off the very surface being sampled.
                win.clearTimeout(hoverTimer);
                host.preview(null);
                void host.pickColor().then((picked) => {
                    if (picked !== null) writeColor(picked);
                });
            }, detaches);
        }

        let alpha: HTMLInputElement | null = null;
        let readout: HTMLElement | null = null;
        if (token.supportsAlpha) {
            const line = el(row, 'div', { cls: 'nexus-studio-row-alpha' });
            el(line, 'span', { cls: 'nexus-studio-row-alpha-label', text: 'Opacity' });
            const slider = el(line, 'input', {
                cls: 'nexus-studio-alpha',
                attr: {
                    type: 'range',
                    min: '0',
                    max: '100',
                    step: '1',
                    'aria-label': `${token.label} opacity`,
                },
            });
            alpha = slider;
            readout = el(line, 'span', { cls: 'nexus-studio-alpha-readout' });
            listen(slider, 'input', () => {
                const current = parsed();
                if (!current) return;
                writeColor(current.hex, percentToAlpha(Number(slider.value)));
            }, detaches);
        }

        syncs.push(() => {
            const locked = host.isLocked();
            const value = host.currentValue(token);
            const colour = parseColorValue(value);
            const focused = docOf(row).activeElement;
            preview.style.setProperty('--nexus-studio-swatch', value);
            preview.classList.toggle('is-complex', colour === null);
            picker.disabled = locked || colour === null;
            if (colour && picker.value !== colour.hex) picker.value = colour.hex;
            if (chip) {
                chip.textContent = colour ? colour.hex : COMPLEX_VALUE_LABEL;
                chip.classList.toggle('is-complex', colour === null);
            }
            if (alpha && readout) {
                alpha.disabled = locked || colour === null;
                const percent = colour ? alphaToPercent(colour.alpha) : 100;
                if (focused !== alpha && alpha.value !== String(percent)) alpha.value = String(percent);
                readout.textContent = colour ? `${percent}%` : '—';
            }
            if (tool) tool.disabled = locked;
        });
        return tool;
    }

    function buildRangeEditor(): void {
        const range = token.range;
        const unit = range?.unit ?? '';
        el(preview, 'span', { text: 'Aa' });
        const line = el(row, 'div', { cls: 'nexus-studio-row-range' });
        const slider = el(line, 'input', {
            cls: 'nexus-studio-range',
            attr: {
                type: 'range',
                min: String(range?.min ?? 0),
                max: String(range?.max ?? 100),
                step: String(range?.step ?? 1),
                'aria-label': token.label,
            },
        });
        const readout = el(line, 'span', { cls: 'nexus-studio-range-readout' });

        /** The value as a slider position, when it is a plain number in the unit. */
        const position = (value: string): number | null => {
            const match = new RegExp(`^(\\d*\\.?\\d+)${unit}$`).exec(value.trim());
            if (!match) return null;
            const amount = Number(match[1]);
            if (!range || amount < range.min || amount > range.max) return null;
            return amount;
        };

        listen(slider, 'input', () => {
            if (host.isLocked()) return;
            // Written the way the defaults are written, so dragging back to the
            // default lands textually ON it rather than near it.
            const amount = Number(slider.value);
            commit(`${Number(amount.toFixed(4))}${unit}`);
        }, detaches);

        syncs.push(() => {
            const value = host.currentValue(token);
            const at = position(value);
            // A value the slider cannot show — `calc()`, another unit, outside
            // the range — keeps its raw text and parks the slider, rather than
            // being snapped to a slider position.
            slider.disabled = host.isLocked() || at === null;
            if (at !== null && docOf(row).activeElement !== slider) slider.value = String(at);
            readout.textContent = at !== null ? value.trim() : '—';
            if (chip) {
                chip.textContent = at !== null ? value.trim() : COMPLEX_VALUE_LABEL;
                chip.classList.toggle('is-complex', at === null);
            }
        });
    }

    function buildFontEditor(): void {
        el(preview, 'span', { text: 'Aa' });
        const line = el(row, 'div', { cls: 'nexus-studio-row-font' });
        const select = el(line, 'select', {
            cls: ['dropdown', 'nexus-studio-font-select'],
            attr: { 'aria-label': `${token.label} suggestion` },
        });
        const custom = el(select, 'option', { text: CUSTOM_FONT_LABEL, attr: { value: '' } });
        custom.disabled = true;
        for (const suggestion of token.suggestions ?? []) {
            el(select, 'option', { text: suggestion.label, attr: { value: suggestion.value } });
        }
        const input = el(line, 'input', {
            cls: 'nexus-studio-font-input',
            attr: {
                type: 'text',
                spellcheck: 'false',
                placeholder: token.defaultValue,
                'aria-label': `${token.label} CSS value`,
            },
        });
        cssInput = input;

        listen(select, 'change', () => {
            if (host.isLocked() || !select.value) return;
            input.value = select.value;
            commit(select.value);
        }, detaches);
        listen(input, 'input', () => writeRaw(input), detaches);

        syncs.push(() => {
            const value = host.currentValue(token);
            const match = (token.suggestions ?? []).find((s) => s.value === value.trim());
            select.value = match ? match.value : '';
            select.disabled = host.isLocked();
            // The preview is set in the family it names — the one place a font
            // choice can be judged before it is spread over the whole interface.
            preview.style.setProperty('--nexus-studio-font-preview', value);
        });
    }

    // --- reading --------------------------------------------------------------
    function sync(): void {
        const locked = host.isLocked();
        const value = host.currentValue(token);
        const focused = docOf(row).activeElement;
        for (const refresh of syncs) refresh();
        if (chip) chip.setAttribute('title', value);
        if (cssInput) {
            cssInput.disabled = locked;
            // Never overwrite the field somebody is typing into.
            if (focused !== cssInput && cssInput.value !== value) cssInput.value = value;
        }
        const overridden = host.isOverridden(token);
        reset.disabled = locked || !overridden;
        row.classList.toggle('is-overridden', overridden);
        if (pipette) pipette.disabled = locked;
    }

    sync();

    return {
        el: row,
        sync,
        dispose(): void {
            win.clearTimeout(hoverTimer);
            hoverTimer = 0;
            for (const detach of detaches) detach();
        },
    };
}
