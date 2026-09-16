/**
 * Static parser for script metadata.
 *
 * User scripts export metadata via a CommonJS object literal:
 *
 *   module.exports = {
 *       entry: main,
 *       name: { zh: '...', en: '...', ru: '...' } | '...',
 *       description: { ... } | '...',
 *       tags: ['file', 'batch'],
 *   };
 *
 * This module extracts that metadata by scanning the source text only. It
 * NEVER executes script code (no eval, no Function/AsyncFunction constructor).
 * Values that cannot be determined statically (identifier references,
 * function expressions, calls, template interpolation, spreads, ...) are
 * skipped in a controlled way instead of being evaluated.
 *
 * Supported static values:
 * - string literals ('...', "...", and `...` without interpolation)
 * - object literals whose property values are static
 * - array literals whose items are static
 * - number / boolean / null literals
 *
 * The parser looks at the LAST `module.exports = { ... }` assignment found
 * outside strings and comments (matching last-write-wins runtime semantics).
 * Malformed input never throws; it yields `null`.
 */

/** Marker for property values that exist but cannot be resolved statically. */
export const NON_STATIC = Symbol('non-static');

/** A statically resolved JS literal value. */
export type StaticValue =
    | string
    | number
    | boolean
    | null
    | StaticValue[]
    | { [key: string]: StaticValue }
    | typeof NON_STATIC;

/** Statically extracted script metadata (display data only, no entry function). */
export interface ParsedScriptMeta {
    /** true when the exports object literal declares an `entry` property. */
    hasEntry: boolean;
    name?: string | Record<string, string>;
    description?: string | Record<string, string>;
    tags?: string[];
}

class ParseError extends Error {}

interface Cursor {
    src: string;
    i: number;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

function isEof(c: Cursor): boolean {
    return c.i >= c.src.length;
}

function peek(c: Cursor): string {
    return c.src[c.i] ?? '';
}

/** Skips whitespace and line/block comments. */
function skipTrivia(c: Cursor): void {
    while (!isEof(c)) {
        const ch = peek(c);
        if (/\s/.test(ch)) {
            c.i++;
            continue;
        }
        if (ch === '/' && c.src[c.i + 1] === '/') {
            while (!isEof(c) && peek(c) !== '\n') c.i++;
            continue;
        }
        if (ch === '/' && c.src[c.i + 1] === '*') {
            const end = c.src.indexOf('*/', c.i + 2);
            if (end < 0) throw new ParseError('unterminated block comment');
            c.i = end + 2;
            continue;
        }
        return;
    }
}

/** Decodes one escape sequence; cursor is on the backslash. */
function readEscape(c: Cursor): string {
    c.i++; // consume backslash
    if (isEof(c)) throw new ParseError('unterminated escape');
    const ch = peek(c);
    c.i++;
    switch (ch) {
        case 'n':
            return '\n';
        case 't':
            return '\t';
        case 'r':
            return '\r';
        case 'b':
            return '\b';
        case 'f':
            return '\f';
        case 'v':
            return '\v';
        case '0':
            return '\0';
        case 'x': {
            const hex = c.src.slice(c.i, c.i + 2);
            if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new ParseError('bad \\x escape');
            c.i += 2;
            return String.fromCharCode(parseInt(hex, 16));
        }
        case 'u': {
            if (peek(c) === '{') {
                const end = c.src.indexOf('}', c.i + 1);
                if (end < 0) throw new ParseError('bad \\u{} escape');
                const hex = c.src.slice(c.i + 1, end);
                if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) throw new ParseError('bad \\u{} escape');
                c.i = end + 1;
                return String.fromCodePoint(parseInt(hex, 16));
            }
            const hex = c.src.slice(c.i, c.i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new ParseError('bad \\u escape');
            c.i += 4;
            return String.fromCharCode(parseInt(hex, 16));
        }
        case '\n':
            return ''; // line continuation
        case '\r':
            if (peek(c) === '\n') c.i++;
            return '';
        default:
            return ch;
    }
}

/** Reads a '...' or "..." string literal; cursor is on the opening quote. */
function readStringLiteral(c: Cursor): string {
    const quote = peek(c);
    c.i++;
    let value = '';
    while (!isEof(c)) {
        const ch = peek(c);
        if (ch === quote) {
            c.i++;
            return value;
        }
        if (ch === '\\') {
            value += readEscape(c);
            continue;
        }
        if (ch === '\n' || ch === '\r') throw new ParseError('unterminated string');
        value += ch;
        c.i++;
    }
    throw new ParseError('unterminated string');
}

/**
 * Reads a template literal; cursor is on the backtick.
 * Returns the string value, or NON_STATIC when it contains interpolation
 * (the whole template is still consumed).
 */
function readTemplateLiteral(c: Cursor): string | typeof NON_STATIC {
    c.i++; // consume backtick
    let value = '';
    let nonStatic = false;
    while (!isEof(c)) {
        const ch = peek(c);
        if (ch === '`') {
            c.i++;
            return nonStatic ? NON_STATIC : value;
        }
        if (ch === '\\') {
            value += readEscape(c);
            continue;
        }
        if (ch === '$' && c.src[c.i + 1] === '{') {
            nonStatic = true;
            c.i += 2;
            skipUntilBalanced(c, '}');
            c.i++; // consume closing brace
            continue;
        }
        value += ch;
        c.i++;
    }
    throw new ParseError('unterminated template literal');
}

/** Skips a regex literal; cursor is on the opening slash. */
function skipRegexLiteral(c: Cursor): void {
    c.i++;
    let inClass = false;
    while (!isEof(c)) {
        const ch = peek(c);
        if (ch === '\\') {
            c.i += 2;
            continue;
        }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) {
            c.i++;
            // skip flags
            while (!isEof(c) && IDENT_PART.test(peek(c))) c.i++;
            return;
        }
        if (ch === '\n') throw new ParseError('unterminated regex');
        c.i++;
    }
    throw new ParseError('unterminated regex');
}

