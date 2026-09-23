// overrides.ts
// What a token override is allowed to be, and what it turns into.
//
// Everything here is pure. The value that ends up in a CSS custom property is
// the one piece of this plugin that comes from a text field the user can type
// anything into, so the decision about what is acceptable is separated from the
// DOM call that applies it and is tested on its own.
//
// The values are NOT restricted to six hex digits. A design token that can only
// be `#334455` cannot express `rgba(255, 255, 255, 0.1)` — which three of the
// eleven v0.1 tokens already are — let alone `color-mix()` or `hsl()`, which is
// where a temperature-based palette wants to go. So the rule is not a colour
// grammar; it is "one CSS declaration value, and nothing that could be a second
// declaration".

import {
    NEXUS_TOKENS,
    nexusToken,
    type ThemeTokenDefinition,
} from '../../../theme/nexus/src/tokens';

/**
 * The longest value accepted.
 *
 * Generous enough for a nested `color-mix()`, short enough that a paste
 * accident is caught here rather than in a settings file.
 */
export const MAX_VALUE_LENGTH = 200;

/**
 * Characters that would end the declaration, open a block, or start a comment.
 *
 * Values are applied through `style.setProperty`, which is not string
 * concatenation into a stylesheet, so none of these can escape into a new rule
 * today. They are refused anyway: the check has to stay correct for whatever
 * applies these values tomorrow, and a value containing `}` is a typo in every
 * case where it is not an attack.
 */
const FORBIDDEN = /[;{}<>]|\/\*|\*\//;

/**
 * Whether the value is a single line of printable text.
 *
 * Written as a scan rather than as a regular expression because a character
 * class of control characters is itself a lint error, and a value containing a
 * newline is the interesting case: it is how a paste of two declarations
 * arrives.
 */
function hasControlCharacter(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code < 0x20 || code === 0x7f) return true;
    }
    return false;
}

/**
 * Functions that fetch or execute rather than describe a colour.
 *
 * `url()` in a colour token is never meaningful and is how a custom property
 * turns into a network request if some other rule ever spends it in the wrong
 * place. `expression()` is the same argument with more history.
 */
const FORBIDDEN_FUNCTIONS = /\b(url|expression|image-set|-moz-binding)\s*\(/i;

/**
 * Whether a value may be stored and applied.
 *
 * Deliberately not "is this a valid CSS colour": the browser already answers
 * that, by ignoring a declaration it cannot parse, and a stricter answer here
 * would mean this file has to learn every colour function CSS grows. What it
 * decides is narrower and stays true: this is one line, it is short, and it
 * cannot be anything other than a value.
 */
export function isValidTokenValue(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.length > MAX_VALUE_LENGTH) return false;
    if (hasControlCharacter(trimmed)) return false;
    if (FORBIDDEN.test(trimmed)) return false;
    if (FORBIDDEN_FUNCTIONS.test(trimmed)) return false;
    // Unbalanced brackets are a truncated paste, not a value.
    let depth = 0;
    for (const character of trimmed) {
        if (character === '(') depth += 1;
        if (character === ')') depth -= 1;
        if (depth < 0) return false;
    }
    return depth === 0;
}

/**
 * CSS functions a length or number may be written as, and that this file does
 * not try to evaluate. `calc(13px * 1.1)` is a length; so is `var(--x)`. The
 * browser decides the rest; this only refuses what can never be one.
 */
