// outlineButton.ts
// Pure mapping from a dragged document section to the tool created for it — the
// sibling of annotationButton.ts, and the same promise: no new action type.
//
// A section becomes the EXISTING `file` action, pointed at the document and
// carrying the reader's own navigation subpath, exactly like a dropped
// annotation. What is new is the `section` description stored beside it: the
// title, the depth, the ancestor titles and the pages. That description is what
// keeps the tool a SECTION — "this chapter of this document" — instead of the
// page bookmark a bare subpath would leave behind, and it is what later work on
// these tools will read.
//
// Nothing here is live: every field is a snapshot taken at the drop, as stable
// as the document's own table of contents.

import type { ButtonAction } from '@/types/action';
import {
    buildSectionSubpath,
    type OutlineSectionRef,
} from '@/utils/readerOutlineDrop';
import { annotationTooltip, shortSourceLabel } from '@/utils/sourceLabel';

/** How long a label may get before it is cut; the cell shows far less. */
const MAX_LABEL_TEXT = 60;

export interface OutlineButtonDraft {
    name: string;
    /** Obsidian icon id; the caller resolves it to the stored SVG markup. */
    iconId: string;
    action: ButtonAction;
    /** Hover text: which source, which page, and where in the document. */
    tooltip?: string;
}

/** One readable line: whitespace collapses, then a cut at a word boundary. */
function condense(value: string): string {
    const text = value.replace(/\s+/g, ' ').trim();
    if (text.length <= MAX_LABEL_TEXT) {
        return text;
    }
    const cut = text.slice(0, MAX_LABEL_TEXT);
    const lastSpace = cut.lastIndexOf(' ');
    const stem = lastSpace > MAX_LABEL_TEXT * 0.6 ? cut.slice(0, lastSpace) : cut;
    return `${stem.trimEnd()}…`;
}

/**
 * The tool label: what the section is CALLED.
 *
 * Just the outline title, including whatever numbering the document itself
 * uses ("1.3 Verhalten an der Hochschule"). The numbering is the document's,
 * not ours, so it is neither added nor stripped. Which document it is lives in
 * the hover text, where there is room.
 */
function sectionName(ref: OutlineSectionRef): string {
    return condense(ref.section.title) || 'Section';
}

/** The action that opens the document at the section. */
function sectionAction(ref: OutlineSectionRef): ButtonAction {
    return {
        type: 'file',
        parameters: {
            filePath: ref.filePath,
            subpath: buildSectionSubpath(ref.location),
            section: ref.section,
        },
    };
}

/**
 * Hover text: the source and page, as every other reader bookmark shows them,
 * and the outline path when the section sits under something.
 *
 * The path is the ancestors only — the section names itself on the button face,
 * so repeating it here would spend the one line on nothing.
 */
function sectionTooltip(ref: OutlineSectionRef): string | undefined {
    const base = annotationTooltip(shortSourceLabel(ref.filePath), ref.section.pageLabel);
    const parents = ref.section.parents ?? [];
    if (parents.length === 0) {
        return base;
    }
    const path = parents.join(' › ');
    return base ? `${base}\n${path}` : path;
}

/** The tool a dropped outline section becomes. */
export function buildOutlineButtonDraft(ref: OutlineSectionRef): OutlineButtonDraft {
    const tooltip = sectionTooltip(ref);
    return {
        name: sectionName(ref),
        // A section is a piece of the document's structure, not a mark on it:
        // the list icon says "part of a table of contents" where the annotation
        // icons say "a highlight".
        iconId: 'list-tree',
        action: sectionAction(ref),
        ...(tooltip !== undefined ? { tooltip } : {}),
    };
}
