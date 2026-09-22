// Tests for the companion plugin's decisions: what the stylesheet must say,
// how the right-hand drag computes a width, and how stored settings are read.
//
// These are the parts that can be wrong in a way no screenshot reveals. The
// parts that can only be judged against the real reader — that the sidebar
// actually moves, that the PDF actually reflows — are covered by the CDP smoke
// script, which drives a live ZotFlow reader in the disposable vault. Together
// they cover the behaviour; neither alone would.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { OWN, SELECTORS, missingParts, probeReader, readerInstance } from '../companion/zotflow-reader-extensions/src/readerContract';
import { closestFrom } from '../companion/zotflow-reader-extensions/src/sidebarPatch';
import {
    DEFAULT_SETTINGS,
    DEFAULT_SIDE,
    OVERLAY_BREAKPOINT_PX,
    OVERLAY_WIDTH,
    SIDEBAR_MAX_FRACTION,
    SIDEBAR_MIN_WIDTH,
    normalizeSettings,
    rightSidebarWidth,
    sidebarStylesheet,
} from '../companion/zotflow-reader-extensions/src/sidebarSide';

describe('the default is the reader\'s own behaviour', () => {
    it('defaults to left', () => {
        expect(DEFAULT_SIDE).toBe('left');
        expect(DEFAULT_SETTINGS.sidebarSide).toBe('left');
    });

    it('reads a stored right back', () => {
        expect(normalizeSettings({ sidebarSide: 'right' }).sidebarSide).toBe('right');
    });

    it('reads a stored left back', () => {
        expect(normalizeSettings({ sidebarSide: 'left' }).sidebarSide).toBe('left');
    });

    // First run, a hand-edited file, a half-written file: all of these reach
    // loadData, and none of them may leave the reader in a state the user
    // cannot explain.
    it.each([
        ['null (first run)', null],
        ['undefined', undefined],
        ['an empty object', {}],
        ['a string', 'right'],
        ['a number', 3],
        ['an unknown side', { sidebarSide: 'top' }],
        ['a non-string side', { sidebarSide: 1 }],
    ])('falls back to left for %s', (_label, raw) => {
        expect(normalizeSettings(raw).sidebarSide).toBe('left');
    });

    it('does not hand back the caller\'s object to be mutated later', () => {
        const stored = { sidebarSide: 'right' as const };
        const settings = normalizeSettings(stored);
        settings.sidebarSide = 'left';
        expect(stored.sidebarSide).toBe('right');
    });
});

describe('the right-hand resize maths', () => {
    // The reader measures from the left edge, which is correct for a left
    // sidebar and inverted for a right one. Measured against the live reader:
    // in a 980px viewport, dropping at x=300 gave a 300px sidebar where a
    // right-docked sidebar should be 680px.
    it('measures from the right edge', () => {
        expect(rightSidebarWidth(980, 680)).toBe(300);
        expect(rightSidebarWidth(980, 600)).toBe(380);
        expect(rightSidebarWidth(980, 760)).toBe(220);
        expect(rightSidebarWidth(980, 540)).toBe(440);
    });

    it('is the mirror image of the reader\'s own left-edge maths', () => {
        for (const x of [200, 350, 500, 700]) {
            expect(rightSidebarWidth(980, x)).toBe(
                Math.min(490, Math.max(SIDEBAR_MIN_WIDTH, 980 - x))
            );
        }
    });

    it('clamps to half the viewport', () => {
        expect(rightSidebarWidth(980, 100)).toBe(490);
        expect(rightSidebarWidth(1000, 0)).toBe(500);
        expect(rightSidebarWidth(980, -50)).toBe(490);
    });

    it('clamps to the minimum width', () => {
        expect(rightSidebarWidth(980, 900)).toBe(SIDEBAR_MIN_WIDTH);
        expect(rightSidebarWidth(980, 2000)).toBe(SIDEBAR_MIN_WIDTH);
    });

    // A reader pane narrower than twice the minimum has no width that satisfies
    // both bounds. The maximum has to win, or the sidebar would be allowed to
    // cover more than half of a pane that is already too small.
    it('never exceeds half the viewport, even below the minimum width', () => {
        const narrow = 300;
        const width = rightSidebarWidth(narrow, 10);
        expect(width).toBeLessThanOrEqual(Math.round(narrow * SIDEBAR_MAX_FRACTION));
        expect(width).toBe(150);
    });

    it('always returns a whole number', () => {
        for (const x of [123.4, 0.5, 777.7]) {
            expect(Number.isInteger(rightSidebarWidth(981, x))).toBe(true);
        }
    });
});

