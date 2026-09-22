// tokenRow.ts
// One token's controls, and the one rule that keeps them honest.
//
// THE RULE: the controls are a VIEW of the stored value. The value is not a
// consequence of the controls. Every path — picker, opacity, pipette, text,
// reset — writes a CSS string and then re-reads the state to redraw itself.
//
// That is not ceremony. The first version of this row computed each control's
// state once, while rendering, and never again, because a write deliberately
// does not re-render the tab (re-rendering mid-drag tears the colour picker out
// from under the pointer). So the per-token reset arrow was rendered disabled —
// correct, at that instant, for a token with no override — and stayed disabled
// after the user changed the colour, which is exactly the "reset does nothing"
// that came back from real use. Holding the components and re-syncing them is
// the fix, and it has to be the habit rather than a patch on one button.
//
// Everything Obsidian-specific lives here; the decisions about what a value may
// be and what it parses to live in overrides.ts and colorValue.ts, which have
// no DOM in them at all.

import type { ExtraButtonComponent, Setting, SliderComponent, TextComponent } from 'obsidian';

import type { ThemeTokenDefinition } from '../../../theme/nexus/src/tokens';
import {
    alphaToPercent,
    formatColorValue,
    parseColorValue,
    percentToAlpha,
} from './colorValue';
import { eyedropperAvailable, pickScreenColor } from './eyedropper';
import { isValidTokenValue } from './overrides';

/** What the row needs from the tab, so this file needs no plugin reference. */
export interface TokenRowHost {
    /** The value this token currently resolves to, override or theme default. */
    currentValue(token: ThemeTokenDefinition): string;
    /** Whether the active profile says anything of its own about this token. */
    isOverridden(token: ThemeTokenDefinition): boolean;
    /** Whether the active profile may be edited at all. */
    isLocked(): boolean;
    /** Stores a value, or clears the override when null. Applies immediately. */
    write(token: ThemeTokenDefinition, value: string | null): Promise<void>;
    /** Starts or stops the locator preview for this token. */
    preview(token: ThemeTokenDefinition | null): void;
}

/** A row that can be told to redraw itself from the current state. */
export interface TokenRowHandle {
    /** Re-reads everything, including the text field. */
    syncAll(): void;
    /** Re-reads everything except the text field, so typing is not interrupted. */
    syncControls(): void;
    /** Detaches what this row attached. */
    dispose(): void;
}

/**
 * How long the pointer must rest on a row before the locator paints.
 *
 * Without a delay, sweeping the mouse down the settings page flashes half the
 * workspace magenta on the way past. With one, resting on a row still feels
 * immediate. Measured by using it: 200ms is below the threshold where a
 * deliberate hover feels like waiting.
 */
export const LOCATOR_DELAY_MS = 200;

