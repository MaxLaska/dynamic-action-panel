// annotationButton.ts
// Pure mapping from a captured annotation to the tool created for it — the
// sibling of vaultFileButton.ts, and the same promise: no new action type.
//
// A local annotation becomes the EXISTING `file` action, pointed at the PDF and
// carrying the reader's own navigation subpath. A library annotation becomes the
// EXISTING `url` action, carrying ZotFlow's protocol URI. Both are ordinary
// tools afterwards: copy, duplicate, GC, export and import treat them like any
// other, and a build without this feature would still open the file.

import type { ButtonAction } from '@/types/action';
import {
    buildAnnotationSubpath,
    buildLibraryAnnotationUrl,
    type ZotflowAnnotationRef,
} from '@/utils/zotflowAnnotationDrop';

/** How long a label may get before it is cut; the cell shows far less. */
const MAX_LABEL_TEXT = 60;

export interface AnnotationButtonDraft {
    name: string;
    /** Obsidian icon id; the caller resolves it to the stored SVG markup. */
    iconId: string;
    action: ButtonAction;
}

/** Icon per annotation kind; an unknown kind is still a highlight to the user. */
function annotationIconId(annotationType: string | undefined): string {
    switch (annotationType) {
        case 'underline':
            return 'underline';
        case 'note':
            return 'sticky-note';
        case 'image':
            return 'image';
        case 'ink':
            return 'pen-tool';
        case 'text':
            return 'type';
        default:
            return 'highlighter';
    }
}

/**
 * One line of readable text out of an annotation body: newlines and runs of
 * whitespace collapse, then it is cut at a word boundary when that does not
 * throw away most of the allowance.
 */
function condense(value: string | undefined): string {
    const text = (value ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= MAX_LABEL_TEXT) {
        return text;
    }
    const cut = text.slice(0, MAX_LABEL_TEXT);
    const lastSpace = cut.lastIndexOf(' ');
    const stem = lastSpace > MAX_LABEL_TEXT * 0.6 ? cut.slice(0, lastSpace) : cut;
    return `${stem.trimEnd()}…`;
}

/**
 * The page as the user sees it printed, falling back to the physical page.
 * `pageLabel` is what the document itself shows and need not be `pageIndex + 1`.
 */
function pageText(ref: ZotflowAnnotationRef): string | null {
    if (ref.pageLabel) {
        return ref.pageLabel;
    }
    return typeof ref.pageIndex === 'number' ? String(ref.pageIndex + 1) : null;
}

/**
 * The tool label.
 *
 * The page goes FIRST because a grid cell shows one short line with an ellipsis:
 * leading with the quote would truncate away the one piece that says which
 * annotation this is. The full label is still the tooltip, and renaming is the
 * ordinary edit path.
 */
function annotationName(ref: ZotflowAnnotationRef): string {
    const body = condense(ref.text) || condense(ref.comment);
    const page = pageText(ref);
    if (page && body) {
        return `p.${page} · ${body}`;
    }
    if (body) {
        return body;
    }
    if (page) {
        return `p.${page}`;
    }
    // Nothing but the identity: name it after what it points at.
    return ref.kind === 'local' && ref.fileBasename
        ? `Annotation · ${ref.fileBasename}`
        : 'Annotation';
}

/** The action that reopens the annotation. */
function annotationAction(ref: ZotflowAnnotationRef): ButtonAction {
    if (ref.kind === 'library') {
        return { type: 'url', parameters: { url: buildLibraryAnnotationUrl(ref) } };
    }
    return {
        type: 'file',
        parameters: {
            filePath: ref.filePath,
            subpath: buildAnnotationSubpath(ref.annotationId, ref.pageIndex),
        },
    };
}

/** The tool a dropped ZotFlow annotation becomes. */
export function buildAnnotationButtonDraft(ref: ZotflowAnnotationRef): AnnotationButtonDraft {
    return {
        name: annotationName(ref),
        iconId: annotationIconId(ref.annotationType),
        action: annotationAction(ref),
    };
}
