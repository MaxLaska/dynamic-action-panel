import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Slot geometry is content-independent.
 *
 * The 16 slots of a 4x4 grid must keep x/y/width/height from drag start to
 * drop or cancel, no matter whether a cell is occupied, empty, the source, the
 * destination or the live preview. With content-sized rows that failed: a row
 * holding a button was two cell borders taller than an all-empty row, so a
 * drag that emptied its source row — or previewed into a previously empty one
 * — resized both rows and shifted every slot below them mid-drag.
 *
 * These are CSS-contract checks; the live evidence lives in
 * docs/ocap/HANDOFF.md.
 */
const css = readFileSync(
    new URL('../src/components/buttons-panel/PaletteGrid.css', import.meta.url),
    'utf8'
);

interface CssRule {
    selector: string;
    body: string;
}

const rules: CssRule[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').trim(),
    body: match[2] ?? '',
}));

/** The declarations of the first rule whose selector matches. */
function ruleBody(selectorPattern: RegExp): string {
    const rule = rules.find((r) => selectorPattern.test(r.selector));
    if (!rule) throw new Error(`no rule matching ${String(selectorPattern)}`);
    return rule.body;
}

describe('palette grid geometry', () => {
    const grid = ruleBody(/\.ocap-palette-grid$/);

    it('sizes its rows from a definite track, not from the cells content', () => {
        const track = /grid-auto-rows:\s*([^;]+);/.exec(grid)?.[1]?.trim();
        expect(track).toBe('var(--ocap-grid-row-height)');
        // `auto`, `min-content`, `max-content` and a `minmax(..., auto)` upper
        // bound would all let the tallest cell of a row define that row again.
        expect(track).not.toMatch(/auto|min-content|max-content|fit-content/);
    });

    it('derives the row height from the one slot token plus the cell border', () => {
        expect(grid).toMatch(
            /--ocap-grid-row-height:\s*calc\(var\(--ocap-grid-slot-min-height\)\s*\+\s*2px\)/
        );
        expect(grid).toMatch(/--ocap-grid-slot-min-height:\s*56px/);
        expect(ruleBody(/\.ocap-palette-grid\.icon-left$/)).toMatch(
            /--ocap-grid-slot-min-height:\s*40px/
        );
    });

    it('keeps the four logical columns invariant', () => {
        expect(grid).toMatch(
            /grid-template-columns:\s*repeat\(var\(--ocap-grid-columns,\s*4\),\s*minmax\(0,\s*1fr\)\)/
        );
    });

    it('never gives an occupancy-, target- or preview-specific rule a fixed size', () => {
        // Rules keyed on what a cell currently holds may only change colour,
        // opacity and border STYLE. A fixed length on any of them would make
        // the cell box depend on its momentary content again. Relative values
        // are fine: they fill the cell instead of resizing it.
        const stateSelectors = [
            /\.ocap-grid-slot--filled/,
            /\.ocap-grid-slot--empty/,
            /\.ocap-grid-slot--drop-target/,
            /\.ocap-grid-slot--file-target/,
            /\.button-drag-grid-placeholder/,
        ];
        const sizing =
            /(?:^|[;\s])((?:min-|max-)?(?:height|width)|padding[a-z-]*|margin[a-z-]*|border(?:-[a-z]+)?-width|border)\s*:\s*([^;]+)/g;
        const relative = /^(100%|0|auto|inherit|min-content|1px solid .*)$/;

        for (const rule of rules) {
            if (!stateSelectors.some((s) => s.test(rule.selector))) continue;
            for (const match of rule.body.matchAll(sizing)) {
                const prop = match[1] ?? '';
                const value = (match[2] ?? '').trim();
                // The one deliberate exception: an empty cell keeps a height
                // floor for grids rendered outside `.ocap-palette-grid`. It is
                // the SAME token the row track is derived from, so it can only
                // ever be shorter than the track, never taller.
                if (prop === 'min-height' && value.includes('--ocap-grid-slot-min-height')) continue;
                expect(relative.test(value), `${rule.selector}: ${prop}: ${value}`).toBe(true);
            }
        }
    });
});

