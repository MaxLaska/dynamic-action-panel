// colorValue.ts
// Turning a CSS colour into a swatch and an opacity, and back.
//
// This exists because of one honest limitation: a native `<input type="color">`
// understands `#rrggbb` and nothing else. No alpha, no `rgba()`, no
// `color-mix()`. Three of the eleven Nexus tokens are white at three different
// alphas, so without this module those three were a text field while everything
// else was a colour picker — a distinction the user should never have had to
// notice, and one they reported immediately.
//
// THE RULE THIS FILE FOLLOWS, and the reason it can fail: **the text is
// authoritative.** The picker and the opacity slider are a VIEW of the stored
// value, offered when the value happens to be simple enough to have one. A
// value this module cannot take apart — `color-mix()`, `var()`, `oklch()`, a
// named colour it does not know — is not an error and is never rewritten. It
// keeps its text field, loses its swatch, and goes on working. That is why
// `parse` returns null rather than a guess: a guess would silently replace a
// value the user wrote deliberately.

/** A colour the editor can show in a swatch: opaque hex plus an opacity. */
export interface ParsedColor {
    /** Always `#rrggbb`, lower case. What the native input wants. */
    hex: string;
    /** 0 to 1 inclusive. */
    alpha: number;
}

/** Opacity is stored at this many decimal places; enough for a 0–100% slider. */
const ALPHA_DECIMALS = 2;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** A channel as two lower-case hex digits. */
function channelHex(value: number): string {
    return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

/** Rounds an opacity the way it will be stored, so comparisons are stable. */
export function roundAlpha(alpha: number): number {
    const factor = 10 ** ALPHA_DECIMALS;
    return clamp(Math.round(alpha * factor) / factor, 0, 1);
}

/**
 * A channel written as a number or a percentage.
 *
 * `rgb(100% 0% 0%)` is as valid as `rgb(255 0 0)` and appears in real
 * stylesheets, so refusing it would mean a value the browser accepts loses its
 * swatch for no reason the user can see.
 */
function channelValue(raw: string): number | null {
    const text = raw.trim();
    if (text.endsWith('%')) {
        const percent = Number(text.slice(0, -1));
        if (!Number.isFinite(percent)) return null;
        return clamp((percent / 100) * 255, 0, 255);
    }
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    return clamp(number, 0, 255);
}

/** An alpha written as a number or a percentage. */
function alphaValue(raw: string): number | null {
    const text = raw.trim();
    if (text.endsWith('%')) {
        const percent = Number(text.slice(0, -1));
        if (!Number.isFinite(percent)) return null;
        return clamp(percent / 100, 0, 1);
    }
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    return clamp(number, 0, 1);
}

const HEX = /^#([0-9a-f]{3,8})$/i;
const FUNCTIONAL = /^rgba?\(([^)]*)\)$/i;
const HSL = /^hsla?\(([^)]*)\)$/i;
const SRGB = /^color\(\s*srgb\s+([^/)]*?)\s*(?:\/\s*([^)]*?))?\s*\)$/i;

/**
 * Reads a CSS colour into a swatch colour and an opacity, or answers null.
 *
 * Handles the forms this project actually stores and the ones a user is likely
 * to paste: three-, four-, six- and eight-digit hex, and `rgb()`/`rgba()` in
 * both the comma syntax and the modern space syntax with a slashed alpha.
 *
 * `transparent` is included because it is the one keyword with a meaning the
 * swatch can show exactly — black at zero opacity — and because a token set to
 * `transparent` is a real thing somebody will try.
 *
 * Everything else answers null ON PURPOSE. This is not a CSS colour engine, and
 * the moment it starts guessing at `color-mix()` it would start rewriting
 * values it did not really understand.
 */
