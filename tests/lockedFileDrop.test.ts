// tests/lockedFileDrop.test.ts
//
// Locked is the WORKING mode: a file dropped onto a slot becomes a tool there,
// without a detour through edit mode. What stays edit-only is everything that
// rearranges what is already on the grid — move, swap, reorder, resize,
// selection, colours, the `+`.
//
// The line this file guards is the one that is easy to blur: a drop comes from
// OUTSIDE (a native HTML5 drag out of Obsidian) and is allowed; the plugin's
// own pointer-based drag is internal and is not. Making locked mode "DnD
// capable" in general would be the wrong fix, so the gate is pinned per
// affordance.
//
// The data half — replacing an occupied slot and collecting the tool that made
// way — is covered by tests/categoryOps.test.ts; the behaviour itself by the
// live smoke run.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function codeOf(relativePath: string): string {
    return readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

const grid = codeOf('components/buttons-panel/CategoryButtonGrid.tsx');
const cell = codeOf('components/buttons-panel/GridSlotCell.tsx');
const hook = codeOf('hooks/useSlotFileDrop.ts');

describe('a file drop is not gated on the mode', () => {
    it('has its own gate, with no edit-mode term in it', () => {
        expect(grid).toMatch(
            /const fileDropEnabled = !isDragging && !resizeDrag\.preview;/
        );
        expect(grid).toMatch(/fileDrop=\{\s*fileDropEnabled/);
    });

    it('still suspends a drop while a drag or a resize preview is in flight', () => {
        // A button drag owns the cells' appearance, and a resize preview is a
        // proposal pointer-up may still undo.
        expect(grid).toMatch(/fileDropEnabled = !isDragging && !resizeDrag\.preview/);
    });

    it('keeps the `+` edit-only, because creating IS editing', () => {
        expect(grid).toMatch(
            /const creationEnabled = enableEditMode && !isDragging && !resizeDrag\.preview;/
        );
        expect(grid).toMatch(/onCreate=\{\s*creationEnabled/);
    });

    it('keeps the plugin-internal drag edit-only', () => {
        // `sortableEnabled` is the dnd-kit gate; it must not have picked up the
        // file-drop flag by accident.
        expect(grid).toMatch(/droppableEnabled=\{sortableEnabled\}/);
        expect(grid).not.toMatch(/droppableEnabled=\{fileDropEnabled\}/);
        expect(grid).not.toMatch(/sortableEnabled = fileDropEnabled/);
    });
});

describe('a file may land on an occupied cell', () => {
    it('no longer refuses a filled cell', () => {
        expect(cell).toMatch(/const acceptsFiles = fileDrop !== undefined;/);
        expect(cell).not.toMatch(/acceptsFiles = !filled/);
    });

    it('keeps the `+` on empty cells only', () => {
        expect(cell).toMatch(/const addable = !filled && onCreate !== undefined;/);
    });

    it('still lights the cell up as a drop target', () => {
        // The existing hover state is reused; an occupied target needs no
        // warning colour and no overwrite badge.
        expect(cell).toMatch(/fileDragOver && acceptsFiles && 'ocap-grid-slot--file-target'/);
    });
});

describe('the drop replaces without asking', () => {
    it('passes the deliberate-replace intent into the ONE create operation', () => {
        expect(hook).toMatch(/createToolInCategory\(/);
        expect(hook).toMatch(/\{ replaceOccupied: true \}/);
    });

    it('opens no dialog and raises no warning about the existing tool', () => {
        expect(hook).not.toMatch(/Modal|confirm|Confirm/);
        // The only notices left are the pre-existing ones: an unidentified
        // annotation, a full grid, and the drop's own success message.
        const notices = [...hook.matchAll(/new Notice\(([^)]*)\)/g)].map((m) => m[1]);
        expect(notices).toEqual([
            "t('annotation_not_identified'",
            "t('variant_grid_full'",
            't(draft.noticeKey',
        ]);
    });

    it('does not reimplement creation for locked mode', () => {
        // One parse, one draft, one create, one commit — the same path both
        // modes have always used.
        expect([...hook.matchAll(/createToolInCategory\(/g)]).toHaveLength(1);
        expect([...hook.matchAll(/commitToolState\(/g)]).toHaveLength(1);
        expect([...hook.matchAll(/resolveSlotDropDraft\(/g)]).toHaveLength(1);
        expect(hook).not.toMatch(/enableEditMode|interactionMode|isLocked/);
    });
});

describe('the drop lands in the grid that is on screen', () => {
    it('is told the variant by the renderer instead of guessing it', () => {
        // In locked mode there is no editing selection, and falling back to
        // "the first variant" would file the tool into a grid nobody is
        // looking at.
        expect(grid).toMatch(/variantId: resolution\.variantId/);
        expect(hook).toMatch(/target\.variantId \?\? selection\[stored\.id\]\?\.current \?\? null/);
    });
});
