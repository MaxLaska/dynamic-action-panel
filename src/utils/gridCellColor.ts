// gridCellColor.ts
// Turning a STORED cell color into a CSS value — and the small fixed palette
// the cell color UI offers.
//
// The stored value is portable and theme-independent (`ocap:<name>` or a hex
// literal, validated by isGridCellColor); the CSS value is derived here, at
// render time, and is never persisted. That split is what lets a named color
// follow the user's theme — `ocap:red` becomes Obsidian's own `--color-red-rgb`
// in light and in dark mode — without a single `var(--…)` ever reaching
// data.json or a template file.
//
// Two rules this module exists to keep:
//
// 1. It resolves MORE values than the palette offers. `ocap:orange`, `ocap:cyan`,
//    `ocap:pink` and every hex literal are valid stored values that can arrive
//    through a template import at any time. If the resolver only knew the six
//    swatches, such a cell would silently render as uncolored — which looks
//    exactly like data loss even though the data is intact.
// 2. An unknown value is NEVER rewritten. It resolves to null (drawn as
//    uncolored) and stays in the settings untouched, so a future build that
//    does know the name can still render it.

import { isGridCellColor } from '@/utils/categoryGrid';

/**
 * Obsidian's own accent color variables (`--color-<name>-rgb`).
 *
 * These exist in every theme, which is why a named color is portable AND
 * theme-correct. The list is what Obsidian ships; it is deliberately wider than
 * the palette below.
 */
const OBSIDIAN_COLOR_NAMES = [
    'red',
    'orange',
    'yellow',
    'green',
    'cyan',
    'blue',
    'purple',
    'pink',
] as const;

/**
 * Gray is the one palette entry Obsidian has no `--color-*-rgb` for.
 *
 * It resolves through `--mono-rgb-100` instead — black in a light theme, white
 * in a dark one — which is the same mechanism the grid's own raster lines and
 * resize grips already use. A hardcoded light or dark gray hex would be wrong
 * in one of the two themes.
 */
const MONO_COLOR_NAMES = ['gray'] as const;

/** The custom property carrying the tint strength of a colored cell. */
const CELL_ALPHA_VAR = 'var(--ocap-cell-color-alpha)';

/** Strength of a mono-derived SWATCH, so gray reads as gray in both themes. */
const MONO_SWATCH_ALPHA = '0.45';

/** Prefix of a namespaced palette value. */
const OCAP_COLOR_PREFIX = 'ocap:';

/** One entry of the fixed v1 palette. */
export interface CellPaletteEntry {
    /** The stored value, or null for the "no color" entry. */
    value: string | null;
    /** i18n key of the swatch label. */
    labelKey: string;
}

/**
 * The palette v1 offers, in display order, ending with "no color".
 *
 * Six named colors plus clear. There is deliberately no free color picker and
 * no stored/editable palette: a user-defined `ocap:` name would be unresolvable
 * in any other vault the template travels to.
 */
export const CELL_COLOR_PALETTE: readonly CellPaletteEntry[] = [
    { value: 'ocap:yellow', labelKey: 'cell_color_yellow' },
    { value: 'ocap:red', labelKey: 'cell_color_red' },
    { value: 'ocap:green', labelKey: 'cell_color_green' },
    { value: 'ocap:blue', labelKey: 'cell_color_blue' },
    { value: 'ocap:purple', labelKey: 'cell_color_purple' },
    { value: 'ocap:gray', labelKey: 'cell_color_gray' },
    { value: null, labelKey: 'cell_color_none' },
];

/** The `<name>` of `ocap:<name>`, or null when the value has another shape. */
function paletteName(value: string): string | null {
    return value.startsWith(OCAP_COLOR_PREFIX)
        ? value.slice(OCAP_COLOR_PREFIX.length)
        : null;
}