export function parseColorValue(value: string): ParsedColor | null {
    const text = value.trim().toLowerCase();
    if (text.length === 0) return null;
    if (text === 'transparent') return { hex: '#000000', alpha: 0 };

    const hex = HEX.exec(text);
    if (hex) {
        const digits = hex[1] ?? '';
        if (digits.length === 3 || digits.length === 4) {
            const [r, g, b, a] = digits;
            return {
                hex: `#${r}${r}${g}${g}${b}${b}`,
                alpha: a === undefined ? 1 : roundAlpha(parseInt(`${a}${a}`, 16) / 255),
            };
        }
        if (digits.length === 6) return { hex: `#${digits}`, alpha: 1 };
        if (digits.length === 8) {
            return {
                hex: `#${digits.slice(0, 6)}`,
                alpha: roundAlpha(parseInt(digits.slice(6, 8), 16) / 255),
            };
        }
        // Five and seven digits are not colours, just truncated ones.
        return null;
    }

    // `color(srgb r g b / a)`, channels 0–1. Rarely typed, but it is how
    // Chromium serialises the COMPUTED value of an sRGB `color-mix()`, so it is
    // what comes back when the browser is asked to resolve one.
    const srgb = SRGB.exec(text);
    if (srgb) {
        const parts = (srgb[1] ?? '').trim().split(/\s+/);
        if (parts.length !== 3) return null;
        const unit = parts.map(Number);
        if (unit.some((v) => !Number.isFinite(v))) return null;
        const alpha = srgb[2] === undefined ? 1 : alphaValue(srgb[2]);
        if (alpha === null) return null;
        const [r, g, b] = unit.map((v) => clamp(v, 0, 1) * 255);
        return {
            hex: `#${channelHex(r ?? 0)}${channelHex(g ?? 0)}${channelHex(b ?? 0)}`,
            alpha: roundAlpha(alpha),
        };
    }

    const hsl = HSL.exec(text);
    if (hsl) return parseHslBody(hsl[1] ?? '');

    const functional = FUNCTIONAL.exec(text);
    if (!functional) return null;
    const body = functional[1] ?? '';
    // The modern syntax separates the alpha with a slash; the legacy one uses a
    // comma. Normalising both to one list keeps the rest of this one branch.
    const [channelPart, slashAlpha, ...extraSlashes] = body.split('/');
    if (extraSlashes.length > 0) return null;
    const parts = (channelPart ?? '')
        .split(/[\s,]+/)
        .map((part) => part.trim())
        .filter(Boolean);
    const alphaPart = slashAlpha ?? (parts.length === 4 ? parts[3] : undefined);
    if (parts.length !== 3 && parts.length !== 4) return null;
    if (slashAlpha !== undefined && parts.length !== 3) return null;

    const channels = parts.slice(0, 3).map(channelValue);
    if (channels.some((channel) => channel === null)) return null;
    const alpha = alphaPart === undefined ? 1 : alphaValue(alphaPart);
    if (alpha === null) return null;

    const [r, g, b] = channels as number[];
    return {
        hex: `#${channelHex(r ?? 0)}${channelHex(g ?? 0)}${channelHex(b ?? 0)}`,
        alpha: roundAlpha(alpha),
    };
}

/**
 * Writes a swatch colour and an opacity back out as CSS.
 *
 * Fully opaque comes back as plain `#rrggbb` rather than `rgba(…, 1)`. That is
 * not cosmetic: the hex form is what the defaults are written in, so a token
 * dragged to full opacity ends up textually equal to its default instead of
 * merely equivalent to it, and "is this overridden" stays a question about
 * values rather than about spelling.
 */
export function formatColorValue(hex: string, alpha: number): string {
    const parsed = parseColorValue(hex);
    const base = parsed?.hex ?? '#000000';
    const rounded = roundAlpha(alpha);
    if (rounded >= 1) return base;
    const r = parseInt(base.slice(1, 3), 16);
    const g = parseInt(base.slice(3, 5), 16);
    const b = parseInt(base.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${rounded})`;
}

/** Opacity as the whole percent the slider shows. */
export function alphaToPercent(alpha: number): number {
    return Math.round(clamp(alpha, 0, 1) * 100);
}

/** The slider's percent as a stored opacity. */
export function percentToAlpha(percent: number): number {
    return roundAlpha(clamp(percent, 0, 100) / 100);
}

// --- the picker's colour model ---------------------------------------------------
//
// ONE model. A colour is RGBA — channels 0–255, alpha 0–1 — and HEX, RGB and
// HSL are only ways of showing it or typing it. What is STORED is always what
// `formatColorValue` writes (`#rrggbb`, or `rgba()` below full opacity), so
// switching the display format can never change a stored value: nothing is
// written by a switch at all.
//
// HSV exists for the picker's square and hue bar and nothing else. The picker
// keeps its own hue while the colour is grey (where RGB has no hue to give),
// so dragging through black does not throw the hue back to red.

/** A colour: channels 0–255, alpha 0–1. */
export interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

/** Hue 0–360, saturation and value 0–100, alpha 0–1. */
export interface Hsva {
    h: number;
    s: number;
    v: number;
    a: number;
}

/** Hue 0–360, saturation and lightness 0–100, alpha 0–1. */
export interface Hsla {
    h: number;
    s: number;
    l: number;
    a: number;
}

/** The ways a colour can be shown and typed. None of them is stored. */
export type ColorFormat = 'hex' | 'rgb' | 'hsl';
export const COLOR_FORMATS: readonly ColorFormat[] = ['hex', 'rgb', 'hsl'];

export function isColorFormat(value: unknown): value is ColorFormat {
    return value === 'hex' || value === 'rgb' || value === 'hsl';
}

/** A hue in degrees, from `120`, `120deg`, `0.5turn`, `2rad`. */
function hueValue(raw: string): number | null {
    const text = raw.trim();
    const match = /^(-?\d*\.?\d+)(deg|turn|rad|grad)?$/.exec(text);
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2] ?? 'deg';
    const degrees =
        unit === 'turn' ? amount * 360 : unit === 'rad' ? (amount * 180) / Math.PI : unit === 'grad' ? amount * 0.9 : amount;
    return ((degrees % 360) + 360) % 360;
}