/** True when a '/' at the current position starts a regex (heuristic). */
function slashStartsRegex(c: Cursor): boolean {
    for (let j = c.i - 1; j >= 0; j--) {
        const ch = c.src[j] ?? '';
        if (/\s/.test(ch)) continue;
        // After an identifier/number/closing bracket a slash is division.
        return !(IDENT_PART.test(ch) || ch === ')' || ch === ']' || ch === '.');
    }
    return true;
}

/**
 * Skips arbitrary expression text until one of the `stopChars` appears at the
 * current nesting level. Handles strings, template literals, comments, regex
 * literals and (), [], {} nesting. The stop character is NOT consumed.
 */
function skipUntilBalanced(c: Cursor, stopChars: string): void {
    let depth = 0;
    while (!isEof(c)) {
        const ch = peek(c);
        if (depth === 0 && stopChars.includes(ch)) return;
        // A ';' at expression depth 0 is never valid inside an object/array
        // literal or interpolation: treat the literal as malformed.
        if (depth === 0 && ch === ';') throw new ParseError('unexpected ;');
        if (ch === '/' && (c.src[c.i + 1] === '/' || c.src[c.i + 1] === '*')) {
            skipTrivia(c);
            continue;
        }
        if (ch === "'" || ch === '"') {
            readStringLiteral(c);
            continue;
        }
        if (ch === '`') {
            readTemplateLiteral(c);
            continue;
        }
        if (ch === '/' && slashStartsRegex(c)) {
            skipRegexLiteral(c);
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') {
            if (depth === 0) throw new ParseError('unbalanced brackets');
            depth--;
        }
        c.i++;
    }
    throw new ParseError('unexpected end of input');
}

/**
 * Parses one property value. `terminators` are the characters that may
 * legally follow the value at this nesting level (e.g. ',}' inside an
 * object). Returns NON_STATIC (after consuming the whole expression) when
 * the value is not a plain static literal.
 */
