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
import type { ButtonConfig, StoredCategory, ToolPlacement } from '@/types/settings';
import { ActionSequence } from '@/actions/ActionSequence';
import { findVariant } from '@/utils/categoryVariants';
import { createToolInCategory, type ToolState } from '@/domain/categoryOps';
import { LEGACY_GRID_SLOT_COUNT } from '@/utils/categoryGrid';
import {
    buildVaultFileButtonDraft,
    resolveScriptName,
    type DroppedVaultFile,
} from '@/utils/vaultFileButton';
import { parseDraggedLinkText } from '@/utils/obsidianFileDrag';
import { t } from '@/utils/i18n';
import { p, registryOf, stateOf, storedGrid, storedVariant, tool } from './helpers/stored';

// --- helpers -----------------------------------------------------------------

function button(id: string, order: number, slot?: number): ButtonConfig {
    const b: ButtonConfig = { id, name: id, actions: [], order };
    if (slot !== undefined) b.slot = slot;
    return b;
}

/** State with one static grid holding the given placements. */
function gridState(placements: ToolPlacement[]): ToolState {
    return stateOf(
        registryOf(...placements.map((placement) => tool(placement.toolId))),
        storedGrid(placements)
    );
}

function dynamicState(
    variants: { id: string; placements: ToolPlacement[] }[]
): ToolState {
    const category: StoredCategory = {
        id: 'cat',
        name: 'Tools',
        order: 0,
        layout: 'grid',
        placements: [],
        variants: variants.map((v) => storedVariant(v.id, { all: [] }, v.placements)),
    };
    const all = variants.flatMap((v) => v.placements);
    return stateOf(registryOf(...all.map((placement) => tool(placement.toolId))), category);
}

function fullGrid(): ToolPlacement[] {
    return Array.from({ length: LEGACY_GRID_SLOT_COUNT }, (_, slot) => p(`b${slot}`, slot));
}

/** The category's placements after the create, or null when refused. */
function placedIn(next: ToolState | null): ToolPlacement[] | null {
    return next?.categories[0]!.placements ?? null;
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

// --- 1b. an edit round trip keeps a subpath ----------------------------------
//
// The edit modal rebuilds every action through `toJSON`, so anything the form
// has no control for is lost unless the action carries it. A dropped
// annotation's position is exactly such a value.

describe('the optional file subpath survives the edit form', () => {
    const SUBPATH = '#page=44#annotation=%7B%22annotationID%22%3A%22KWBFL8CQ%22%7D';

    it('is carried through unchanged', () => {
        const sequence = new ActionSequence([
            { type: 'file', parameters: { filePath: 'Literatur/Bieker.pdf', subpath: SUBPATH } },
        ]);
        const result = sequence.collectConfiguredActions();

        expect(result.ok).toBe(true);
        expect(result.ok && result.actions).toEqual([
            { type: 'file', parameters: { filePath: 'Literatur/Bieker.pdf', subpath: SUBPATH } },
        ]);
    });

    it('adds no key to a plain file action', () => {
        const sequence = new ActionSequence([
            { type: 'file', parameters: { filePath: 'notes/a.md' } },
        ]);
        const result = sequence.collectConfiguredActions();

        expect(result.ok && result.actions).toEqual([
            { type: 'file', parameters: { filePath: 'notes/a.md' } },
        ]);
        // Not merely equal: the key must be absent, or every stored file tool
        // would gain a field on its next edit.
        const [action] = result.ok ? result.actions : [];
        expect(action && 'subpath' in action.parameters).toBe(false);
    });

    it('does not make an otherwise empty row count as configured', () => {
        // A subpath without a file is not a tool; the row is still untouched.
        const sequence = new ActionSequence([
            { type: 'file', parameters: { filePath: '', subpath: SUBPATH } },
        ]);
        const result = sequence.collectConfiguredActions();

        expect(result.ok).toBe(true);
        expect(result.ok && result.actions).toEqual([]);
    });
});

// --- 2. the slot comes from the gesture --------------------------------------

describe('creating a tool in a chosen slot', () => {
    it('places the tool in exactly the requested slot of a static grid', () => {
        const next = createToolInCategory(gridState([]), 'cat', null, button('new', 0), 9);

        expect(placedIn(next)).toEqual([p('new', 9)]);
        // The definition was registered in the same step.
        expect(next!.tools['new']).toBeDefined();
    });

    it('still uses the lowest free slot when no slot is requested', () => {
        const next = createToolInCategory(
            gridState([p('a', 0)]),
            'cat',
            null,
            button('new', 0)
        );

        expect(placedIn(next)).toEqual([p('a', 0), p('new', 1)]);
    });

    it('leaves the holes below the requested slot empty', () => {
        const next = createToolInCategory(gridState([]), 'cat', null, button('new', 0), 7);

        expect(placedIn(next)).toEqual([p('new', 7)]);
    });

    it('keeps the tool when the requested slot turned out to be taken', () => {
        const next = createToolInCategory(
            gridState([p('a', 3)]),
            'cat',
            null,
            button('new', 0),
            3
        );

        expect(placedIn(next)).toEqual([p('a', 3), p('new', 0)]);
    });

    it('ignores an out-of-range slot instead of corrupting the grid', () => {
        const next = createToolInCategory(gridState([]), 'cat', null, button('new', 0), 99);

        expect(placedIn(next)).toEqual([p('new', 0)]);
    });

    it('refuses a full 4x4 grid — there is no 17th slot to aim at', () => {
        expect(
            createToolInCategory(gridState(fullGrid()), 'cat', null, button('new', 0), 5)
        ).toBeNull();
        expect(
            createToolInCategory(gridState(fullGrid()), 'cat', null, button('new', 0))
        ).toBeNull();
    });

    it('creates in the EDITED variant, never in the first one', () => {
        const state = dynamicState([
            { id: 'source', placements: [p('s0', 0)] },
            { id: 'topic', placements: [] },
        ]);

        const next = createToolInCategory(state, 'cat', 'topic', button('new', 0), 6)!;

        expect(
            findVariant(next.categories[0]!, 'topic')?.placements
        ).toEqual([p('new', 6)]);
        // The other variant is a complete, independent grid: untouched.
        expect(findVariant(next.categories[0]!, 'source')?.placements).toEqual([p('s0', 0)]);
    });

    it('a full variant refuses while its sibling still has room', () => {
        const state = dynamicState([
            { id: 'full', placements: fullGrid() },
            { id: 'free', placements: [] },
        ]);

        expect(createToolInCategory(state, 'cat', 'full', button('new', 0), 2)).toBeNull();
        const next = createToolInCategory(state, 'cat', 'free', button('new', 0), 2)!;
        expect(findVariant(next.categories[0]!, 'free')?.placements).toEqual([p('new', 2)]);
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