/** A percentage 0–100 from `40%` (or a bare number, as CSS Color 4 allows). */
function percentValue(raw: string): number | null {
    const text = raw.trim().replace(/%$/, '');
    const number = Number(text);
    if (text.length === 0 || !Number.isFinite(number)) return null;
    return clamp(number, 0, 100);
}

/** The inside of `hsl()`/`hsla()`, in the comma or the space syntax. */
function parseHslBody(body: string): ParsedColor | null {
    const [channelPart, slashAlpha, ...extra] = body.split('/');
    if (extra.length > 0) return null;
    const parts = (channelPart ?? '')
        .split(/[\s,]+/)
        .map((part) => part.trim())
        .filter(Boolean);
    if (parts.length !== 3 && parts.length !== 4) return null;
    if (slashAlpha !== undefined && parts.length !== 3) return null;
    const h = hueValue(parts[0] ?? '');
    const s = percentValue(parts[1] ?? '');
    const l = percentValue(parts[2] ?? '');
    const alphaPart = slashAlpha ?? parts[3];
    const a = alphaPart === undefined ? 1 : alphaValue(alphaPart);
    if (h === null || s === null || l === null || a === null) return null;
    const rgb = hslToRgba({ h, s, l, a });
    return { hex: rgbaToHex(rgb), alpha: roundAlpha(a) };
}

/** A CSS colour as RGBA, or null for anything `parseColorValue` would refuse. */
export function parseRgba(value: string): Rgba | null {
    const parsed = parseColorValue(value);
    if (!parsed) return null;
    return {
        r: parseInt(parsed.hex.slice(1, 3), 16),
        g: parseInt(parsed.hex.slice(3, 5), 16),
        b: parseInt(parsed.hex.slice(5, 7), 16),
        a: parsed.alpha,
    };
}

/** `#rrggbb`, lower case; alpha is not part of it. */
export function rgbaToHex(color: Rgba): string {
    return `#${channelHex(color.r)}${channelHex(color.g)}${channelHex(color.b)}`;
}

/** The stored form: plain hex when opaque, `rgba()` otherwise. */
export function rgbaToCss(color: Rgba): string {
    return formatColorValue(rgbaToHex(color), color.a);
}

export function rgbaToHsva(color: Rgba): Hsva {
    const r = clamp(color.r, 0, 255) / 255;
    const g = clamp(color.g, 0, 255) / 255;
    const b = clamp(color.b, 0, 255) / 255;
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    let h = 0;
    if (delta > 0) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h = (h * 60 + 360) % 360;
    }
    return { h, s: max === 0 ? 0 : (delta / max) * 100, v: max * 100, a: color.a };
}

export function hsvaToRgba(color: Hsva): Rgba {
    const h = (((color.h % 360) + 360) % 360) / 60;
    const s = clamp(color.s, 0, 100) / 100;
    const v = clamp(color.v, 0, 100) / 100;
    const c = v * s;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = v - c;
    const [r, g, b] =
        h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
        a: clamp(color.a, 0, 1),
    };
}

export function rgbaToHsla(color: Rgba): Hsla {
    const r = clamp(color.r, 0, 255) / 255;
    const g = clamp(color.g, 0, 255) / 255;
    const b = clamp(color.b, 0, 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const delta = max - min;
    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    return { h: rgbaToHsva(color).h, s: s * 100, l: l * 100, a: color.a };
}

export function hslToRgba(color: Hsla): Rgba {
    const s = clamp(color.s, 0, 100) / 100;
    const l = clamp(color.l, 0, 100) / 100;
    const v = l + s * Math.min(l, 1 - l);
    const sv = v === 0 ? 0 : 2 * (1 - l / v);
    return hsvaToRgba({ h: color.h, s: sv * 100, v: v * 100, a: color.a });
}

/** Rounded the way the fields show it. */
const round = (value: number): number => Math.round(value);

/**
 * A colour as text in a display format. For showing and copying only — the
 * stored value is `rgbaToCss`, whichever format is on screen.
 */
export function describeColor(color: Rgba, format: ColorFormat): string {
    const alpha = roundAlpha(color.a);
    if (format === 'rgb') {
        const channels = `${round(color.r)}, ${round(color.g)}, ${round(color.b)}`;
        return alpha < 1 ? `rgba(${channels}, ${alpha})` : `rgb(${channels})`;
    }
    if (format === 'hsl') {
        const hsl = rgbaToHsla(color);
        const body = `${round(hsl.h)}, ${round(hsl.s)}%, ${round(hsl.l)}%`;
        return alpha < 1 ? `hsla(${body}, ${alpha})` : `hsl(${body})`;
    }
    return rgbaToHex(color);
}
