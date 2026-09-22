// Tests for the one place a Nexus token crosses into the reader's iframe.
//
// The property under test throughout is FAIL-SOFT. The reader companion has to
// work when the Nexus theme is active, when it is not, when it is installed but
// unselected, and when the Theme Studio is not installed at all — and the
// design's claim is that only ONE of those is a code path, because CSS's own
// `var(x, fallback)` handles the rest. These tests hold that claim.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    NEXUS_TOKENS,
    NEXUS_TOKENS_CHANGED_EVENT,
    NEXUS_VARIABLES,
    nexusToken,
} from '../theme/nexus/src/tokens';
import {
    BRIDGED_KEYS,
    BRIDGED_VARIABLES,
    clearNexusTokens,
    nexusVariable,
    presentTokens,
    readHostTokens,
    syncNexusTokens,
} from '../companion/zotflow-reader-extensions/src/nexusBridge';
import { surfaceStylesheet } from '../companion/zotflow-reader-extensions/src/sidebarSide';

const PANEL = nexusVariable('readerPanelSurface');
const DOCUMENT = nexusVariable('documentSurface');

/** The smallest thing that answers like a reader document's root element. */
function fakeReaderDocument(): Document & { readonly properties: Map<string, string> } {
    const properties = new Map<string, string>();
    return {
        properties,
        documentElement: {
            style: {
                setProperty: (name: string, value: string | null) => {
                    properties.set(name, value ?? '');
                },
                removeProperty: (name: string) => {
                    properties.delete(name);
                },
            },
        },
    } as unknown as Document & { readonly properties: Map<string, string> };
}

/** A host whose computed style answers exactly what it is told to. */
function fakeHost(values: Record<string, string>): { body: HTMLElement; win: Window } {
    const body = {} as HTMLElement;
    const win = {
        getComputedStyle: () => ({
            getPropertyValue: (name: string) => values[name] ?? '',
        }),
    } as unknown as Window;
    return { body, win };
}

describe('the bridge names tokens the theme actually has', () => {
    it('resolves every bridged key through the token table', () => {
        expect(BRIDGED_VARIABLES).toHaveLength(BRIDGED_KEYS.length);
        for (const variable of BRIDGED_VARIABLES) {
            expect(NEXUS_VARIABLES).toContain(variable);
        }
    });

    it('carries the two surfaces the reader actually paints', () => {
        expect(BRIDGED_KEYS).toContain('readerPanelSurface');
        expect(BRIDGED_KEYS).toContain('documentSurface');
    });

    // A miss means the token table and a consumer have gone out of step, and a
    // stylesheet referencing `var(undefined)` is a bug that surfaces weeks
    // later as a colour nobody can explain.
    it('refuses to resolve a key the table does not have', () => {
        expect(() => nexusVariable('notAToken')).toThrow();
        expect(nexusVariable(NEXUS_TOKENS[0]!.key)).toBe(NEXUS_TOKENS[0]!.cssVariable);
    });
});

describe('a token that says nothing stays absent', () => {
    // `getPropertyValue` answers with an empty string for an undeclared
    // property. Writing that through would DEFINE the property as empty, and an
    // empty `var()` is not a missing one: the fallback would stop being used
    // and the reader would lose its own colour.
    it.each([
        ['an empty string', ''],
        ['whitespace', '   '],
        ['null', null],
        ['undefined', undefined],
    ])('drops %s', (_label, value) => {
        expect(presentTokens({ [PANEL]: value })).toEqual({});
    });

    it('keeps a real value, trimmed', () => {
        expect(presentTokens({ [PANEL]: '  #232323 ' })).toEqual({ [PANEL]: '#232323' });
    });

    it('drops anything that is not a string at all', () => {
        expect(presentTokens({ [PANEL]: 3 as unknown as string })).toEqual({});
    });
});

describe('what the host currently computes', () => {
    it('reads exactly the bridged variables', () => {
        const { body, win } = fakeHost({ [PANEL]: '#232323', [DOCUMENT]: '#1c1c1c' });
        expect(readHostTokens(body, win)).toEqual({ [PANEL]: '#232323', [DOCUMENT]: '#1c1c1c' });
    });

    // The whole "Nexus is not active" case, and it is not a branch: there is
    // simply nothing to read, so nothing is written.
    it('answers with nothing when the theme is not painting', () => {
        const { body, win } = fakeHost({});
        expect(readHostTokens(body, win)).toEqual({});
    });

    // Whatever combination of theme, profile and override produced the value on
    // screen, this reads the result. That is what keeps the companion out of
    // the palette business.
    it('reads the overridden value, not a stored one', () => {
        const { body, win } = fakeHost({ [PANEL]: '#405060' });
        expect(readHostTokens(body, win)[PANEL]).toBe('#405060');
    });
});