describe('the injected stylesheet', () => {
    const css = sidebarStylesheet();

    // The trap that cost a wrong build: the reader ships a class-based and an
    // id-based split view, and only the id-based one carries the PDF iframe.
    // Moving just the class-based one leaves the document under the sidebar.
    it('moves BOTH split views, not just the class-based one', () => {
        expect(css).toContain(SELECTORS.splitViewClass);
        expect(css).toContain(SELECTORS.splitViewId);
    });

    it('gives the document area the opposite edge', () => {
        expect(css).toContain('inset-inline-end: var(--sidebar-width)');
        expect(css).toContain('inset-inline-start: 0');
    });

    it('moves the sidebar itself to the right edge', () => {
        expect(css).toContain(SELECTORS.sidebarContainer);
        expect(css).toContain('right: 0');
    });

    it('moves the drag handle with the sidebar', () => {
        expect(css).toContain(SELECTORS.sidebarResizer);
    });

    it('mirrors the existing icon rather than naming a second asset', () => {
        expect(css).toContain('transform: scaleX(-1)');
        expect(css).not.toMatch(/\.svg|url\(/);
    });

    it('hides the divider orphaned by the moved toggle', () => {
        expect(css).toContain(OWN.orphanDivider);
        expect(css).toContain('display: none');
    });

    // Every rule must be scoped to our own body class, or "left" would stop
    // being the reader's untouched behaviour.
    it('scopes every rule to the right-hand state', () => {
        const rules = css
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.endsWith('{') || line.endsWith(','))
            // At-rules open a block without being a selector; the selectors
            // inside them are checked on their own lines.
            .filter((line) => !line.startsWith('@'))
            .filter((line) => !line.startsWith('/*') && !line.startsWith('*'));
        expect(rules.length).toBeGreaterThan(0);
        for (const rule of rules) {
            expect(rule).toContain(OWN.rightClass);
        }
    });

    // Below the breakpoint the reader stops docking the sidebar and overlays
    // it, deliberately leaving the document at full width. Narrowing the
    // document there would be worse than doing nothing: it would be narrowed
    // AND still covered.
    it('mirrors the reader\'s overlay mode instead of docking', () => {
        expect(css).toContain(`@media (max-width: ${OVERLAY_BREAKPOINT_PX}px)`);
        const overlay = css.slice(css.indexOf('@media'));
        expect(overlay).toContain('inset-inline-end: 0');
        expect(overlay).toContain(OVERLAY_WIDTH);
    });

    it('uses the reader\'s own breakpoint and overlay width, not invented ones', () => {
        expect(OVERLAY_BREAKPOINT_PX).toBe(768);
        expect(OVERLAY_WIDTH).toBe('min(85vw, 320px)');
    });

    it('is stable, so re-applying it changes nothing', () => {
        expect(sidebarStylesheet()).toBe(css);
    });
});

describe('the reader contract fails soft', () => {
    it('reports a missing document rather than throwing', () => {
        expect(missingParts(null)).toEqual(['document']);
        expect(missingParts(undefined)).toEqual(['document']);
    });

    it('probes a missing document to null rather than throwing', () => {
        expect(probeReader(null)).toBeNull();
        expect(probeReader(undefined)).toBeNull();
    });

    it('names every part it could not find', () => {
        // A document-shaped object that finds nothing: the shape a reader
        // update would present.
        const empty = {
            body: {},
            querySelector: () => null,
        } as unknown as Document;
        const missing = missingParts(empty);
        expect(missing).toHaveLength(4);
        expect(missing.join(' ')).toContain(SELECTORS.sidebarToggle);
        expect(missing.join(' ')).toContain(SELECTORS.toolbarEnd);
    });

    it('refuses a partial structure instead of patching half of it', () => {
        // Toolbar groups present, toggle gone — exactly the shape that would
        // tempt a patch into moving nothing and setting a class anyway.
        const partial = {
            body: {},
            defaultView: {},
            querySelector: (selector: string) =>
                selector === SELECTORS.sidebarToggle ? null : ({} as Element),
        } as unknown as Document;
        expect(probeReader(partial)).toBeNull();
    });

    it.each([
        ['no window', null],
        ['an empty window', {}],
        ['a reader that is not an object', { _reader: 'nope' }],
        ['a reader without the setter', { _reader: {} }],
        ['a setter that is not callable', { _reader: { setSidebarWidth: 42 } }],
    ])('declines %s rather than calling into it', (_label, win) => {
        expect(readerInstance(win as unknown as Window)).toBeNull();
    });

    it('accepts a reader that really does expose the setter', () => {
        const win = { _reader: { setSidebarWidth: () => undefined } };
        expect(readerInstance(win as unknown as Window)).not.toBeNull();
    });
});

