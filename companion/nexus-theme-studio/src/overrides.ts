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

import { NEXUS_TOKENS, nexusToken } from '../../../theme/nexus/src/tokens';

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
        if (!nexusToken(key)) continue;
        if (!isValidTokenValue(value)) continue;
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
        if (!isValidTokenValue(value)) continue;
        pairs.push([token.cssVariable, value.trim()]);
    }
    return pairs;
}

/** What a token is currently worth under a profile: its override, or the theme's value. */
export function effectiveValue(overrides: TokenOverrides, key: string): string {
    const token = nexusToken(key);
    if (!token) return '';
    const override = overrides[key];
    return isValidTokenValue(override) ? override.trim() : token.defaultValue;
}

/** Whether a profile says anything of its own about a token. */
export function isOverridden(overrides: TokenOverrides, key: string): boolean {
    return isValidTokenValue(overrides[key]);
}
