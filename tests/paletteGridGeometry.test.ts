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