export function renderTokenRow(
    setting: Setting,
    token: ThemeTokenDefinition,
    host: TokenRowHost,
    win: Window = window
): TokenRowHandle {
    setting.setClass('nexus-studio-token');

    let swatch: HTMLInputElement | null = null;
    let alpha: SliderComponent | null = null;
    let text: TextComponent | null = null;
    let reset: ExtraButtonComponent | null = null;
    let pipette: ExtraButtonComponent | null = null;
    let hoverTimer = 0;

    /** The value as a swatch colour and an opacity, when it has one. */
    const parsed = (): { hex: string; alpha: number } | null =>
        parseColorValue(host.currentValue(token));

    /**
     * Writes a colour and an opacity as one CSS value.
     *
     * The opacity comes from the current value rather than from the slider's
     * own idea of it, so moving the picker on `rgba(255,255,255,0.28)` keeps
     * the 0.28 instead of silently making the splitter opaque.
     */
    const writeColor = (hex: string, nextAlpha?: number): void => {
        const current = parsed();
        const useAlpha = nextAlpha ?? current?.alpha ?? 1;
        void host.write(token, formatColorValue(hex, useAlpha)).then(() => rowSyncAll());
    };

    // --- the swatch ------------------------------------------------------
    //
    // A plain `<input type="color">` created here rather than Obsidian's
    // `addColorPicker`. The component is a thin wrapper that listens for
    // `change` ONLY, and `change` on a native colour input does not arrive
    // until the picker is dismissed — which is the whole of the "live editing
    // is not live" report. The element fires `input` continuously while the
    // colour moves (Obsidian's own canvas picker relies on exactly that), so
    // owning the element is what buys live feedback.
    swatch = setting.controlEl.createEl('input', {
        type: 'color',
        cls: 'nexus-studio-swatch',
    });
    swatch.setAttribute('aria-label', `${token.label} colour`);

    const onSwatchInput = (): void => {
        if (host.isLocked() || !swatch) return;
        // `input`, not `change`: this is the event that arrives while the
        // pointer is still moving inside the picker.
        writeColor(swatch.value);
    };
    swatch.addEventListener('input', onSwatchInput);
    // `change` as well, for the keyboard path and for any platform where the
    // native picker commits without streaming. Writing the same value twice
    // costs nothing — the second write is identical and idempotent.
    swatch.addEventListener('change', onSwatchInput);

    // --- the pipette -----------------------------------------------------
    //
    // Offered only where the platform can sample the screen. Where it cannot,
    // the button is simply not there: a disabled control that never becomes
    // enabled is a worse answer than no control.
    if (eyedropperAvailable(win)) {
        setting.addExtraButton((button) => {
            pipette = button;
            button
                .setIcon('pipette')
                .setTooltip('Pick a colour from anywhere on the screen')
                .onClick(() => {
                    if (host.isLocked()) return;
                    // The preview has to go first, or the user would sample the
                    // locator's magenta off their own workspace.
                    host.preview(null);
                    void pickScreenColor(win).then((picked) => {
                        if (picked === null) return;
                        writeColor(picked);
                    });
                });
        });
    }

    // --- the opacity -----------------------------------------------------
    //
    // Only where the token's own default is translucent. Putting a slider on
    // every colour would add a control to eleven rows to serve three.
    if (token.supportsAlpha) {
        setting.addSlider((slider) => {
            alpha = slider;
            slider
                .setLimits(0, 100, 1)
                // Live, for the same reason the swatch is: an opacity you can
                // only judge after letting go is an opacity you set twice.
                // Obsidian 1.13 shows the percentage beside the slider itself,
                // so there is no tooltip to ask for.
                .setInstant(true)
                .onChange((percent) => {
                    if (host.isLocked()) return;
                    const current = parsed();
                    if (!current) return;
                    writeColor(current.hex, percentToAlpha(percent));
                });
            slider.sliderEl.addClass('nexus-studio-alpha');
            slider.sliderEl.setAttribute('aria-label', `${token.label} opacity`);
        });
    }

    // --- the literal value -----------------------------------------------
    //
    // Authoritative. Everything above is a convenience over what this says.
    setting.addText((component) => {
        text = component;
        component
            .setPlaceholder(token.defaultValue)
            .onChange((next) => {
                if (host.isLocked()) return;
                if (next.trim().length === 0) {
                    void host.write(token, null).then(() => rowSyncControls());
                    return;
                }
                // An invalid value is not written and not reverted: the user is
                // probably still typing it.
                if (!isValidTokenValue(next)) return;
                void host.write(token, next).then(() => rowSyncControls());
            });
        component.inputEl.addClass('nexus-studio-value');
    });

    // --- back to the default ---------------------------------------------
    setting.addExtraButton((button) => {
        reset = button;
        button
            .setIcon('rotate-ccw')
            .setTooltip(`Back to the theme's ${token.defaultValue}`)
            .onClick(() => {
                // Checked here as well as reflected in the disabled state. The
                // state is the affordance; this is the behaviour, and a button
                // whose correctness depends on a class having been applied is
                // the bug this row was rewritten to remove.
                if (host.isLocked() || !host.isOverridden(token)) return;
                void host.write(token, null).then(() => rowSyncAll());
            });
    });

    // --- the locator ------------------------------------------------------
    const startPreview = (): void => {
        win.clearTimeout(hoverTimer);
        hoverTimer = win.setTimeout(() => host.preview(token), LOCATOR_DELAY_MS);
    };
    const stopPreview = (): void => {
        win.clearTimeout(hoverTimer);
        hoverTimer = 0;
        host.preview(null);
    };
    setting.settingEl.addEventListener('pointerenter', startPreview);
    setting.settingEl.addEventListener('pointerleave', stopPreview);

    function rowSyncControls(): void {
        const locked = host.isLocked();
        const value = host.currentValue(token);
        const colour = parseColorValue(value);

        if (swatch) {
            // A value with no swatch representation — `color-mix()`, `var()` —
            // keeps its row and loses its swatch, rather than being rewritten
            // into something this file happens to understand.
            swatch.disabled = locked || colour === null;
            swatch.toggleClass('nexus-studio-swatch-unknown', colour === null);
            if (colour && swatch.value !== colour.hex) swatch.value = colour.hex;
        }
        alpha?.setDisabled(locked || colour === null);
        if (colour) alpha?.setValue(alphaToPercent(colour.alpha));
        pipette?.setDisabled(locked);
        reset?.setDisabled(locked || !host.isOverridden(token));
        text?.setDisabled(locked);
    }

    function rowSyncAll(): void {
        const value = host.currentValue(token);
        if (text && text.getValue() !== value) text.setValue(value);
        rowSyncControls();
    }

    rowSyncAll();

    return {
        syncAll: rowSyncAll,
        syncControls: rowSyncControls,
        dispose(): void {
            win.clearTimeout(hoverTimer);
            setting.settingEl.removeEventListener('pointerenter', startPreview);
            setting.settingEl.removeEventListener('pointerleave', stopPreview);
            swatch?.removeEventListener('input', onSwatchInput);
            swatch?.removeEventListener('change', onSwatchInput);
        },
    };
}