/** Expands `#rgb`/`#rgba` shorthand and reads the channels of a hex literal. */
function readHexChannels(
    value: string
): { r: number; g: number; b: number; a: string | null } | null {
    const digits = value.slice(1);
    const expand = (pair: string) => Number.parseInt(pair, 16);
    if (digits.length === 3 || digits.length === 4) {
        const [r, g, b, a] = [...digits].map((d) => expand(d + d));
        if (r === undefined || g === undefined || b === undefined) {
            return null;
        }
        return { r, g, b, a: a === undefined ? null : (a / 255).toFixed(3) };
    }
    if (digits.length === 6 || digits.length === 8) {
        const r = expand(digits.slice(0, 2));
        const g = expand(digits.slice(2, 4));
        const b = expand(digits.slice(4, 6));
        const a = digits.length === 8 ? (expand(digits.slice(6, 8)) / 255).toFixed(3) : null;
        return { r, g, b, a };
    }
    return null;
}

/**
 * The rgb SOURCE of a stored color: the channel triple a CSS color function
 * needs, plus an alpha the value itself demands.
 *
 * Returns null for anything unresolvable — an unknown palette name, a
 * structurally invalid value, or nothing at all.
 */
function resolveColorSource(
    value: string | null | undefined
): { channels: string; alpha: string | null; swatchAlpha: string | null } | null {
    if (typeof value !== 'string' || !isGridCellColor(value)) {
        return null;
    }
    const name = paletteName(value);
    if (name !== null) {
        if ((OBSIDIAN_COLOR_NAMES as readonly string[]).includes(name)) {
            return { channels: `var(--color-${name}-rgb)`, alpha: null, swatchAlpha: null };
        }
        if ((MONO_COLOR_NAMES as readonly string[]).includes(name)) {
            // A mono channel is pure white in a dark theme and pure black in a
            // light one, so at full strength the SWATCH would read as "white"
            // (or "black") next to a colour the user picked as gray — and it
            // would be the one swatch whose legend does not match the cell it
            // produces. Half strength lands on grey against either background.
            return {
                channels: 'var(--mono-rgb-100)',
                alpha: null,
                swatchAlpha: MONO_SWATCH_ALPHA,
            };
        }
        // A valid but unknown palette name: keep the data, draw nothing.
        return null;
    }
    const hex = readHexChannels(value);
    if (hex === null) {
        return null;
    }
    return { channels: `${hex.r}, ${hex.g}, ${hex.b}`, alpha: hex.a, swatchAlpha: null };
}

/**
 * CSS background for a colored CELL, or null when the value does not resolve.
 *
 * Named colors and opaque hex literals are drawn at the shared tint strength
 * (`--ocap-cell-color-alpha`), so the tool sitting on the cell stays readable
 * and the whole palette can be rebalanced in one CSS line. A hex literal that
 * carries its OWN alpha is honoured literally — the author of that value asked
 * for exactly that opacity.
 */
export function resolveGridCellColorCss(value: string | null | undefined): string | null {
    const source = resolveColorSource(value);
    if (source === null) {
        return null;
    }
    return `rgba(${source.channels}, ${source.alpha ?? CELL_ALPHA_VAR})`;
}

/**
 * CSS fill for a palette SWATCH, or null when the value does not resolve.
 *
 * Full strength: a swatch is a legend, not a cell, and a row of tints at cell
 * opacity would be hard to tell apart in a narrow sidebar. The one exception is
 * a mono-derived colour, which would otherwise be pure white or pure black —
 * see `resolveColorSource`.
 */
export function resolveGridCellSwatchCss(value: string | null | undefined): string | null {
    const source = resolveColorSource(value);
    if (source === null) {
        return null;
    }
    const alpha = source.swatchAlpha ?? source.alpha;
    return alpha === null
        ? `rgb(${source.channels})`
        : `rgba(${source.channels}, ${alpha})`;
}

/** Whether a stored value is one this build can draw. */
export function isRenderableCellColor(value: string | null | undefined): boolean {
    return resolveColorSource(value) !== null;
}
