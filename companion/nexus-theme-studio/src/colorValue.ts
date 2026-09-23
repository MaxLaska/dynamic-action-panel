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
