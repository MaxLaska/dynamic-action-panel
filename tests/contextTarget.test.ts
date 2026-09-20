// tests/contextTarget.test.ts
//
// What a right click is ABOUT (21–46).
//
// The whole product rule is one line — a right click inside the selection is
// about the selection, anywhere else it is about the tool under the pointer —
// so most of this file guards the things that are easy to get wrong AROUND
// that line: a selection that contains empty cells, a tool id that no longer
// exists, a grid that remounted, and above all the rule that reading the
// selection never changes it.
//
// Layer 1 is the pure function. Layer 2 is the wiring, at source level: there
// is no DOM here, so the test asserts that the one path from grid to menu is
// actually connected and that nothing on it writes.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GridCellKey } from '@/types/settings';
import {
    getSelectionDescriptor,
    resolveContextTarget,
    toolOnlyContextTarget,
} from '@/utils/contextTarget';

const read = (path: string) => readFileSync(path, 'utf8');

/** A 4-column grid: cell -> tool, with the gaps a real grid has. */
const TOOLS: Record<string, string> = {
    r0c0: 'tool-a',
    r0c1: 'tool-b',
    r1c0: 'tool-c',
    r1c2: 'tool-d',
};
const toolIdOfCell = (cell: GridCellKey): string | null => TOOLS[cell] ?? null;
const cells = (...keys: string[]) => new Set(keys);

describe('the routing rule', () => {
    it('21. resolves a tool context when nothing is selected', () => {
        const target = resolveContextTarget({
            clickedCell: 'r0c0',
            clickedToolId: 'tool-a',
            selectedCells: cells(),
            toolIdOfCell,
        });
        expect(target.kind).toBe('tool');
        expect(target.clickedToolId).toBe('tool-a');
        expect(target.cellCount).toBe(0);
        expect(target.toolIds).toEqual([]);
    });

    it('22. resolves a tool context for a click OUTSIDE the selection', () => {
        const target = resolveContextTarget({
            clickedCell: 'r1c0',
            clickedToolId: 'tool-c',
            selectedCells: cells('r0c0', 'r0c1'),
            toolIdOfCell,
        });
        expect(target.kind).toBe('tool');
        expect(target.clickedInSelection).toBe(false);
        // The selection is still described — it exists, it is just not what
        // this click is about.
        expect(target.cellCount).toBe(2);
        expect(target.toolIds).toEqual(['tool-a', 'tool-b']);
    });

    it('23. resolves a selection context for a click INSIDE the selection', () => {
        const target = resolveContextTarget({
            clickedCell: 'r0c1',
            clickedToolId: 'tool-b',
            selectedCells: cells('r0c0', 'r0c1', 'r1c2'),
            toolIdOfCell,
        });
        expect(target.kind).toBe('selection');
        expect(target.clickedInSelection).toBe(true);
        expect(target.cellCount).toBe(3);
        expect(target.toolIds).toEqual(['tool-a', 'tool-b', 'tool-d']);
    });

    it('24. treats a selection of exactly the clicked cell as a selection context', () => {
        const target = resolveContextTarget({
            clickedCell: 'r0c0',
            clickedToolId: 'tool-a',
            selectedCells: cells('r0c0'),
            toolIdOfCell,
        });
        expect(target.kind).toBe('selection');
        expect(target.cellCount).toBe(1);
        expect(target.toolIds).toEqual(['tool-a']);
    });

    it('25. counts selected EMPTY cells but lists no tool for them', () => {
        const target = resolveContextTarget({
            clickedCell: 'r0c0',
            clickedToolId: 'tool-a',
            selectedCells: cells('r0c0', 'r0c2', 'r0c3', 'r3c3'),
            toolIdOfCell,
        });
        expect(target.cellCount).toBe(4);
        expect(target.toolIds).toEqual(['tool-a']);
    });

    it('26. lists the tools in reading order, whatever order the set has', () => {
        const target = resolveContextTarget({
            clickedCell: 'r1c2',
            clickedToolId: 'tool-d',
            selectedCells: cells('r1c2', 'r0c1', 'r1c0', 'r0c0'),
            toolIdOfCell,
        });
        expect(target.toolIds).toEqual(['tool-a', 'tool-b', 'tool-c', 'tool-d']);
    });

    it('27. never lists the same tool twice', () => {
        // A duplicated id is corrupt data, not a reason to offer an action twice.
        const target = resolveContextTarget({
            clickedCell: 'r0c0',
            clickedToolId: 'tool-a',
            selectedCells: cells('r0c0', 'r0c1'),
            toolIdOfCell: () => 'tool-a',
        });
        expect(target.toolIds).toEqual(['tool-a']);
        expect(target.cellCount).toBe(2);
    });

    it('28. survives a stale cell the grid no longer knows', () => {
        const target = resolveContextTarget({
            clickedCell: 'r0c0',
            clickedToolId: 'tool-a',
            selectedCells: cells('r0c0', 'r9c9'),
            toolIdOfCell,
        });
        expect(target.toolIds).toEqual(['tool-a']);
        expect(target.cellCount).toBe(2);
    });

    it('29. ignores an empty tool id', () => {
        const target = resolveContextTarget({
            clickedCell: 'r0c0',
            clickedToolId: null,
            selectedCells: cells('r0c0'),
            toolIdOfCell: () => '',
        });
        expect(target.toolIds).toEqual([]);
    });

    it('30. is a selection context even when the clicked cell is empty', () => {
        // A right click can land on a selected cell that holds nothing. That
        // is still the selection talking, with no clicked tool.
        const target = resolveContextTarget({
            clickedCell: 'r0c2',
            clickedToolId: null,
            selectedCells: cells('r0c0', 'r0c2'),
            toolIdOfCell,
        });
        expect(target.kind).toBe('selection');
        expect(target.clickedToolId).toBeNull();
        expect(target.toolIds).toEqual(['tool-a']);
    });

    it('31. falls back to a tool context when the cell cannot be named', () => {
        const target = resolveContextTarget({
            clickedCell: null,
            clickedToolId: 'tool-a',
            selectedCells: cells('r0c0'),
            toolIdOfCell,
        });
        expect(target.kind).toBe('tool');
        expect(target.clickedInSelection).toBe(false);
    });

    it('32. describes no selection at all outside a grid', () => {
        const target = toolOnlyContextTarget('tool-a');
        expect(target).toEqual({
            kind: 'tool',
            clickedCell: null,
            clickedToolId: 'tool-a',
            clickedInSelection: false,
            cellCount: 0,
            toolIds: [],
        });
    });

    it('33. never touches the selection it was given', () => {
        const selected = cells('r0c0', 'r0c1');
        const before = [...selected];
        resolveContextTarget({
            clickedCell: 'r1c0',
            clickedToolId: 'tool-c',
            selectedCells: selected,
            toolIdOfCell,
        });
        expect([...selected]).toEqual(before);
    });

    it('34. returns the same answer for the same question', () => {
        const input = {
            clickedCell: 'r0c0',
            clickedToolId: 'tool-a',
            selectedCells: cells('r0c0', 'r1c2'),
            toolIdOfCell,
        };
        expect(resolveContextTarget(input)).toEqual(resolveContextTarget(input));
    });

    it('35. describes a selection on its own, without a click', () => {
        expect(getSelectionDescriptor(cells('r1c2', 'r0c0'), toolIdOfCell)).toEqual({
            cellCount: 2,
            toolIds: ['tool-a', 'tool-d'],
        });
        expect(getSelectionDescriptor(cells(), toolIdOfCell)).toEqual({
            cellCount: 0,
            toolIds: [],
        });
    });
});