describe('event targets are matched across realms', () => {
    // Every node in these events comes from the reader's iframe, which has its
    // own `Element` constructor. `target instanceof Element` is therefore false
    // for every element the reader will ever produce — a guard written that way
    // makes the handler a silent no-op, which is exactly what happened to the
    // right-hand resize and the context menu on the first smoke run.
    //
    // A foreign element is modelled the only way it can be modelled in a Node
    // test: an object that answers `closest` but is not an instance of this
    // realm's Element.
    const foreignElement = (matches: Record<string, unknown>) => ({
        closest: (selector: string) => (matches[selector] ?? null) as Element | null,
    });

    it('matches an element from another realm', () => {
        // Two realms, modelled as two unrelated constructors: an element made
        // by one is never `instanceof` the other's, which is precisely the
        // relationship between the reader's iframe and this plugin.
        class ThisRealmElement {}
        class OtherRealmElement {
            constructor(private readonly matches: Record<string, unknown>) {}
            closest(selector: string): Element | null {
                return (this.matches[selector] ?? null) as Element | null;
            }
        }
        const handle = {} as Element;
        const target = new OtherRealmElement({ '.sidebar-resizer': handle });

        expect(target instanceof ThisRealmElement).toBe(false);
        expect(closestFrom(target as unknown as EventTarget, '.sidebar-resizer')).toBe(handle);
    });

    it('returns null when the selector does not match', () => {
        const target = foreignElement({});
        expect(closestFrom(target as unknown as EventTarget, SELECTORS.sidebarToggleAny)).toBeNull();
    });

    it.each([
        ['null', null],
        ['a target without closest', {}],
        ['a target whose closest is not callable', { closest: 'no' }],
    ])('declines %s without throwing', (_label, target) => {
        expect(closestFrom(target as unknown as EventTarget, '.anything')).toBeNull();
    });
});

// --- the preference has to survive a restart ------------------------------------
//
// The half that can be proven here is that the plugin reads its stored value on
// load, writes it on change, and never puts a default over it. The half that
// cannot — that Obsidian really hands the file back after a cold start — is
// proven by `scripts/smokeSidebarRestart.mjs`, which chooses the side through
// the reader's own menu, quits Obsidian and checks again after a real restart.

describe('where the side is kept', () => {
    const main = readFileSync('companion/zotflow-reader-extensions/src/main.ts', 'utf8');

    it('reads the stored value before anything else happens', () => {
        const onload = main.slice(main.indexOf('async onload()'), main.indexOf('onunload()'));
        expect(onload).toContain('this.settings = normalizeSettings(await this.loadData())');
        // The load is awaited FIRST: every later line, and every reader the
        // events reach, sees the stored side rather than the default.
        expect(onload.indexOf('loadData')).toBeLessThan(onload.indexOf('registerEvent'));
        expect(onload.indexOf('loadData')).toBeLessThan(onload.indexOf('onLayoutReady'));
    });

    it('writes on every change, and waits for the write', () => {
        const setSide = main.slice(main.indexOf('async setSide'), main.indexOf('private sync()'));
        expect(setSide).toContain('await this.saveData(this.settings)');
        // And only then does it bring the open readers into line, so a reader
        // can never show a side the file does not have.
        expect(setSide.indexOf('saveData')).toBeLessThan(setSide.indexOf('this.sync()'));
    });

    it('never writes a default over a loaded value', () => {
        // `saveData` appears once, in setSide. Nothing on the load path writes.
        expect(main.match(/saveData/g) ?? []).toHaveLength(1);
    });

    it('applies the loaded side to every reader it finds, new ones included', () => {
        expect(main).toContain('applySide(doc, this.currentSide())');
        // Read at call time rather than captured, so a reader opened later gets
        // the current preference and not the one that was loaded first.
        expect(main).toContain('private currentSide = (): SidebarSide => this.settings.sidebarSide');
    });

    it('keeps its preference to itself', () => {
        // Obsidian's own per-plugin storage, and nothing else: no reaching into
        // ZotFlow's settings, the panel's, or the vault.
        expect(main).not.toMatch(/zotflow'\]|dynamic-action-panel/);
        expect(main).not.toContain('vault.adapter');
        expect(main).not.toContain('writeFile');
    });
});
