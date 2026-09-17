// Direct, slot-based tool creation.
//
// The grid itself is the editing surface: a tool is created in the cell the
// user points at, and a vault file dragged onto a cell becomes the tool that
// file obviously means. What that means for the pure layers:
//
// - a tool may be saved BEFORE it has an action (name/icon/slot first), so an
//   untouched action row is dropped instead of blocking the save, while a
//   half-filled row still blocks;
// - the slot from the gesture is honoured, and a full 4x4 grid offers none;
// - a dropped file maps onto the EXISTING `file` / `script` actions, never
//   onto a new mechanism.
//
// The DnD plumbing itself (move/swap, source slot, permanent droppables) is
// unchanged and stays covered by gridDragItems/variantGridDnd.

import { describe, expect, it } from 'vitest';
import type { ButtonConfig, CategoryConfig, CategoryVariant } from '@/types/settings';
import { ActionSequence } from '@/actions/ActionSequence';
import { addButtonToGrid, findVariant } from '@/utils/categoryVariants';
import { GRID_SLOT_COUNT } from '@/utils/categoryGrid';
import {
    buildVaultFileButtonDraft,
    resolveScriptName,
    type DroppedVaultFile,
} from '@/utils/vaultFileButton';
import { parseDraggedLinkText } from '@/utils/obsidianFileDrag';
import { t } from '@/utils/i18n';

// --- helpers -----------------------------------------------------------------

function button(id: string, order: number, slot?: number): ButtonConfig {
    const b: ButtonConfig = { id, name: id, actions: [], order };
    if (slot !== undefined) b.slot = slot;
    return b;
}

function variant(id: string, buttons: ButtonConfig[]): CategoryVariant {
    return { id, name: id, buttons };
}

function staticGrid(buttons: ButtonConfig[]): CategoryConfig {
    return { id: 'cat', name: 'Tools', order: 0, buttons, layout: 'grid' };
}

function dynamicCategory(variants: CategoryVariant[]): CategoryConfig {
    return { id: 'cat', name: 'Tools', order: 0, buttons: [], layout: 'grid', variants };
}

function fullGrid(): ButtonConfig[] {
    return Array.from({ length: GRID_SLOT_COUNT }, (_, slot) =>
        button(`b${slot}`, slot, slot)
    );
}

function vaultFile(path: string): DroppedVaultFile {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    return {
        path,
        basename: dot === -1 ? name : name.slice(0, dot),
        extension: dot === -1 ? '' : name.slice(dot + 1),
    };
}

// --- 1. a tool may exist before its action -----------------------------------

describe('saving a tool without an action', () => {
    it('drops the untouched default row instead of blocking the save', () => {
        // Exactly what ButtonCreateModal starts with: one empty "Open file".
        const sequence = new ActionSequence([{ type: 'file', parameters: { filePath: '' } }]);
        const result = sequence.collectConfiguredActions();

        expect(result.ok).toBe(true);
        expect(result.ok && result.actions).toEqual([]);
    });

    it('drops every untouched row, whatever its type', () => {
        const sequence = new ActionSequence([
            { type: 'file', parameters: { filePath: '' } },
            { type: 'command', parameters: { commandId: '' } },
            { type: 'url', parameters: { url: '' } },
            { type: 'script', parameters: { scriptName: '' } },
            { type: 'create_file', parameters: {} },
        ]);
        const result = sequence.collectConfiguredActions();

        expect(result.ok).toBe(true);
        expect(result.ok && result.actions).toEqual([]);
    });

    it('keeps configured rows and drops only the untouched ones', () => {
        const sequence = new ActionSequence([
            { type: 'file', parameters: { filePath: 'notes/a.md' } },
            { type: 'url', parameters: { url: '' } },
        ]);
        const result = sequence.collectConfiguredActions();

        expect(result.ok).toBe(true);
        expect(result.ok && result.actions).toEqual([
            { type: 'file', parameters: { filePath: 'notes/a.md' } },
        ]);
    });

    it('still blocks a HALF-filled row rather than discarding the input', () => {
        // A folder but no file name is not "unconfigured" — silently dropping
        // it would throw away what the user typed.
        const sequence = new ActionSequence([
            { type: 'create_file', parameters: { folderPath: 'inbox' } },
        ]);

        expect(sequence.collectConfiguredActions().ok).toBe(false);
    });

    it('running an action-less tool is a stated outcome, not silence', () => {
        // The click handler reports this instead of dispatching nothing; the
        // dispatcher below it also refuses an empty list, so neither layer can
        // throw or invent an action.
        expect(t('button_no_action')).toBe('No action assigned.');
    });
});