describe('mirroring into a reader document', () => {
    it('writes the present tokens onto the reader root', () => {
        const doc = fakeReaderDocument();
        syncNexusTokens(doc, { [PANEL]: '#232323' });
        expect(doc.properties.get(PANEL)).toBe('#232323');
    });

    // Without this, turning an override off in the editor would leave the last
    // value frozen in every reader that happened to be open at the time.
    it('removes a token that has stopped being present', () => {
        const doc = fakeReaderDocument();
        syncNexusTokens(doc, { [PANEL]: '#232323', [DOCUMENT]: '#1c1c1c' });
        syncNexusTokens(doc, { [DOCUMENT]: '#1c1c1c' });
        expect(doc.properties.has(PANEL)).toBe(false);
        expect(doc.properties.get(DOCUMENT)).toBe('#1c1c1c');
    });

    it('writes nothing at all when the host has nothing to say', () => {
        const doc = fakeReaderDocument();
        syncNexusTokens(doc, {});
        expect(doc.properties.size).toBe(0);
    });

    it('is idempotent, so a layout change costs nothing', () => {
        const doc = fakeReaderDocument();
        syncNexusTokens(doc, { [PANEL]: '#232323' });
        const once = new Map(doc.properties);
        syncNexusTokens(doc, { [PANEL]: '#232323' });
        syncNexusTokens(doc, { [PANEL]: '#232323' });
        expect(doc.properties).toEqual(once);
    });

    // Several PDFs open at once is the normal case, not the exotic one.
    it('gives every open reader the same values', () => {
        const readers = [fakeReaderDocument(), fakeReaderDocument(), fakeReaderDocument()];
        for (const doc of readers) syncNexusTokens(doc, { [PANEL]: '#2a2a2a' });
        for (const doc of readers) expect(doc.properties.get(PANEL)).toBe('#2a2a2a');
    });

    // A reader iframe is rebuilt when its tab is brought forward after being
    // hidden. The rebuilt document is a NEW document with none of our
    // properties, and it has to be given them again.
    it('re-paints a reader that was rebuilt from scratch', () => {
        const values = { [PANEL]: '#2a2a2a' };
        const first = fakeReaderDocument();
        syncNexusTokens(first, values);
        const remounted = fakeReaderDocument();
        expect(remounted.properties.size).toBe(0);
        syncNexusTokens(remounted, values);
        expect(remounted.properties.get(PANEL)).toBe('#2a2a2a');
    });

    // Every Nexus variable, not just the bridged ones: a build that once
    // mirrored more of them must not leave a stale property for a later build
    // to inherit.
    it('takes every Nexus variable back out when the plugin unloads', () => {
        const doc = fakeReaderDocument();
        // Seeded through the fake's own map rather than through the element, so
        // the test can plant variables this build no longer mirrors.
        for (const variable of NEXUS_VARIABLES) doc.properties.set(variable, 'anything');
        clearNexusTokens(doc);
        expect(doc.properties.size).toBe(0);
    });

    it('survives a document with no root element rather than throwing', () => {
        const empty = {} as Document;
        expect(() => syncNexusTokens(empty, { [PANEL]: '#fff' })).not.toThrow();
        expect(() => clearNexusTokens(empty)).not.toThrow();
    });
});

