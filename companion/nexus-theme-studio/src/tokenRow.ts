// tokenRow.ts
// One token's controls, and the one rule that keeps them honest.
//
// THE RULE: the controls are a VIEW of the stored value. Every path — picker,
// opacity, pipette, raw CSS, reset — writes a CSS string and then re-reads the
// state to redraw itself. The first version computed each control's state once,
// at render, and a write deliberately does not re-render; the reset arrow was
// therefore rendered disabled and stayed disabled after the value changed.
// Holding the elements and re-syncing them is the habit, not a patch.
//
// THE SHAPE, since the studio became a workspace view. The row is a DESIGN
// control first and a CSS form second:
//
//   [swatch]  Label                         [#333333] [pipette] [reset]
//             one line saying what it paints
//             Opacity [=========o========] 28%        (translucent tokens)
//             CSS value [ rgba(255, 255, 255, 0.28) ] (only when opened)
//
// The raw value is still there and still authoritative — it is how `rgba()`,
// `oklch()`, `var()` and `color-mix()` get in — but it is behind the value
// chip, not a 16em field deciding the width of every row. A value the swatch
// cannot represent is never hidden: the chip reads `CSS` and the swatch still
// paints the real colour, because it paints the stored string itself.
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
import { eyedropperAvailable, pickScreenColor } from './eyedropper';
import { isValidTokenValue } from './overrides';

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
    /** The window this row lives in, for timers and the screen sampler. */
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
 * How long the pointer must rest on a row before the locator paints.
 *
 * Without a delay, sweeping the pointer down the panel flashes half the
 * workspace magenta on the way past. With one, resting on a row still feels
 * immediate.
 */
export const LOCATOR_DELAY_MS = 200;

/** The one tooltip the per-token reset has, whatever the value is. */
export const RESET_TOOLTIP = 'Reset to default';

/** What the value chip says when the stored value has no swatch form. */
export const COMPLEX_VALUE_LABEL = 'CSS';

/** Unique element ids across every row in every open studio view. */
let rowSerial = 0;