const COMPUTED_VALUE = /^(calc|clamp|min|max|var)\(/i;

/**
 * The bounds a plain value must fall in to be stored.
 *
 * Wider than the slider on purpose — the raw field exists for values the slider
 * does not offer — but not unbounded. A 2px interface cannot be used to set it
 * back, and the studio's own text does not shrink with it (it has its own
 * palette), so this is the one place a nonsensical size can be stopped.
 */
const LENGTH_BOUNDS: Record<string, [number, number]> = {
    px: [6, 48],
    em: [0.4, 3],
    rem: [0.4, 3],
};
const NUMBER_BOUNDS: [number, number] = [0.8, 3];

/**
 * Whether a value may be stored for THIS token.
 *
 * The general rule (`isValidTokenValue`) keeps anything that could become a
 * second declaration out. This adds what the token's kind requires, because
 * the kinds fail differently: a colour that is not a colour is ignored by the
 * one property that spends it, but a font size that is not a length makes every
 * interface text size derived from it invalid at once.
 */
export function isValidValueFor(token: ThemeTokenDefinition, value: unknown): value is string {
    if (!isValidTokenValue(value)) return false;
    const text = value.trim();
    switch (token.controlType) {
        case 'color':
        case 'font-family':
            return true;
        case 'length': {
            if (COMPUTED_VALUE.test(text)) return true;
            const match = /^(\d*\.?\d+)(px|em|rem)$/i.exec(text);
            if (!match) return false;
            const bounds = LENGTH_BOUNDS[(match[2] ?? '').toLowerCase()];
            const amount = Number(match[1]);
            return !!bounds && amount >= bounds[0] && amount <= bounds[1];
        }
        case 'number': {
            if (COMPUTED_VALUE.test(text)) return true;
            if (!/^\d*\.?\d+$/.test(text)) return false;
            const amount = Number(text);
            return amount >= NUMBER_BOUNDS[0] && amount <= NUMBER_BOUNDS[1];
        }
    }
}

/** A stored profile's overrides: token key to CSS value. */
export type TokenOverrides = Record<string, string>;

/**
 * Reads an overrides map that came off disk.
 *
 * Both halves of the filter matter and neither is redundant. An UNKNOWN KEY is
 * dropped because a token that no longer exists must not keep haunting a
 * profile; an INVALID VALUE is dropped because `loadData` returns whatever is
 * in the file, including whatever a hand-edit left behind. A bad entry never
 * fails the load — the token simply falls back to the theme's own value, which
 * is the only fallback that cannot surprise anyone.
 */
export function sanitizeOverrides(raw: unknown): TokenOverrides {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result: TokenOverrides = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const token = nexusToken(key);
        if (!token) continue;
        if (!isValidValueFor(token, value)) continue;
        result[key] = value.trim();
    }
    return result;
}

/**
 * The declarations one profile implies, as `[cssVariable, value]` pairs.
 *
 * Only overridden tokens appear. A token the profile says nothing about is
 * ABSENT rather than present with its default: applying the default explicitly
 * would pin the token to the value the theme happened to have when the profile
 * was written, and a later theme update would be silently overridden by every
 * profile ever saved.
 */
export function overrideDeclarations(overrides: TokenOverrides): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    for (const token of NEXUS_TOKENS) {
        const value = overrides[token.key];
        if (value === undefined) continue;
        if (!isValidValueFor(token, value)) continue;
        pairs.push([token.cssVariable, value.trim()]);
    }
    return pairs;
}

/** What a token is currently worth under a profile: its override, or the theme's value. */
export function effectiveValue(overrides: TokenOverrides, key: string): string {
    const token = nexusToken(key);
    if (!token) return '';
    const override = overrides[key];
    return isValidValueFor(token, override) ? override.trim() : token.defaultValue;
}

/** Whether a profile says anything of its own about a token. */
export function isOverridden(overrides: TokenOverrides, key: string): boolean {
    const token = nexusToken(key);
    return !!token && isValidValueFor(token, overrides[key]);
}

/**
 * The colour the locator paints a token with while the pointer rests on its row.
 *
 * Magenta because nothing in the Nexus palette is anywhere near it: every
 * default is a grey, and a grey going magenta is unmistakable at a glance and
 * in peripheral vision, which is what "where is this token?" actually needs.
 * Fully opaque, so a one-pixel splitter line is as visible as a whole dock.
 */
export const LOCATOR_COLOR = '#ff00ff';

/**
 * The declarations to apply while a locator preview is showing.
 *
 * The preview is composed ON TOP of the profile's real declarations rather than
 * replacing them, so everything the user is not asking about keeps its colour
 * and only the token in question changes. Composed here, as a pure function, so
 * that "the preview never touches stored state" is a property of the data flow
 * and not a promise made in a comment: this takes overrides and returns
 * declarations, and there is no path from here to a file.
 *
 * Painting the TOKEN rather than a list of selectors is the whole trick. Every
 * rule that spends this variable lights up, wherever it is and whether or not
 * anybody remembered it existed — including rules inside the reader's iframe,
 * which get it through the bridge like any other value. A second list of
 * selectors would have been a second thing to keep true.
 */
export function withPreview(
    declarations: ReadonlyArray<readonly [string, string]>,
    previewVariables: readonly string[],
    color: string = LOCATOR_COLOR
): Array<[string, string]> {
    if (previewVariables.length === 0) {
        return declarations.map(([name, value]) => [name, value]);
    }
    const previewed = new Set(previewVariables);
    const result: Array<[string, string]> = [];
    for (const [name, value] of declarations) {
        if (previewed.has(name)) continue;
        result.push([name, value]);
    }
    for (const name of previewVariables) result.push([name, color]);
    return result;
}