// --- 2. the slot comes from the gesture --------------------------------------

describe('creating a tool in a chosen slot', () => {
    it('places the tool in exactly the requested slot of a static grid', () => {
        const next = addButtonToGrid(staticGrid([]), null, button('new', 0), 9);

        expect(next?.buttons.find((b) => b.id === 'new')?.slot).toBe(9);
    });

    it('still uses the lowest free slot when no slot is requested', () => {
        const next = addButtonToGrid(staticGrid([button('a', 0, 0)]), null, button('new', 0));

        expect(next?.buttons.find((b) => b.id === 'new')?.slot).toBe(1);
    });

    it('leaves the holes below the requested slot empty', () => {
        const next = addButtonToGrid(staticGrid([]), null, button('new', 0), 7);

        expect(next?.buttons).toHaveLength(1);
        expect(next?.buttons[0]?.slot).toBe(7);
    });

    it('keeps the tool when the requested slot turned out to be taken', () => {
        const next = addButtonToGrid(
            staticGrid([button('a', 0, 3)]),
            null,
            button('new', 0),
            3
        );

        expect(next?.buttons.find((b) => b.id === 'new')?.slot).toBe(0);
    });

    it('ignores an out-of-range slot instead of corrupting the grid', () => {
        const next = addButtonToGrid(staticGrid([]), null, button('new', 0), 99);

        expect(next?.buttons.find((b) => b.id === 'new')?.slot).toBe(0);
    });

    it('refuses a full 4x4 grid — there is no 17th slot to aim at', () => {
        expect(addButtonToGrid(staticGrid(fullGrid()), null, button('new', 0), 5)).toBeNull();
        expect(addButtonToGrid(staticGrid(fullGrid()), null, button('new', 0))).toBeNull();
    });

    it('creates in the EDITED variant, never in the first one', () => {
        const category = dynamicCategory([
            variant('source', [button('s0', 0, 0)]),
            variant('topic', []),
        ]);

        const next = addButtonToGrid(category, 'topic', button('new', 0), 6);

        expect(findVariant(next!, 'topic')?.buttons.map((b) => [b.id, b.slot])).toEqual([
            ['new', 6],
        ]);
        // The other variant is a complete, independent grid: untouched.
        expect(findVariant(next!, 'source')?.buttons.map((b) => b.id)).toEqual(['s0']);
    });

    it('a full variant refuses while its sibling still has room', () => {
        const category = dynamicCategory([variant('full', fullGrid()), variant('free', [])]);

        expect(addButtonToGrid(category, 'full', button('new', 0), 2)).toBeNull();
        expect(
            findVariant(addButtonToGrid(category, 'free', button('new', 0), 2)!, 'free')
                ?.buttons[0]?.slot
        ).toBe(2);
    });
});

// --- 3. a dropped vault file becomes the obvious tool ------------------------