export function renderTokenRow(
    parent: HTMLElement,
    token: ThemeTokenDefinition,
    host: TokenRowHost
): TokenRowHandle {
    const win = host.win;
    const serial = (rowSerial += 1);
    const cssId = `nexus-studio-css-${serial}`;
    let hoverTimer = 0;

    const row = el(parent, 'div', {
        cls: 'nexus-studio-row',
        attr: { 'data-token': token.key },
    });

    // --- the swatch --------------------------------------------------------
    //
    // A label wrapping an invisible native colour input. The label is what you
    // see — it paints the STORED STRING through a custom property, so it shows
    // `color-mix()` and translucency truthfully, over a checkerboard — and the
    // input stretched across it is what you click. Owning the input is also
    // what makes it live: Obsidian's ColorComponent listens for `change` only,
    // which does not arrive until the native picker is dismissed.
    const swatch = el(row, 'label', { cls: 'nexus-studio-swatch' });
    const picker = el(swatch, 'input', {
        cls: 'nexus-studio-picker',
        attr: { type: 'color', 'aria-label': `${token.label} colour` },
    });

    const text = el(row, 'div', { cls: 'nexus-studio-row-text' });
    el(text, 'div', { cls: 'nexus-studio-row-label', text: token.label });
    el(text, 'div', { cls: 'nexus-studio-row-desc', text: token.description });

    const actions = el(row, 'div', { cls: 'nexus-studio-row-actions' });

    // The value chip: a compact readout of the current value, and the
    // disclosure for the raw CSS editor. One control for both, because "what is
    // this value" and "let me type it" are the same question at two depths.
    const chip = button(actions, {
        cls: 'nexus-studio-value',
        attr: { 'aria-expanded': 'false', 'aria-controls': cssId },
    });

    let pipette: HTMLButtonElement | null = null;
    if (eyedropperAvailable(win)) {
        pipette = button(actions, {
            cls: ['clickable-icon', 'nexus-studio-pipette'],
            attr: { 'aria-label': 'Pick a colour from the screen' },
        });
        setIcon(pipette, 'pipette');
        setTooltip(pipette, 'Pick a colour from the screen');
    }

    const reset = button(actions, {
        cls: ['clickable-icon', 'nexus-studio-reset'],
        attr: { 'aria-label': RESET_TOOLTIP },
    });
    setIcon(reset, 'rotate-ccw');
    setTooltip(reset, RESET_TOOLTIP);

    // --- the opacity -------------------------------------------------------
    //
    // Only where the token's own default is translucent (`supportsAlpha` in
    // the registry). A slider on all eleven rows would serve three.
    let alpha: HTMLInputElement | null = null;
    let alphaReadout: HTMLElement | null = null;
    if (token.supportsAlpha) {
        const line = el(row, 'div', { cls: 'nexus-studio-row-alpha' });
        el(line, 'span', { cls: 'nexus-studio-row-alpha-label', text: 'Opacity' });
        alpha = el(line, 'input', {
            cls: 'nexus-studio-alpha',
            attr: {
                type: 'range',
                min: '0',
                max: '100',
                step: '1',
                'aria-label': `${token.label} opacity`,
            },
        });
        alphaReadout = el(line, 'span', { cls: 'nexus-studio-alpha-readout' });
    }

    // --- the raw CSS value -------------------------------------------------
    const cssLine = el(row, 'div', { cls: 'nexus-studio-row-css', attr: { id: cssId } });
    cssLine.hidden = true;
    const cssInput = el(cssLine, 'input', {
        cls: 'nexus-studio-css-input',
        attr: {
            type: 'text',
            spellcheck: 'false',
            placeholder: token.defaultValue,
            'aria-label': `${token.label} CSS value`,
        },
    });

    // --- writing -----------------------------------------------------------
    const parsed = (): { hex: string; alpha: number } | null =>
        parseColorValue(host.currentValue(token));

    const commit = (value: string | null): void => {
        host.write(token, value);
        sync();
    };

    /**
     * A colour and an opacity as one CSS value. The opacity comes from the
     * current value unless given, so moving the picker on
     * `rgba(255,255,255,0.28)` keeps the 0.28 instead of silently making the
     * splitter opaque.
     */
    const writeColor = (hex: string, nextAlpha?: number): void => {
        if (host.isLocked()) return;
        commit(formatColorValue(hex, nextAlpha ?? parsed()?.alpha ?? 1));
    };

    // `input` streams while the colour moves; `change` covers the keyboard
    // path and any platform where the picker only commits. Writing the same
    // value twice is idempotent.
    const onPicker = (): void => writeColor(picker.value);
    picker.addEventListener('input', onPicker);
    picker.addEventListener('change', onPicker);

    const onAlpha = (): void => {
        const current = parsed();
        if (!alpha || !current) return;
        writeColor(current.hex, percentToAlpha(Number(alpha.value)));
    };
    alpha?.addEventListener('input', onAlpha);

    const onChip = (): void => {
        const opening = cssLine.hidden;
        cssLine.hidden = !opening;
        chip.setAttribute('aria-expanded', opening ? 'true' : 'false');
        row.toggleAttribute('data-css-open', opening);
        if (opening) {
            cssInput.value = host.currentValue(token);
            cssInput.focus();
        }
        // Closing writes nothing. Whatever was valid was written as it was
        // typed; whatever was not is simply dropped with the field.
    };
    chip.addEventListener('click', onChip);

    const onCssInput = (): void => {
        if (host.isLocked()) return;
        const next = cssInput.value;
        if (next.trim().length === 0) {
            cssInput.removeAttribute('aria-invalid');
            commit(null);
            return;
        }
        // An invalid value is neither written nor reverted: the user is
        // probably still typing it.
        if (!isValidTokenValue(next)) {
            cssInput.setAttribute('aria-invalid', 'true');
            return;
        }
        cssInput.removeAttribute('aria-invalid');
        commit(next);
    };
    cssInput.addEventListener('input', onCssInput);

    const onReset = (): void => {
        // Checked here as well as reflected in `disabled`. The state is the
        // affordance; this is the behaviour.
        if (host.isLocked() || !host.isOverridden(token)) return;
        commit(null);
        if (!cssLine.hidden) cssInput.value = host.currentValue(token);
    };
    reset.addEventListener('click', onReset);

    const onPipette = (): void => {
        if (host.isLocked()) return;
        // The preview has to go first, or the sampler would pick up the
        // locator's magenta off the very surface being sampled.
        win.clearTimeout(hoverTimer);
        host.preview(null);
        void pickScreenColor(win).then((picked) => {
            if (picked !== null) writeColor(picked);
        });
    };
    pipette?.addEventListener('click', onPipette);

    // --- the locator -------------------------------------------------------
    const startPreview = (): void => {
        win.clearTimeout(hoverTimer);
        hoverTimer = win.setTimeout(() => host.preview(token), LOCATOR_DELAY_MS);
    };
    const stopPreview = (): void => {
        win.clearTimeout(hoverTimer);
        hoverTimer = 0;
        host.preview(null);
    };
    row.addEventListener('pointerenter', startPreview);
    row.addEventListener('pointerleave', stopPreview);

    // --- reading -----------------------------------------------------------
    function sync(): void {
        const locked = host.isLocked();
        const value = host.currentValue(token);
        const colour = parseColorValue(value);
        const focused = docOf(row).activeElement;

        swatch.style.setProperty('--nexus-studio-swatch', value);
        swatch.classList.toggle('is-complex', colour === null);
        picker.disabled = locked || colour === null;
        if (colour && picker.value !== colour.hex) picker.value = colour.hex;

        chip.textContent = colour ? colour.hex : COMPLEX_VALUE_LABEL;
        chip.classList.toggle('is-complex', colour === null);
        // The full value on hover, always — for a complex value it is the only
        // place short of the editor where the actual CSS can be read.
        chip.setAttribute('title', value);
        chip.setAttribute(
            'aria-label',
            colour ? `${token.label}: ${value}. Edit CSS value` : `${token.label}: custom CSS value ${value}. Edit CSS value`
        );

        if (alpha && alphaReadout) {
            alpha.disabled = locked || colour === null;
            const percent = colour ? alphaToPercent(colour.alpha) : 100;
            if (focused !== alpha && alpha.value !== String(percent)) alpha.value = String(percent);
            alphaReadout.textContent = colour ? `${percent}%` : '—';
        }

        cssInput.disabled = locked;
        // Never overwrite the field somebody is typing into.
        if (focused !== cssInput && cssInput.value !== value) cssInput.value = value;

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
            picker.removeEventListener('input', onPicker);
            picker.removeEventListener('change', onPicker);
            alpha?.removeEventListener('input', onAlpha);
            chip.removeEventListener('click', onChip);
            cssInput.removeEventListener('input', onCssInput);
            reset.removeEventListener('click', onReset);
            pipette?.removeEventListener('click', onPipette);
            row.removeEventListener('pointerenter', startPreview);
            row.removeEventListener('pointerleave', stopPreview);
        },
    };
}
