// contrast.ts
// How far apart a text colour and a surface are, by the WCAG definition.
//
// Not a brightness difference and not an estimate: relative luminance from
// linearised sRGB, and the ratio (L1 + 0.05) / (L2 + 0.05) that WCAG 2.x
// defines. Black on white is 21:1 and any colour on itself is 1:1, and both are
// pinned by tests.
//
// WHAT THIS IS NOT, and the studio says so where it shows the numbers: an
// accessibility audit. It measures the colour pairs the token table names — a
// text token against a surface token — and nothing about what is rendered: not
// font size, not weight, not anti-aliasing, not the other colours a component
// might draw text in. A good figure here is a good figure for that pair, not a
// certificate for the theme.
//
// Pure, like every other decision in this plugin. Resolving a CSS expression
// the parser cannot take apart (`color-mix()`, `var()`) needs the browser; that
// happens in the panel, which hands this module only colours it has resolved.

import { parseColorValue, type ParsedColor } from './colorValue';

/** Normal-size text: the WCAG AA threshold. */
export const CONTRAST_TEXT = 4.5;

/** Large text and UI components: the WCAG AA threshold for those. */
export const CONTRAST_LARGE = 3;

/** How a measured pair should be read. */
export type ContrastGrade = 'text' | 'large-only' | 'too-low';

/** One channel, 0–255, as linear light. */
function linear(channel: number): number {
    const c = channel / 255;
    // The sRGB transfer function. 0.04045 is the value in the sRGB standard;
    // WCAG 2.0 printed 0.03928, which WCAG 2.2 notes and corrects. The two
    // differ for no 8-bit channel value that matters to a ratio.
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The hex part of a parsed colour as three channels. */
function channels(hex: string): [number, number, number] {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}

/** WCAG relative luminance of an opaque colour, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
    const [r, g, b] = channels(hex);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio of two opaque colours, 1 to 21, order-independent. */
export function contrastRatio(a: string, b: string): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const [light, dark] = la >= lb ? [la, lb] : [lb, la];
    return (light + 0.05) / (dark + 0.05);
}

/**
 * A translucent colour as it actually appears over an opaque background.
 *
 * Text may be translucent — a muted grey is sometimes white at 70% — and its
 * contrast is the contrast of what the eye receives, which is the blend.
 */
export function composite(top: ParsedColor, background: ParsedColor): string {
    const [tr, tg, tb] = channels(top.hex);
    const [br, bg, bb] = channels(background.hex);
    const mix = (t: number, b: number) =>
        Math.round(t * top.alpha + b * (1 - top.alpha))
            .toString(16)
            .padStart(2, '0');
    return `#${mix(tr, br)}${mix(tg, bg)}${mix(tb, bb)}`;
}

/** Reads a ratio against the thresholds. */
export function gradeContrast(ratio: number): ContrastGrade {
    if (ratio >= CONTRAST_TEXT) return 'text';
    if (ratio >= CONTRAST_LARGE) return 'large-only';
    return 'too-low';
}

/** What measuring one pair produced. */
export type ContrastResult =
    | { measured: true; ratio: number; grade: ContrastGrade; text: string; surface: string }
    | { measured: false; reason: string };

/**
 * Measures a text colour against a surface, both given as CSS colours.
 *
 * Fail-soft on purpose, and never optimistic: a value that cannot be read, or a
 * surface that is itself translucent — whose real colour depends on whatever is
 * behind it, which this cannot see — produces "not measured" with a reason,
 * rather than a number that might be wrong in the reassuring direction.
 */
export function measureContrast(textValue: string, surfaceValue: string): ContrastResult {
    const text = parseColorValue(textValue);
    const surface = parseColorValue(surfaceValue);
    if (!surface) return { measured: false, reason: 'The surface is not a colour this can read.' };
    if (!text) return { measured: false, reason: 'The text colour is not a colour this can read.' };
    if (surface.alpha < 1) {
        return { measured: false, reason: 'The surface is translucent, so its real colour depends on what is behind it.' };
    }
    const shown = text.alpha < 1 ? composite(text, surface) : text.hex;
    const ratio = contrastRatio(shown, surface.hex);
    return { measured: true, ratio, grade: gradeContrast(ratio), text: shown, surface: surface.hex };
}

/** A ratio as people read it: one decimal, "7.2:1". */
export function formatRatio(ratio: number): string {
    return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}