function parseValue(c: Cursor, terminators: string): StaticValue {
    skipTrivia(c);
    const start = c.i;
    let value: StaticValue = NON_STATIC;
    let parsed = false;

    const ch = peek(c);
    if (ch === "'" || ch === '"') {
        value = readStringLiteral(c);
        parsed = true;
    } else if (ch === '`') {
        value = readTemplateLiteral(c);
        parsed = true;
    } else if (ch === '{') {
        value = parseObjectLiteral(c);
        parsed = true;
    } else if (ch === '[') {
        value = parseArrayLiteral(c);
        parsed = true;
    } else if (IDENT_START.test(ch)) {
        let word = '';
        while (!isEof(c) && IDENT_PART.test(peek(c))) {
            word += peek(c);
            c.i++;
        }
        if (word === 'true') {
            value = true;
            parsed = true;
        } else if (word === 'false') {
            value = false;
            parsed = true;
        } else if (word === 'null') {
            value = null;
            parsed = true;
        }
        // other identifiers: non-static reference
    } else if (/[0-9]/.test(ch) || ((ch === '-' || ch === '+') && /[0-9.]/.test(c.src[c.i + 1] ?? ''))) {
        const rest = c.src.slice(c.i);
        const m = /^[+-]?(?:0[xXbBoO][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(rest);
        if (m) {
            value = Number(m[0]);
            parsed = true;
            c.i += m[0].length;
        }
    }

    // The literal must be directly followed by a terminator, otherwise it is
    // part of a larger expression ('a' + b, main(), obj.prop, ...) and the
    // whole expression is treated as non-static.
    skipTrivia(c);
    if (!parsed || !terminators.includes(peek(c))) {
        c.i = start;
        skipUntilBalanced(c, terminators);
        return NON_STATIC;
    }
    return value;
}

/** Parses an object literal; cursor is on '{'. Later keys overwrite earlier ones. */
function parseObjectLiteral(c: Cursor): { [key: string]: StaticValue } {
    c.i++; // consume '{'
    const result: { [key: string]: StaticValue } = {};
    for (;;) {
        skipTrivia(c);
        if (isEof(c)) throw new ParseError('unterminated object literal');
        if (peek(c) === '}') {
            c.i++;
            return result;
        }

        let key: string | null = null;
        const ch = peek(c);
        if (ch === "'" || ch === '"') {
            key = readStringLiteral(c);
        } else if (IDENT_START.test(ch)) {
            key = '';
            while (!isEof(c) && IDENT_PART.test(peek(c))) {
                key += peek(c);
                c.i++;
            }
        } else if (/[0-9]/.test(ch)) {
            key = '';
            while (!isEof(c) && /[0-9.]/.test(peek(c))) {
                key += peek(c);
                c.i++;
            }
        } else {
            // computed key, spread, or anything else: skip the whole member
            skipUntilBalanced(c, ',}');
        }

        if (key !== null) {
            skipTrivia(c);
            const next = peek(c);
            if (next === ':') {
                c.i++;
                const value = parseValue(c, ',}');
                result[key] = value;
            } else if (next === ',' || next === '}') {
                // shorthand property ({ entry }): present but non-static
                result[key] = NON_STATIC;
            } else {
                // method shorthand, getter/setter argument lists, etc.
                result[key] = NON_STATIC;
                skipUntilBalanced(c, ',}');
            }
        }

        skipTrivia(c);
        if (peek(c) === ',') {
            c.i++;
            continue;
        }
        if (peek(c) === '}') {
            c.i++;
            return result;
        }
        throw new ParseError('malformed object literal');
    }
}

/** Parses an array literal; cursor is on '['. */
function parseArrayLiteral(c: Cursor): StaticValue[] {
    c.i++; // consume '['
    const result: StaticValue[] = [];
    for (;;) {
        skipTrivia(c);
        if (isEof(c)) throw new ParseError('unterminated array literal');
        if (peek(c) === ']') {
            c.i++;
            return result;
        }
        result.push(parseValue(c, ',]'));
        skipTrivia(c);
        if (peek(c) === ',') {
            c.i++;
            continue;
        }
        if (peek(c) === ']') {
            c.i++;
            return result;
        }
        throw new ParseError('malformed array literal');
    }
}

/**
 * Finds the end position of the last `module.exports =` assignment that is
 * outside strings and comments. Returns -1 when none exists.
 */
function findLastExportsAssignment(source: string): number {
    const c: Cursor = { src: source, i: 0 };
    const assignRe = /module\s*\.\s*exports\s*=(?!=)/y;
    let lastEnd = -1;
    while (!isEof(c)) {
        const ch = peek(c);
        try {
            if (ch === '/' && (source[c.i + 1] === '/' || source[c.i + 1] === '*')) {
                skipTrivia(c);
                continue;
            }
            if (ch === "'" || ch === '"') {
                readStringLiteral(c);
                continue;
            }
            if (ch === '`') {
                readTemplateLiteral(c);
                continue;
            }
        } catch {
            // Unterminated string/comment: stop scanning at this point.
            return lastEnd;
        }
        if (IDENT_START.test(ch)) {
            const prev = source[c.i - 1] ?? '';
            if (!IDENT_PART.test(prev) && prev !== '.') {
                assignRe.lastIndex = c.i;
                const m = assignRe.exec(source);
                if (m) {
                    lastEnd = c.i + m[0].length;
                    c.i = lastEnd;
                    continue;
                }
            }
            // skip the whole identifier
            while (!isEof(c) && IDENT_PART.test(peek(c))) c.i++;
            continue;
        }
        c.i++;
    }
    return lastEnd;
}

/** Converts a parsed object value into `string | Record<string, string>`. */
function toLocalizableText(value: StaticValue | undefined): string | Record<string, string> | undefined {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const entries = Object.entries(value).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
        );
        if (entries.length > 0) return Object.fromEntries(entries);
    }
    return undefined;
}

/**
 * Statically extracts script metadata from source text without executing it.
 * Returns null when no analyzable `module.exports = { ... }` assignment
 * exists or the literal is malformed.
 */
export function parseScriptMeta(source: string): ParsedScriptMeta | null {
    const assignEnd = findLastExportsAssignment(source);
    if (assignEnd < 0) return null;

    try {
        const c: Cursor = { src: source, i: assignEnd };
        skipTrivia(c);
        if (peek(c) !== '{') {
            // Not an object literal (identifier, call, ...): not statically analyzable.
            return null;
        }
        const exportsObject = parseObjectLiteral(c);

        const tagsValue = exportsObject['tags'];
        return {
            hasEntry: Object.prototype.hasOwnProperty.call(exportsObject, 'entry'),
            name: toLocalizableText(exportsObject['name']),
            description: toLocalizableText(exportsObject['description']),
            tags: Array.isArray(tagsValue)
                ? tagsValue.filter((tag): tag is string => typeof tag === 'string')
                : undefined,
        };
    } catch {
        return null;
    }
}