/**
 * The raster must read as a construction — visible cell boundaries — in EVERY
 * mode and WITHOUT moving a single pixel.
 *
 * It used to be edit-only (`--managed`), which made the same grid look like two
 * different panels: locked lost its slot boundaries, and with them the sense
 * that a tool sits IN a cell. Switching modes now changes what a press means,
 * never the layout. The cell border exists in every mode anyway (transparent by
 * default), so making the raster visible may only ever change a colour; the
 * outer frame is an `outline`, which never takes part in layout.
 */
describe('the raster is mode-independent and colour-only', () => {
    const grid = ruleBody(/\.ocap-palette-grid$/);

    it('frames the whole grid with an outline, never a border', () => {
        expect(grid).toMatch(/outline:\s*1px solid var\(--ocap-grid-line\)/);
        // A border (or padding) on the container would shrink the cell tracks.
        expect(grid).not.toMatch(/(?:^|[;\s])(border|padding)\s*:/);
    });

    it('derives the line colour from the theme, not from a hard-coded white', () => {
        expect(grid).toMatch(/--ocap-grid-line:\s*rgba\(var\(--mono-rgb-100\)/);
    });

    it('draws the cell border and the cell ground without a mode class', () => {
        // The three rules that make a grid readable as a grid. None of them may
        // key on `--managed`, or locked mode loses the raster again.
        for (const pattern of [
            /^\.buttons-panel \.ocap-palette-grid \.ocap-grid-slot$/,
            /^\.buttons-panel \.ocap-palette-grid \.ocap-grid-slot--filled$/,
            /^\.buttons-panel \.ocap-palette-grid \.ocap-grid-slot--empty$/,
        ]) {
            const rule = rules.find((r) => pattern.test(r.selector));
            expect(rule, `no mode-independent rule matching ${String(pattern)}`).toBeTruthy();
            expect(rule!.selector).not.toMatch(/--managed/);
        }
        expect(ruleBody(/^\.buttons-panel \.ocap-palette-grid \.ocap-grid-slot$/)).toMatch(
            /border-color:\s*var\(--ocap-grid-line\)/
        );
    });

    it('lets the tool fill its cell whatever wrapper the mode gives it', () => {
        // `.icon-top`/`.icon-left` pin a FIXED button width at 0-4-2. In edit
        // mode the drag wrapper adds a class and the grid's width rule ties on
        // specificity; in locked mode there is no wrapper, so without naming
        // the layout class here the tool stays 56px wide in a wider cell —
        // left-aligned, with a hover that covers the button instead of the
        // slot. That was the actual mode mismatch.
        const fill = rules.find((r) =>
            /\.ocap-grid-slot button\.buttons-panel-simple-button\.icon-top/.test(r.selector)
        );
        expect(fill, 'no mode-independent width rule for the tool').toBeTruthy();
        expect(fill!.selector).toMatch(/\.icon-left/);
        expect(fill!.selector).not.toMatch(/sortable-button-item|--managed/);
        expect(fill!.body).toMatch(/width:\s*100%/);
    });

    it('gives a tool a hover ground that fills its whole cell', () => {
        // `.icon-top`/`.icon-left` set `background-color: transparent` at the
        // same specificity as Button.css' own hover rule and come later, so a
        // tool on a grid had no hover ground at all — only a drop shadow. That
        // is what made a locked cell feel like a small label instead of a slot.
        const hover = rules.find((r) =>
            /\.ocap-palette-grid \.ocap-grid-slot button\.buttons-panel-simple-button:hover$/.test(
                r.selector
            )
        );
        expect(hover, 'no slot-wide hover rule for a tool').toBeTruthy();
        expect(hover!.selector).not.toMatch(/--managed|--colored/);
        expect(hover!.body).toMatch(/background-color:\s*var\(--background-modifier-hover\)/);
        // ...and it must lose to the coloured-cell hover, which is the same
        // specificity and therefore decided by order.
        const colored = rules.findIndex((r) =>
            /--colored button\.buttons-panel-simple-button:hover/.test(r.selector)
        );
        expect(colored).toBeGreaterThan(rules.indexOf(hover!));
    });

    it('reserves the resize gutter in locked mode too', () => {
        // The handles are an editing affordance, but the SPACE they occupy is
        // not: without it every cell of a 4-column grid grew by 4px the moment
        // the panel was locked, and the raster jumped on a mode switch.
        const gutter = ruleBody(/^\.buttons-panel \.ocap-grid-gutter$/);
        expect(gutter).toMatch(/flex:\s*0 0 var\(--ocap-grid-edge-size\)/);
        expect(gutter).toMatch(/pointer-events:\s*none/);
        expect(ruleBody(/\.ocap-grid-gutter--column$/)).toMatch(
            /width:\s*var\(--ocap-grid-edge-size\)/
        );
        expect(ruleBody(/\.ocap-grid-gutter--row$/)).toMatch(
            /height:\s*var\(--ocap-grid-edge-size\)/
        );
    });

    it('keeps the editing-only chrome behind the mode class', () => {
        // What genuinely belongs to editing stays gated: an empty cell only
        // lights up under the pointer where it can be acted on, and only a
        // manageable grid advertises a grab cursor.
        const managedRules = rules.filter((r) =>
            /\.ocap-palette-grid--managed/.test(r.selector)
        );
        expect(managedRules.length).toBeGreaterThan(0);
        expect(
            managedRules.some((r) => /\.ocap-grid-slot--empty:hover$/.test(r.selector))
        ).toBe(true);
    });

    it('only recolours the cell border it already had', () => {
        const sizing = /(?:^|[;\s])((?:min-|max-)?(?:height|width)|padding[a-z-]*|margin[a-z-]*|border(?:-[a-z]+)?-width|border)\s*:\s*([^;]+)/g;
        const chrome = rules.filter(
            (r) =>
                /\.ocap-palette-grid--managed/.test(r.selector) ||
                /^\.buttons-panel \.ocap-palette-grid \.ocap-grid-slot/.test(r.selector)
        );
        for (const rule of chrome) {
            for (const match of rule.body.matchAll(sizing)) {
                expect.fail(
                    `${rule.selector} changes ${match[1]} (${String(match[2]).trim()}) — the raster must be colour-only`
                );
            }
        }
    });

    it('lets the drop-target and file-target rings outrank the hover chrome', () => {
        // `:hover` adds a class level to the selector; if the hover rule also
        // set a border colour it would beat the accent rings that promise
        // where a drop lands.
        const hover = rules.find((r) => /--managed .ocap-grid-slot--empty:hover/.test(r.selector));
        expect(hover, 'no managed hover rule').toBeTruthy();
        expect(hover!.body).not.toMatch(/border/);
    });
});

/**
 * The graspable edges. They must be big enough to grab anywhere along the
 * grid's border, and strictly outside the slot grid — a zone overlapping the
 * cells would swallow clicks, button drags and file drops that belong to the
 * outermost column/row.
 */
describe('grid resize edges', () => {
    const edgeRules = rules.filter((r) => /\.ocap-grid-edge/.test(r.selector));

    it('names the axis it resizes through the cursor', () => {
        const column = edgeRules.find((r) => /button\.ocap-grid-edge--column$/.test(r.selector));
        const row = edgeRules.find((r) => /button\.ocap-grid-edge--row$/.test(r.selector));
        expect(column?.body).toMatch(/cursor:\s*ew-resize/);
        expect(row?.body).toMatch(/cursor:\s*ns-resize/);
    });

    it('spans the whole edge it belongs to', () => {
        const column = edgeRules.find((r) => /button\.ocap-grid-edge--column$/.test(r.selector));
        const row = edgeRules.find((r) => /button\.ocap-grid-edge--row$/.test(r.selector));
        // Full height of the grid / full width of the grid.
        expect(column?.body).toMatch(/align-self:\s*stretch/);
        // Obsidian gives every button a fixed height, which silently opts the
        // item out of `stretch` — the band was 30px tall next to a 182px grid
        // until the height was handed back.
        expect(column?.body).toMatch(/height:\s*auto/);
        expect(row?.body).toMatch(/width:\s*100%/);
    });

    it('is a band wide enough to hit without aiming', () => {
        const frame = rules.find((r) => /\.ocap-grid-frame$/.test(r.selector));
        const size = /--ocap-grid-edge-size:\s*(\d+)px/.exec(frame?.body ?? '')?.[1];
        expect(Number(size)).toBeGreaterThanOrEqual(12);
    });

    it('shows a grip thick enough to read as a handle, inside a wider hitbox', () => {
        const frame = rules.find((r) => /\.ocap-grid-frame$/.test(r.selector));
        const hit = Number(/--ocap-grid-edge-size:\s*(\d+)px/.exec(frame?.body ?? '')?.[1]);
        const grip = Number(/--ocap-grid-grip-size:\s*(\d+)px/.exec(frame?.body ?? '')?.[1]);
        // A 1-2px line does not read as something one can take hold of.
        expect(grip).toBeGreaterThanOrEqual(6);
        // ...but the pointer still gets the bigger target.
        expect(grip).toBeLessThan(hit);
    });

    it('gives the grip three distinguishable states, colour only', () => {
        const idle = edgeRules.find((r) => /\.ocap-grid-edge-grip$/.test(r.selector));
        expect(idle?.body).toMatch(/background-color:\s*rgba\(var\(--mono-rgb-100\)/);
        const lit = edgeRules.find(
            (r) => /:hover .ocap-grid-edge-grip/.test(r.selector) && /--dragging/.test(r.selector)
        );
        // Hover, focus and drag share one rule so the grip cannot flicker
        // between them on the way into a gesture.
        expect(lit?.body).toMatch(/background-color:\s*var\(--interactive-accent\)/);
        // Only colour: a size here would move the gutter, and with it the grid.
        expect(lit?.body).not.toMatch(/(?:^|[;\s])(width|height|padding|margin|border)\s*:/);
    });

    it('keeps the `+` legible once the grip turns accent', () => {
        const lit = edgeRules.find((r) => /:hover .ocap-grid-edge-plus/.test(r.selector));
        expect(lit?.body).toMatch(/color:\s*var\(--text-on-accent\)/);
    });

    it('never lives inside the slot grid', () => {
        for (const rule of edgeRules) {
            expect(
                /\.ocap-palette-grid[^,]*\.ocap-grid-edge/.test(rule.selector),
                rule.selector
            ).toBe(false);
        }
    });

    it('keeps the readout out of the grid box and out of the way', () => {
        const readout = rules.find((r) => /\.ocap-grid-resize-readout$/.test(r.selector));
        expect(readout, 'no readout rule').toBeTruthy();
        expect(readout!.body).toMatch(/position:\s*absolute/);
        expect(readout!.body).toMatch(/pointer-events:\s*none/);
        // Lifted above the grid's top edge, so it cannot cover the cells it
        // describes — a 1x1 grid used to lose its only cell behind it.
        expect(readout!.body).toMatch(/transform:\s*translateY\(calc\(-100%/);
    });
});

/**
 * Cell colours and cell selection.
 *
 * Both are new visual channels on a cell whose geometry is frozen, and both sit
 * in a cascade that already promises things: the drop-target rings say where a
 * drop lands, the dashed faint outline means "hidden by its context", and the
 * managed ground paints filled and empty cells. Specificity is therefore a
 * CONTRACT here, not an accident of authoring order — which is what these
 * checks pin.
 */
describe('cell colours and selection', () => {
    /** Index of the first rule whose selector matches, for order assertions. */
    function ruleIndex(selectorPattern: RegExp): number {
        const index = rules.findIndex((r) => selectorPattern.test(r.selector));
        expect(index, `no rule matching ${String(selectorPattern)}`).toBeGreaterThanOrEqual(0);
        return index;
    }

    const sizing =
        /(?:^|[;\s])((?:min-|max-)?(?:height|width)|padding[a-z-]*|margin[a-z-]*|border(?:-[a-z]+)?-width|border)\s*:\s*([^;]+)/g;

    it('defines the tint strength as ONE token on the grid', () => {
        // One line rebalances the whole palette; nothing may hardcode an alpha.
        expect(ruleBody(/\.ocap-palette-grid$/)).toMatch(/--ocap-cell-color-alpha:\s*[\d.]+/);
    });

    it('paints the cell colour with enough specificity to beat the managed ground', () => {
        // `--managed --filled` and `--managed --empty` are 0-4-0, so the colour
        // rule needs 0-4-1 — the doubled slot class is the smallest selector
        // that gets there. Written out so a later "simplification" has to fail
        // this test instead of silently losing the colour on managed grids.
        const colored = rules.find((r) =>
            /\.ocap-grid-slot\.ocap-grid-slot--colored$/.test(r.selector)
        );
        expect(colored, 'no cell-colour rule').toBeTruthy();
        expect(colored!.selector).toBe(
            'body .buttons-panel .ocap-palette-grid .ocap-grid-slot.ocap-grid-slot--colored'
        );
        expect(colored!.body).toMatch(/background-color:\s*var\(--ocap-cell-color\)/);
    });

    it('still lets the drop promises win over a coloured cell', () => {
        // The colour rule (0-4-1) outranks the target rings (0-3-1), so the
        // rings are restored explicitly — and must come AFTER the colour.
        const restore = rules.find((r) =>
            /--colored\.ocap-grid-slot--drop-target/.test(r.selector)
        );
        expect(restore, 'no drop-target restore for coloured cells').toBeTruthy();
        expect(restore!.selector).toMatch(/--colored\.ocap-grid-slot--file-target/);
        expect(restore!.body).toMatch(/background-color:\s*var\(--background-modifier-hover\)/);
        expect(ruleIndex(/--colored\.ocap-grid-slot--drop-target/)).toBeGreaterThan(
            ruleIndex(/\.ocap-grid-slot\.ocap-grid-slot--colored$/)
        );
    });

    it('keeps a coloured cell coloured while the pointer is on it', () => {
        // The managed empty-hover rule is 0-5-0 and would otherwise grey out
        // exactly the cell the user is colouring.
        const hoverKeep = rules.find((r) =>
            /--empty\.ocap-grid-slot--colored:hover/.test(r.selector)
        );
        expect(hoverKeep, 'no hover override for coloured cells').toBeTruthy();
        expect(hoverKeep!.body).toMatch(/background-color:\s*var\(--ocap-cell-color\)/);
        // Source order decides between the two 0-5-x rules.
        expect(ruleIndex(/--empty\.ocap-grid-slot--colored:hover/)).toBeGreaterThan(
            ruleIndex(/--managed \.ocap-grid-slot--empty:hover$/)
        );
    });

    it('marks a selected cell with an outline, never with the reserved channels', () => {
        const selected = rules.find((r) => /\.ocap-grid-slot--selected$/.test(r.selector));
        expect(selected, 'no selection rule').toBeTruthy();
        // 2px inset accent: distinct from the 1px accent BORDER of a drop
        // target and from the 1px dashed faint outline of "context-hidden".
        expect(selected!.body).toMatch(/outline:\s*2px solid var\(--interactive-accent\)/);
        expect(selected!.body).toMatch(/outline-offset:\s*-2px/);
        expect(selected!.body).not.toMatch(/dashed/);
        // An outline never takes part in layout; a border would move the cell.
        expect(selected!.body).not.toMatch(/(?:^|[;\s])border/);
    });

    it('gives the colour and selection rules no size of their own', () => {
        for (const rule of rules) {
            if (!/--colored|--selected/.test(rule.selector)) continue;
            for (const match of rule.body.matchAll(sizing)) {
                expect.fail(
                    `${rule.selector} changes ${match[1]} (${String(match[2]).trim()}) — colour and selection must not resize a cell`
                );
            }
        }
    });

    it('anchors the corner + on the cell without taking part in layout', () => {
        // `position: relative` with no offsets keeps the cell rects identical.
        const slot = ruleBody(/^\.buttons-panel \.ocap-grid-slot$/);
        expect(slot).toMatch(/position:\s*relative/);
        expect(slot).not.toMatch(/(?:^|[;\s])(top|left|right|bottom):/);
    });

    it('makes the + a small corner target instead of the whole cell', () => {
        const add = ruleBody(/button\.ocap-slot-add$/);
        // Out of flow, so the definite row track still decides the geometry.
        expect(add).toMatch(/position:\s*absolute/);
        expect(add).toMatch(/top:\s*2px/);
        expect(add).toMatch(/right:\s*2px/);
        // A cell is ~33px wide at four columns in a 150px sidebar; a `+` that
        // scaled with the cell would eat a quarter of the selection surface.
        const width = /(?:^|[;\s])width:\s*([^;]+)/.exec(add)?.[1]?.trim();
        const height = /(?:^|[;\s])height:\s*([^;]+)/.exec(add)?.[1]?.trim();
        expect(width).toBe('18px');
        expect(height).toBe('18px');
        expect(width).not.toBe('100%');
    });
});

/**
 * The colour palette below the grid. It must not be mistaken for a grid row,
 * and it must not be swept into the resize-edge contract.
 */
describe('cell colour palette bar', () => {
    it('exists and wraps instead of overflowing a narrow sidebar', () => {
        const bar = ruleBody(/\.ocap-cell-palette$/);
        expect(bar).toMatch(/flex-wrap:\s*wrap/);
        expect(bar).toMatch(/min-width:\s*0/);
        // Below the grid, so appearing content never pushes a cell around.
        expect(bar).toMatch(/margin-top:/);
    });

    it('is not named like a grid edge, so it stays out of the edge contract', () => {
        const paletteRules = rules.filter((r) =>
            /\.ocap-cell-palette|\.ocap-cell-swatch/.test(r.selector)
        );
        expect(paletteRules.length).toBeGreaterThan(0);
        for (const rule of paletteRules) {
            expect(rule.selector).not.toMatch(/ocap-grid-edge|ocap-palette-grid|ocap-grid-slot/);
        }
    });

    it('keeps a swatch clearly smaller than a grid cell', () => {
        const swatch = ruleBody(/button\.ocap-cell-swatch$/);
        expect(swatch).toMatch(/width:\s*18px/);
        expect(swatch).toMatch(/height:\s*18px/);
        // Round, so a row of them never reads as another row of cells.
        expect(swatch).toMatch(/border-radius:\s*50%/);
    });

    it('marks the active swatch OUTSIDE itself, so the colour stays visible', () => {
        const active = ruleBody(/\.ocap-cell-swatch--active$/);
        expect(active).toMatch(/outline:\s*2px solid var\(--interactive-accent\)/);
        expect(active).toMatch(/outline-offset:\s*2px/);
    });

    it('keeps an OCCUPIED coloured cell coloured under the pointer', () => {
        // The tool button is transparent at rest but paints an opaque ground on
        // hover, which would hide the colour of exactly the cell the user is
        // about to recolour. A translucent overlay keeps both readable.
        const hover = rules.find((r) =>
            /--colored button\.buttons-panel-simple-button:hover/.test(r.selector)
        );
        expect(hover, 'no hover rule for a tool on a coloured cell').toBeTruthy();
        expect(hover!.body).toMatch(/background-color:\s*rgba\(var\(--mono-rgb-100\)/);
        expect(hover!.body).not.toMatch(/var\(--background-modifier-hover\)/);
    });
});

/**
 * Escape must clear the selection WITHOUT taking the key away from anyone else.
 *
 * The first version of this handler was a capture-phase listener on the whole
 * document that called `stopPropagation()` for every Escape while a selection
 * existed. That silently disabled every other Escape handler in the app —
 * dnd-kit's drag cancel and the grid-resize cancel both listen on the document
 * in the BUBBLE phase, the folder's inline rename is a React handler on the
 * root container, and Obsidian's own modals and menus are not document-capture
 * listeners either. Clearing a selection must not be able to trap someone
 * inside a dialog.
 *
 * There is no DOM in this test environment, so the rule is pinned at the source
 * level — the same technique tests/futureSettings.test.ts uses to pin "there is
 * exactly one place that writes settings".
 */
describe('the Escape handler never swallows the key', () => {
    const source = readFileSync(
        new URL('../src/components/buttons-panel/CellSelectionEscape.tsx', import.meta.url),
        'utf8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    it('neither stops nor cancels the event', () => {
        expect(code).not.toMatch(/stopPropagation/);
        expect(code).not.toMatch(/stopImmediatePropagation/);
        expect(code).not.toMatch(/preventDefault/);
    });

    it('listens in the bubble phase, not in capture', () => {
        // A third argument of `true` would put it back in front of everyone.
        expect(code).toMatch(/addEventListener\('keydown',\s*onKeyDown\)/);
        expect(code).not.toMatch(/addEventListener\('keydown',\s*onKeyDown,\s*true\)/);
    });

    it('yields to an active drag, where Escape means "cancel the drag"', () => {
        expect(code).toMatch(/isDragging/);
    });

    it('only reacts to an Escape aimed at the panel itself', () => {
        // An Escape meant for a modal, a suggester or the editor is none of our
        // business.
        expect(code).toMatch(/contains\(target\)/);
    });
});