describe('mapping a dropped vault file onto an existing action', () => {
    it('maps an ordinary file onto Open file with the exact vault path', () => {
        const draft = buildVaultFileButtonDraft(vaultFile('Lit/Becker_Westerholt.pdf'));

        expect(draft.mapping).toBe('file');
        expect(draft.action).toEqual({
            type: 'file',
            parameters: { filePath: 'Lit/Becker_Westerholt.pdf' },
        });
        expect(draft.name).toBe('Becker_Westerholt');
        expect(draft.scriptFolderMismatch).toBe(false);
    });

    it('names the tool after the basename, without folders or extension', () => {
        expect(buildVaultFileButtonDraft(vaultFile('a/b/c/Note.md')).name).toBe('Note');
        expect(buildVaultFileButtonDraft(vaultFile('Note.canvas')).name).toBe('Note');
    });

    it('maps a .js file inside the script folder onto Run script', () => {
        const draft = buildVaultFileButtonDraft(vaultFile('scripts/sync/zot.js'), {
            scriptFolderPath: 'scripts/',
        });

        expect(draft.mapping).toBe('script');
        // ScriptService resolves <scriptFolderPath>/<scriptName>, so the
        // stored name is relative to that folder — not a vault path.
        expect(draft.action).toEqual({
            type: 'script',
            parameters: { scriptName: 'sync/zot.js' },
        });
        expect(draft.scriptFolderMismatch).toBe(false);
    });

    it('falls back to Open file for a .js OUTSIDE the script folder', () => {
        const draft = buildVaultFileButtonDraft(vaultFile('elsewhere/tool.js'), {
            scriptFolderPath: 'scripts',
        });

        expect(draft.mapping).toBe('file');
        expect(draft.action).toEqual({
            type: 'file',
            parameters: { filePath: 'elsewhere/tool.js' },
        });
        // Reported, not silently degraded: Run script could not address it.
        expect(draft.scriptFolderMismatch).toBe(true);
    });

    it('treats the whole vault as the script folder when none is configured', () => {
        expect(resolveScriptName('a/b/tool.js', '')).toBe('a/b/tool.js');
        expect(resolveScriptName('a/b/tool.js', '   ')).toBe('a/b/tool.js');
        expect(resolveScriptName('a/b/tool.js', '/')).toBe('a/b/tool.js');
        expect(resolveScriptName('a/b/tool.js', undefined)).toBe('a/b/tool.js');
    });

    it('does not mistake a sibling folder for the script folder', () => {
        expect(resolveScriptName('scripts-old/tool.js', 'scripts')).toBeNull();
        expect(resolveScriptName('scripts/tool.js', 'scripts')).toBe('tool.js');
    });

    it('gives every draft an icon id the icon picker could also produce', () => {
        expect(buildVaultFileButtonDraft(vaultFile('a.md')).iconId).toBe('file-text');
        expect(buildVaultFileButtonDraft(vaultFile('a.pdf')).iconId).toBe('file');
        expect(
            buildVaultFileButtonDraft(vaultFile('scripts/a.js'), {
                scriptFolderPath: 'scripts',
            }).iconId
        ).toBe('file-code');
    });
});

// --- 4. reading what Obsidian puts into the drag -----------------------------

describe('parsing the link text of an Obsidian drag', () => {
    it('reads the obsidian:// URI the file explorer actually writes', () => {
        // Measured live: a file-explorer drag puts this in text/plain, and a
        // markdown file's target comes WITHOUT its extension (a linkpath).
        expect(
            parseDraggedLinkText(
                'obsidian://open?vault=vault&file=other%2FBecker_Westerholt.pdf'
            )
        ).toBe('other/Becker_Westerholt.pdf');
        expect(parseDraggedLinkText('obsidian://open?vault=vault&file=other%2Fnote-b')).toBe(
            'other/note-b'
        );
        expect(parseDraggedLinkText('obsidian://open?vault=vault')).toBeNull();
    });

    it('reads the target out of every link shape Obsidian writes', () => {
        expect(parseDraggedLinkText('[[Becker_Westerholt.pdf]]')).toBe(
            'Becker_Westerholt.pdf'
        );
        expect(parseDraggedLinkText('![[Becker_Westerholt.pdf]]')).toBe(
            'Becker_Westerholt.pdf'
        );
        expect(parseDraggedLinkText('[[Lit/Becker.pdf|Becker]]')).toBe('Lit/Becker.pdf');
        expect(parseDraggedLinkText('[Becker](Lit/Becker%20W.pdf)')).toBe('Lit/Becker W.pdf');
        expect(parseDraggedLinkText('Lit/Becker.pdf')).toBe('Lit/Becker.pdf');
    });

    it('refuses payloads that are not a single link target', () => {
        expect(parseDraggedLinkText('')).toBeNull();
        expect(parseDraggedLinkText('   ')).toBeNull();
        expect(parseDraggedLinkText('line one\nline two')).toBeNull();
        // An external URL is not a vault file.
        expect(parseDraggedLinkText('[site](https://example.com)')).toBeNull();
    });
});
