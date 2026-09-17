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
 * Edit mode must read as a construction — visible cell boundaries — WITHOUT
 * moving a single pixel. The cell border already exists in every mode
 * (transparent in locked), so making the raster visible may only ever change a
 * colour; the outer frame is an `outline`, which never takes part in layout.
 */
describe('edit-mode raster is colour-only', () => {
    const managedRules = rules.filter((r) => /\.ocap-palette-grid--managed/.test(r.selector));

    it('has managed-mode rules at all', () => {
        expect(managedRules.length).toBeGreaterThan(0);
    });

    it('frames the whole grid with an outline, never a border', () => {
        const frame = managedRules.find((r) => /--managed$/.test(r.selector));
        expect(frame, 'no rule for the managed grid container').toBeTruthy();
        expect(frame!.body).toMatch(/outline:\s*1px solid var\(--ocap-grid-line\)/);
        // A border (or padding) on the container would shrink the cell tracks.
        expect(frame!.body).not.toMatch(/(?:^|[;\s])(border|padding)\s*:/);
    });

    it('derives the line colour from the theme, not from a hard-coded white', () => {
        const frame = managedRules.find((r) => /--managed$/.test(r.selector))!;
        expect(frame.body).toMatch(/--ocap-grid-line:\s*rgba\(var\(--mono-rgb-100\)/);
    });

    it('only recolours the cell border it already had', () => {
        const sizing = /(?:^|[;\s])((?:min-|max-)?(?:height|width)|padding[a-z-]*|margin[a-z-]*|border(?:-[a-z]+)?-width|border)\s*:\s*([^;]+)/g;
        for (const rule of managedRules) {
            // The container rule is covered by the outline test above.
            if (/--managed$/.test(rule.selector)) continue;
            for (const match of rule.body.matchAll(sizing)) {
                expect.fail(
                    `${rule.selector} changes ${match[1]} (${String(match[2]).trim()}) — edit chrome must be colour-only`
                );
            }
        }
    });

    it('lets the drop-target and file-target rings outrank the hover chrome', () => {
        // `:hover` adds a class level to the selector; if the hover rule also
        // set a border colour it would beat the accent rings that promise
        // where a drop lands.
        const hover = managedRules.find((r) => /--empty:hover/.test(r.selector));
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