describe('the wiring from the grid to the menu', () => {
    const grid = read('src/components/buttons-panel/CategoryButtonGrid.tsx');
    const seam = read('src/contexts/GridContextTarget.tsx');
    const menu = read('src/hooks/useButtonMenu.ts');
    const core = read('src/utils/contextTarget.ts');

    it('36. has the grid publish the resolver', () => {
        expect(grid).toContain('GridTargetResolverProvider');
        expect(grid).toContain('resolveContextTarget');
    });

    it('37. reads the CURRENT selection, not the one the handler was born with', () => {
        // A menu opened after the selection changed must describe the
        // selection as it is; a closed-over value would describe the render.
        expect(grid).toContain('contextTargetRef.current');
    });

    it('38. tells every cell which cell it is', () => {
        expect(grid).toContain('GridCellKeyProvider');
        expect(seam).toContain('GridCellKeyContext');
    });

    it('38a. wraps only a real tool, so an empty cell stays empty', () => {
        // A cell reads "filled" from whether it was given children, so an
        // unconditional wrapper fills every cell in the grid: no `+`, no
        // empty-cell tooltip, no file drop target. Found live, not here.
        expect(read('src/components/buttons-panel/GridSlotCell.tsx')).toContain(
            'const filled = children !== null && children !== undefined;'
        );
        expect(grid).toMatch(/\{button \? \(\s*<GridCellKeyProvider/);
    });

    it('39. answers a plain tool context outside any grid', () => {
        expect(seam).toContain('toolOnlyContextTarget');
    });

    it('40. resolves the target when the menu opens', () => {
        expect(menu).toContain('useContextTarget');
        expect(menu).toContain('contextTarget(button.id)');
    });

    it('41. still offers edit, copy and delete', () => {
        expect(menu).toContain("t('edit')");
        expect(menu).toContain("t('copy')");
        expect(menu).toContain("t('delete')");
        expect(menu).toContain('showAtMouseEvent');
    });

    it('42. adds no invented entries', () => {
        expect(menu).not.toMatch(/coming soon|create node|extract|pdf/i);
    });

    it('43. writes nothing on the context path', () => {
        // The hard rule: a right click may not replace, extend or clear the
        // selection. None of these three files may call a selection mutator.
        for (const source of [core, seam, menu]) {
            expect(source).not.toMatch(/selectCell|selectCells|clearCellSelection|restoreCellSelection/);
        }
    });

    it('44. keeps the core pure — no React, no settings writes', () => {
        expect(core).not.toContain("from 'react'");
        expect(core).not.toMatch(/saveSettings|plugin\./);
    });

    it('45. leaves the right-button drag alone', () => {
        const item = read('src/components/button/SortableButtonItem.tsx');
        expect(item).toContain('activateOnButton(listeners, MOUSE_BUTTON.right)');
    });

    it('46. leaves the mouse grammar alone', () => {
        const intent = read('src/utils/gridPointerIntent.ts');
        expect(intent).toContain("return 'secondary'");
        const binding = read('src/components/button/Button.tsx');
        expect(binding).toContain("addEventListener('contextmenu'");
    });
});