describe('the injected stylesheet falls back instead of branching', () => {
    const css = surfaceStylesheet();

    it('asks for the Nexus token first', () => {
        expect(css).toContain(`var(\n    ${PANEL},`);
        expect(css).toContain(`var(${DOCUMENT},`);
    });

    // The failing case cannot rot: it is exercised by every reader opened
    // without the theme.
    it('falls back to the reader\'s own tokens, so no theme is not no colour', () => {
        expect(css).toContain('var(--material-background)');
        expect(css).toContain('var(--material-sidepane)');
        expect(css).toContain('color-mix(in srgb, var(--material-background) 40%');
    });

    it('hardcodes no colour of its own', () => {
        expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(css).not.toMatch(/\brgba?\(/);
    });

    it('spends no Nexus variable the token table does not have', () => {
        const used = [...css.matchAll(/(--nexus-[a-z0-9-]+)/g)].map((match) => match[1]);
        expect(used.length).toBeGreaterThan(0);
        for (const variable of used) expect(NEXUS_VARIABLES).toContain(variable);
    });

    // The same trap as the side flip: the reader ships a class-based and an
    // id-based split view, and only the id-based one carries the document.
    it('paints BOTH split views, not just the class-based one', () => {
        expect(css).toContain('#split-view');
        expect(css).toContain('.split-view');
    });

    it('is stable, so re-applying it changes nothing', () => {
        expect(surfaceStylesheet()).toBe(css);
    });
});

describe('an open reader follows a colour change immediately', () => {
    const main = readFileSync('companion/zotflow-reader-extensions/src/main.ts', 'utf8');

    // Not a shared object and not a plugin lookup: the sender does not need
    // this plugin to exist, this plugin does not need the sender to exist, and
    // neither ever holds a reference to the other.
    it('listens for the theme event on the host window', () => {
        expect(main).toContain('registerDomEvent');
        expect(main).toContain('NEXUS_TOKENS_CHANGED_EVENT');
        expect(main).toContain('syncTokens()');
    });

    it('re-mirrors into every reader it already knows about', () => {
        const syncTokens = main.slice(main.indexOf('private syncTokens()'));
        expect(syncTokens).toContain('readHostTokens');
        expect(syncTokens).toContain('this.bindings.keys()');
        expect(syncTokens).toContain('syncNexusTokens');
    });

    // A reader that is not bound yet is covered by the ordinary sync path, and
    // must be given the tokens before it is bound so it is never painted for a
    // frame with values from last time.
    it('also mirrors when a reader is first patched', () => {
        const syncLeaf = main.slice(main.indexOf('private syncLeaf('));
        expect(syncLeaf).toContain('syncNexusTokens(doc, this.hostTokens)');
    });

    it('takes the mirrored tokens off again when the patch is undone', () => {
        const patch = readFileSync(
            'companion/zotflow-reader-extensions/src/sidebarPatch.ts',
            'utf8'
        );
        const remove = patch.slice(patch.indexOf('export function removePatch'));
        expect(remove).toContain('clearNexusTokens');
    });

    // The companion must not become a second palette. It reads values; it never
    // writes one down.
    it('keeps no colour of its own anywhere in the companion source', () => {
        for (const file of ['main.ts', 'nexusBridge.ts', 'sidebarSide.ts', 'sidebarPatch.ts']) {
            const source = readFileSync(
                `companion/zotflow-reader-extensions/src/${file}`,
                'utf8'
            );
            const rules = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
            expect(rules).not.toMatch(/#[0-9a-f]{6}\b/i);
        }
    });

    it('names its tokens through the table rather than spelling them out', () => {
        const side = readFileSync(
            'companion/zotflow-reader-extensions/src/sidebarSide.ts',
            'utf8'
        );
        expect(side).toContain('nexusVariable(');
        for (const token of NEXUS_TOKENS) {
            expect(side.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain(token.cssVariable);
        }
    });

    it('resolves the tokens it spends to real ones', () => {
        expect(nexusToken('readerPanelSurface')).not.toBeNull();
        expect(nexusToken('documentSurface')).not.toBeNull();
    });
});

describe('the seam between theme and editor', () => {
    // A sender and a receiver that each keep their own copy of an event name is
    // the classic way for a rename to go quiet instead of failing.
    it('declares the change event once, where both sides can see it', () => {
        expect(NEXUS_TOKENS_CHANGED_EVENT).toBe('nexus-theme-tokens-changed');
        const studio = readFileSync('companion/nexus-theme-studio/src/main.ts', 'utf8');
        const reader = readFileSync(
            'companion/zotflow-reader-extensions/src/main.ts',
            'utf8'
        );
        for (const source of [studio, reader]) {
            expect(source).toContain('NEXUS_TOKENS_CHANGED_EVENT');
            expect(source).not.toContain("'nexus-theme-tokens-changed'");
        }
    });
});
